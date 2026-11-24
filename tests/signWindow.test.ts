// Sign window state machine (all transitions, timeouts, cancel) and the window runner timing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SIGN_WINDOW } from '../src/config';
import { Emitter, type RecognitionProgress, type RecognitionResult } from '../src/recognition/types';
import { aggregate, createWindowRunner, type MotionSample } from '../src/recognition/windowRunner';
import { confidenceWord, initialWindow, windowReducer, type WindowEvent, type WindowState } from '../src/state/signWindow';

const run = (events: WindowEvent[], from: WindowState = initialWindow) => events.reduce(windowReducer, from);
const ready = run([{ type: 'READY' }]);
const res = (label: string, confidence: number, alternatives: { label: string; confidence: number }[] = []): WindowEvent => ({
  type: 'RESULT',
  result: { label, confidence, alternatives },
  threshold: 0.8,
});

describe('sign window state machine', () => {
  it('requires the signer to choose a proposed ambiguous match before confirming', () => {
    const result: RecognitionResult = { label: 'none', confidence: 0, reason: 'ambiguous',
      alternatives: [{ label: 'hello', confidence: .7 }, { label: 'goodbye', confidence: .68 }] };
    const pending = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'recording', ms: 500 },
      { type: 'RESULT', result, threshold: 0 }], ready);
    expect(pending).toMatchObject({ outcome: 'not_recognized', selected: null });
    expect(run([{ type: 'SELECT', label: 'unoffered' }], pending)).toEqual(pending);
    expect(run([{ type: 'SELECT', label: 'hello' }], pending)).toMatchObject({ outcome: 'recognized', selected: 'hello' });
    const absent = { ...pending, result: { ...result, reason: 'insufficient_tracking' } };
    expect(run([{ type: 'SELECT', label: 'hello' }], absent)).toEqual(absent);
    const still = { ...pending, result: { ...result, reason: 'insufficient_motion' } };
    expect(run([{ type: 'SELECT', label: 'hello' }], still)).toMatchObject({ selected: 'hello', outcome: 'recognized' });
  });
  it('loading -> idle on READY, unavailable on LOAD_FAILED (with retry back to idle)', () => {
    expect(ready.phase).toBe('idle');
    const failed = run([{ type: 'LOAD_FAILED', message: 'No active model' }]);
    expect(failed.phase).toBe('unavailable');
    expect(failed.error).toBe('No active model');
    expect(run([{ type: 'START' }], failed).phase).toBe('unavailable'); // cannot sign without a model
    expect(run([{ type: 'READY' }], failed).phase).toBe('idle');
  });

  it('full happy path: idle -> countdown -> recording -> processing -> result (recognized)', () => {
    let s = run([{ type: 'START' }], ready);
    expect(s.phase).toBe('countdown');
    s = run([{ type: 'PROGRESS', phase: 'countdown', ms: 500, totalMs: 1000 }], s);
    expect(s).toMatchObject({ phase: 'countdown', ms: 500, totalMs: 1000 });
    s = run([{ type: 'PROGRESS', phase: 'recording', ms: 100, totalMs: 3500 }], s);
    expect(s.phase).toBe('recording');
    s = run([{ type: 'PROGRESS', phase: 'processing', ms: 0 }], s);
    expect(s.phase).toBe('processing');
    s = run([res('hello', 0.93, [{ label: 'goodbye', confidence: 0.04 }])], s);
    expect(s).toMatchObject({ phase: 'result', outcome: 'recognized', selected: 'hello' });
  });

  it("label 'none' or low confidence -> not recognized, nothing selected", () => {
    const base = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'processing', ms: 0 }], ready);
    expect(run([res('none', 0)], base)).toMatchObject({ outcome: 'not_recognized', selected: null });
    expect(run([res('hello', 0.55)], base)).toMatchObject({ outcome: 'not_recognized', selected: null });
  });

  it('pick another: alternatives can be selected', () => {
    let s = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'processing', ms: 0 }, res('fine', 0.85, [{ label: 'thank_you', confidence: 0.1 }])], ready);
    s = run([{ type: 'PICK_ANOTHER' }], s);
    expect(s.picking).toBe(true);
    s = run([{ type: 'SELECT', label: 'thank_you' }], s);
    expect(s).toMatchObject({ selected: 'thank_you', picking: false, phase: 'result' });
  });

  it('try again from a result or an error starts a new countdown', () => {
    const result = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'processing', ms: 0 }, res('yes', 0.9)], ready);
    expect(run([{ type: 'START' }], result).phase).toBe('countdown');
    const err = run([{ type: 'START' }, { type: 'ERROR', message: 'x' }], ready);
    expect(err.phase).toBe('error');
    expect(run([{ type: 'START' }], err).phase).toBe('countdown');
  });

  it('timeouts: only while recording or processing', () => {
    const rec = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'recording', ms: 0 }], ready);
    expect(run([{ type: 'TIMEOUT' }], rec)).toMatchObject({ phase: 'error', error: 'timeout' });
    const proc = run([{ type: 'PROGRESS', phase: 'processing', ms: 0 }], rec);
    expect(run([{ type: 'TIMEOUT' }], proc).phase).toBe('error');
    expect(run([{ type: 'TIMEOUT' }], ready).phase).toBe('idle');
    expect(run([{ type: 'TIMEOUT' }], run([{ type: 'START' }], ready)).phase).toBe('countdown');
  });

  it('cancel from any active phase returns to idle; late events after cancel are ignored', () => {
    for (const phase of ['countdown', 'recording', 'processing'] as const) {
      let s = run([{ type: 'START' }, { type: 'PROGRESS', phase, ms: 10 }], ready);
      s = run([{ type: 'CANCEL' }], s);
      expect(s.phase).toBe('idle');
      expect(run([{ type: 'PROGRESS', phase: 'recording', ms: 50 }], s).phase).toBe('idle');
      expect(run([res('hello', 0.99)], s).phase).toBe('idle');
    }
  });

  it('progress never moves backwards', () => {
    const s = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'recording', ms: 10 }, { type: 'PROGRESS', phase: 'countdown', ms: 900 }], ready);
    expect(s.phase).toBe('recording');
  });

  it('START is ignored while a window is already running', () => {
    const s = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'recording', ms: 10 }, { type: 'START' }], ready);
    expect(s).toMatchObject({ phase: 'recording', ms: 10 });
  });

  it('RESET after confirming returns to idle', () => {
    const s = run([{ type: 'START' }, { type: 'PROGRESS', phase: 'processing', ms: 0 }, res('yes', 0.9), { type: 'RESET' }], ready);
    expect(s.phase).toBe('idle');
    expect(s.result).toBeNull();
  });
});

describe('confidence in words', () => {
  it('Sure / Maybe / Not sure', () => {
    expect(confidenceWord(0.95, 0.8, 0.9)).toBe('sure');
    expect(confidenceWord(0.85, 0.8, 0.9)).toBe('maybe');
    expect(confidenceWord(0.5, 0.8, 0.9)).toBe('not_sure');
  });
});

describe('aggregate: one result with up to 2 alternatives from per-frame predictions', () => {
  it('ranks by summed confidence over the window', () => {
    const r = aggregate([
      { label: 'hello', confidence: 0.9 },
      { label: 'hello', confidence: 0.9 },
      { label: 'goodbye', confidence: 0.6 },
      { label: 'none', confidence: 0 },
      { label: 'yes', confidence: 0.2 },
      { label: 'fine', confidence: 0.1 },
    ]);
    expect(r.label).toBe('hello');
    expect(r.confidence).toBeCloseTo(1.8 / 6);
    expect(r.alternatives.map((a) => a.label)).toEqual(['goodbye', 'yes']);
  });
  it('no frames with hands -> none with a reason', () => {
    expect(aggregate([])).toMatchObject({ label: 'none', reason: 'no_hands' });
    expect(aggregate([{ label: 'none', confidence: 0 }])).toMatchObject({ label: 'none', reason: 'unknown_sign' });
  });
});

describe('window runner timing (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(motion: boolean) {
    const em = new Emitter();
    const progress: RecognitionProgress[] = [];
    const results: RecognitionResult[] = [];
    em.on('progress', ((p: RecognitionProgress) => progress.push(p)) as never);
    em.on('result', ((r: RecognitionResult) => results.push(r)) as never);
    let push: ((s: MotionSample) => void) | null = null;
    const runner = createWindowRunner({
      emitter: em,
      timing: () => DEFAULT_SIGN_WINDOW,
      subscribeMotion: motion
        ? (cb) => {
            push = cb;
            return () => (push = null);
          }
        : undefined,
      simulatedRestAfterMs: () => 1500,
      classify: () => ({ label: 'hello', confidence: 0.9, alternatives: [] }),
    });
    return { runner, progress, results, push: (s: MotionSample) => push?.(s) };
  }

  it('countdown lasts about 1 s, then recording; ends when the hands rest for 0.5 s', async () => {
    const t = setup(true);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(900);
    expect(t.progress.at(-1)?.phase).toBe('countdown');
    await vi.advanceTimersByTimeAsync(200);
    expect(t.progress.at(-1)?.phase).toBe('recording');
    // signing: moving hand for 600 ms
    for (let i = 0; i < 12; i++) {
      t.push({ at: performance.now(), motion: 0.05 });
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(t.results).toHaveLength(0);
    // hands rest
    t.push({ at: performance.now(), motion: 0.001 });
    await vi.advanceTimersByTimeAsync(400);
    expect(t.results).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.progress.some((p) => p.phase === 'processing')).toBe(true);
    expect(t.results).toHaveLength(1);
  });

  it('stops at the 3.5 s maximum if the hands never rest', async () => {
    const t = setup(true);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 80 && t.results.length === 0; i++) {
      t.push({ at: performance.now(), motion: 0.05 });
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(t.results).toHaveLength(1);
    const rec = t.progress.filter((p) => p.phase === 'recording');
    expect(rec.at(-1)!.ms).toBeGreaterThanOrEqual(3400);
  });

  it('does not end early if no hand was ever seen (waits for the maximum)', async () => {
    const t = setup(true);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    t.push({ at: performance.now(), motion: null });
    expect(t.results).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1700);
    expect(t.results).toHaveLength(1);
  });

  it('cancel stops everything: no further progress or result', async () => {
    const t = setup(false);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(1200);
    t.runner.cancel();
    const n = t.progress.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.progress.length).toBe(n);
    expect(t.results).toHaveLength(0);
  });
  it('finishes a bounded turn once, and ignores Done outside recording', async () => {
    const t = setup(false);
    t.runner.finish();
    t.runner.start();
    t.runner.finish();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(800);
    t.runner.finish();
    t.runner.finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.results).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.results).toHaveLength(1);
  });
});
