// Browser test for the explicitly scripted demo, not recognition accuracy.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.LINGORA_PRESENTATION_TEST_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/#/presentation', { waitUntil: 'domcontentloaded' });
  await page.locator('#lang-select').selectOption('en');
  await page.getByText('This is prepared text. Words appear on a timer; the camera is not translating signs.').waitFor();
  await page.locator('#scripted-demo-text').fill('Salom dunyo! Yaxshimisiz?');
  assert.equal(await page.locator('#scripted-demo-speed').inputValue(), '3');
  await page.getByRole('button', { name: 'Start demonstration', exact: true }).click();
  const output = page.getByTestId('scripted-demo-output');
  assert.equal(await output.textContent(), '');
  await page.waitForTimeout(1000);
  assert.equal(await output.textContent(), '');
  await page.waitForFunction(() => document.querySelector('[data-testid="scripted-demo-output"]')?.textContent === 'Salom', null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(3500);
  assert.equal(await output.textContent(), 'Salom');
  await page.locator('#scripted-demo-speed').fill('0.5');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="scripted-demo-output"]')?.textContent === 'Salom dunyo! Yaxshimisiz?', null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await output.textContent(), '');
  await page.getByRole('button', { name: 'Sign recognition', exact: true }).click();
  assert.equal(await page.getByTestId('scripted-demo-output').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('Scripted demo: timing, pause/resume, reset, disclosure, mode switch and mobile width passed.');
} finally { await browser.close(); }
