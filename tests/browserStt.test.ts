import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeechStt } from '../src/providers/stt';

class NativeFixture {
  static instances: NativeFixture[] = [];
  static throwOnStart = false;
  lang = ''; continuous = false; interimResults = false;
  onresult: ((e: { resultIndex: number; results: ({ transcript: string }[] & { isFinal: boolean })[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  startedWith: MediaStreamTrack | undefined;
  constructor() { NativeFixture.instances.push(this); }
  start(audioTrack?: MediaStreamTrack) {
    if (NativeFixture.throwOnStart) throw new DOMException('Denied', 'NotAllowedError');
    this.startedWith = audioTrack;
    this.onstart?.();
  }
  stop = vi.fn();
  result(parts: [string, boolean][]) {
    this.onresult?.({ resultIndex: 0, results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
  }
}
const setup = () => {
  NativeFixture.instances = []; NativeFixture.throwOnStart = false;
  vi.stubGlobal('window', { SpeechRecognition: NativeFixture });
  return { current: () => NativeFixture.instances.at(-1)! };
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('native browser speech adapter (engine is mocked in unit tests)', () => {
  it('requires a callable implementation and sets the Uzbek locale', async () => {
    vi.stubGlobal('window', { SpeechRecognition: undefined });
    expect(BrowserSpeechStt.isSupported()).toBe(false);
    const f = setup();
    await new BrowserSpeechStt().start('uz', vi.fn());
    expect(f.current()).toMatchObject({ lang: 'uz-UZ', continuous: true, interimResults: true });
    f.current().onend?.();
  });
  it('joins final/interim chunks with spaces and emits one final on natural end', async () => {
    const f = setup(); const text = vi.fn();
    await new BrowserSpeechStt().start('uz', text);
    f.current().result([['Salom.', true], ['Sizni', true], [' tushundim. ', false]]);
    expect(text).toHaveBeenLastCalledWith('Salom. Sizni tushundim.', false);
    const end = f.current().onend;
    end?.(); end?.();
    expect(text.mock.calls.filter(([, final]) => final)).toEqual([['Salom. Sizni tushundim.', true]]);
  });
  it('drains the service final result that arrives after stop was requested', async () => {
    const f = setup(); const text = vi.fn(); const stt = new BrowserSpeechStt();
    await stt.start('uz', text);
    f.current().result([['Sa', false]]);
    const stop = stt.stop();
    f.current().result([['Salom.', true]]);
    f.current().onend?.();
    await stop;
    expect(text).toHaveBeenLastCalledWith('Salom.', true);
  });
  it('ignores stale events from a replaced recognizer', async () => {
    const f = setup(); const oldText = vi.fn(); const newText = vi.fn(); const stt = new BrowserSpeechStt();
    await stt.start('uz', oldText);
    const stale = f.current().onresult;
    await stt.start('uz', newText);
    stale?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'old' }], { isFinal: true })] });
    expect(oldText).not.toHaveBeenCalled();
    expect(newText).not.toHaveBeenCalled();
    f.current().onend?.();
  });
  it('cancels a draining session without delivering a late final after navigation', async () => {
    vi.useFakeTimers();
    const f = setup(); const text = vi.fn(); const stt = new BrowserSpeechStt();
    await stt.start('uz', text);
    f.current().result([['Salom.', false]]);
    const result = f.current().onresult; const end = f.current().onend;
    const stopping = stt.stop();
    await stt.cancel(); await stopping;
    result?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'stale final' }], { isFinal: true })] });
    end?.();
    await vi.advanceTimersByTimeAsync(2000);
    expect(text.mock.calls).toEqual([['Salom.', false]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses an owned microphone track on modern Chromium and releases it on cancel', async () => {
    const f = setup(); const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
    vi.stubGlobal('navigator', { userAgent: 'Chrome/157.0.0.0', mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }),
    } });
    const stt = new BrowserSpeechStt();
    await stt.start('uz', vi.fn());
    expect(f.current().startedWith).toBe(track);
    await stt.cancel();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('releases microphone permission that resolves after cancellation without starting recognition', async () => {
    const f = setup(); const text = vi.fn(); const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
    let allow!: (value: unknown) => void;
    vi.stubGlobal('navigator', { userAgent: 'Chrome/157.0.0.0', mediaDevices: {
      getUserMedia: () => new Promise((resolve) => { allow = resolve; }),
    } });
    const stt = new BrowserSpeechStt(); const starting = stt.start('uz', text);
    await stt.cancel();
    allow({ getTracks: () => [track], getAudioTracks: () => [track] });
    await starting;
    expect(f.current().startedWith).toBeUndefined();
    expect(text).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('preserves native failure codes and never turns an error into a successful final turn', async () => {
    const f = setup(); const failure = vi.fn(); const text = vi.fn(); const stt = new BrowserSpeechStt(failure);
    await stt.start('uz', text);
    f.current().onerror?.({ error: 'language-not-supported' });
    expect(stt.lastError).toMatchObject({ code: 'language-not-supported' });
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'language-not-supported' }));
    expect(text).not.toHaveBeenCalled();
  });
  it('cleans up a synchronous permission rejection', async () => {
    const f = setup(); NativeFixture.throwOnStart = true;
    const stt = new BrowserSpeechStt();
    await expect(stt.start('uz', vi.fn())).rejects.toMatchObject({ code: 'not-allowed' });
    expect(f.current().onresult).toBeNull();
    expect(f.current().stop).toHaveBeenCalledOnce();
  });
  it('finishes a stuck native stop once and clears its watchdog', async () => {
    vi.useFakeTimers();
    const f = setup(); const text = vi.fn(); const stt = new BrowserSpeechStt();
    await stt.start('uz', text);
    f.current().result([['Rahmat.', true]]);
    const stop = stt.stop();
    await vi.advanceTimersByTimeAsync(1600);
    await stop;
    expect(text).toHaveBeenLastCalledWith('Rahmat.', true);
    expect(text.mock.calls.filter(([, final]) => final)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
