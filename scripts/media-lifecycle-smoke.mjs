// Controlled React integration races only. Speech/media are deliberate fixtures;
// this does not test recognition accuracy or use any real microphone/camera.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.LINGORA_TEST_URL ?? 'http://localhost:5173';
const out = resolve('tmp/media-lifecycle');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
const pageErrors = [];
let currentPage;

async function fixturePage() {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('signconnect.lang', 'en');
    const originalQuery = navigator.permissions?.query.bind(navigator.permissions);
    if (originalQuery) navigator.permissions.query = (descriptor) => descriptor.name === 'camera'
      ? Promise.resolve({ state: 'prompt', addEventListener() {}, removeEventListener() {} })
      : originalQuery(descriptor);
  });
  const page = await context.newPage();
  currentPage = page;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // The initial Help screen never starts model loading. Select the existing mock
  // recognizer before opening the camera screen, to keep these race tests light.
  await page.route(/\.(?:wasm|task)(?:\?|$)/, (route) => route.abort());
  await page.goto(base + '/#/help', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const { runtime } = await import('/src/runtime.ts');
    runtime.setConfig({ recognizer: 'mock', sttProvider: 'azure-speech', faceHints: false });
  });
  return { page, context };
}

async function navigate(page, route) {
  await page.locator(`a[href="#/${route}"]`).first().click();
  await page.waitForURL(`**/#/${route}`);
}

try {
  for (const settlement of ['resolve', 'reject']) {
    const { page, context } = await fixturePage();
    await page.evaluate(async () => {
      const { registerProvider } = await import('/src/providers/index.ts');
      const fixture = { turns: [], cancellations: [], active: null };
      const provider = {
        async start(_lang, onText) {
          const turn = { onText, processing: false, cancelled: false };
          fixture.turns.push(turn); fixture.active = turn;
          onText(`turn ${fixture.turns.length} listening`, false);
        },
        stop() {
          const turn = fixture.active; turn.processing = true;
          return new Promise((resolve, reject) => { turn.resolve = resolve; turn.reject = reject; });
        },
        cancel() {
          const turn = fixture.active;
          fixture.cancellations.push({ whileProcessing: turn?.processing === true });
          if (turn) turn.cancelled = true;
        },
      };
      window.__speechLifecycle = fixture;
      registerProvider('stt', () => provider);
    });
    await navigate(page, 'conversation');
    const mic = page.locator('.composer .mic');
    await mic.click();
    await page.getByText('turn 1 listening', { exact: true }).waitFor();
    await mic.click(); // stop remains pending: transcription is processing.
    await page.waitForFunction(() => window.__speechLifecycle.turns[0]?.processing);
    assert.equal(await mic.getAttribute('aria-pressed'), 'true');
    await navigate(page, 'help');
    await page.waitForFunction(() => window.__speechLifecycle.cancellations.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__speechLifecycle.cancellations), [{ whileProcessing: true }]);

    await navigate(page, 'conversation');
    await mic.click();
    await page.getByText('turn 2 listening', { exact: true }).waitFor();
    await page.evaluate((settlement) => {
      const old = window.__speechLifecycle.turns[0];
      old.onText('STALE OLD PARTIAL', false);
      old.onText('STALE OLD FINAL', true);
      if (settlement === 'reject') old.reject(new Error('controlled old stop failure'));
      else old.resolve();
    }, settlement);
    // Let the old awaited pttStop continuation and React updates finish.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await mic.getAttribute('aria-pressed'), 'true', `${settlement}: old stop ended the new turn`);
    assert.equal(await page.locator('.msg-live .msg-text').textContent(), 'turn 2 listening');
    assert.equal(await page.locator('.chat .notice.bad').count(), 0, `${settlement}: old failure reached new turn`);
    assert.equal(await page.getByText('STALE OLD FINAL', { exact: true }).count(), 0);

    // A successful new turn still accepts its own final callback.
    await page.evaluate(() => window.__speechLifecycle.turns[1].onText('NEW TURN FINAL', true));
    await page.locator('.msg-listener:not(.msg-live) .msg-text').getByText('NEW TURN FINAL', { exact: true }).waitFor().catch(async () => {
      await page.getByText('NEW TURN FINAL', { exact: true }).waitFor();
    });
    assert.equal(await mic.getAttribute('aria-pressed'), 'false');
    checks.push(`pending old STT stop ${settlement}, navigation cancellation, stale callbacks cannot affect a new turn`);
    await context.close();
  }

  {
    const { page, context } = await fixturePage();
    await page.evaluate(() => {
      const fixture = { requests: 0, stops: 0, track: null, allow: null };
      navigator.mediaDevices.getUserMedia = (constraints) => {
        if (!constraints?.video) return Promise.reject(new Error('Unexpected audio capture in camera lifecycle test'));
        fixture.requests++;
        return new Promise((resolve) => {
          fixture.allow = () => {
            const track = { readyState: 'live', stop() { fixture.stops++; this.readyState = 'ended'; } };
            fixture.track = track;
            resolve({ getTracks: () => [track], getVideoTracks: () => [track] });
          };
        });
      };
      window.__cameraLifecycle = fixture;
    });
    await navigate(page, 'conversation');
    await page.getByRole('button', { name: 'Turn on camera', exact: true }).click();
    await page.waitForFunction(() => window.__cameraLifecycle.requests === 1);
    await navigate(page, 'help');
    await page.evaluate(() => window.__cameraLifecycle.allow());
    await page.waitForFunction(() => window.__cameraLifecycle.stops === 1);
    assert.equal(await page.evaluate(() => window.__cameraLifecycle.track.readyState), 'ended');
    await navigate(page, 'conversation');
    await page.getByText('The camera is off.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Turn on camera', exact: true }).count(), 1);
    assert.equal(await page.locator('.cam-off').count(), 0, 'stale permission made the global camera live');
    assert.equal(await page.evaluate(() => window.__cameraLifecycle.requests), 1);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('video')].some((video) => video.srcObject !== null)), false);
    checks.push('camera permission resolving after navigation stops every stale track and keeps global camera off');
    await context.close();
  }

  assert.deepEqual(pageErrors, []);
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ kind: 'controlled lifecycle fixtures; not speech accuracy', checks, pageErrors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, pageErrors }, null, 2));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: resolve(out, 'failure.png'), fullPage: true });
    console.error(await currentPage.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
}
