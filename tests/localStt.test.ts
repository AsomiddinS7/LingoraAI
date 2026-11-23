import { describe, expect, it, vi } from 'vitest';
import { LocalWhisperStt, type LocalSttStatus } from '../src/providers/localStt';

function fixture(options: { permission?: Promise<MediaStream>; fetcher?: typeof fetch } = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const instances: Recorder[] = [];
  const statuses: LocalSttStatus[] = [];
  class Recorder {
    static isTypeSupported(type: string) { return type.startsWith('audio/webm'); }
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    onerror?: () => void;
    constructor() { instances.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['real captured bytes'], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  const fetcher = options.fetcher ?? vi.fn<typeof fetch>(async () => Response.json({ text: 'Assalomu alaykum', language: 'uz' }));
  const onError = vi.fn();
  const provider = new LocalWhisperStt({
    mediaDevices: { getUserMedia: vi.fn(() => options.permission ?? Promise.resolve(stream)) },
    recorderClass: Recorder as unknown as typeof MediaRecorder,
    fetcher, onStatus: status => statuses.push(status), onError,
  });
  return { provider, track, stream, instances, statuses, fetcher, onError };
}

describe('local microphone speech recognition', () => {
  it('uploads captured binary audio and waits for a real service result before stop resolves', async () => {
    let respond!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { respond = resolve; }));
    const f = fixture({ fetcher });
    const onText = vi.fn();
    await f.provider.start('uz', onText);
    const stop = f.provider.stop();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(onText).not.toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8790/api/transcribe?language=uz');
    expect(request?.method).toBe('POST');
    expect(await (request?.body as Blob).text()).toBe('real captured bytes');
    expect(request?.headers).toEqual({ 'Content-Type': 'audio/webm;codecs=opus' });
    expect(f.statuses.at(-1)).toBe('processing');
    respond(Response.json({ text: '  Assalomu alaykum  ' }));
    await stop;
    expect(onText).toHaveBeenCalledExactlyOnceWith('Assalomu alaykum', true);
    expect(f.statuses.at(-1)).toBe('idle');
  });

  it('cleans a microphone permission grant that arrives after cancellation', async () => {
    let grant!: (stream: MediaStream) => void;
    const f = fixture({ permission: new Promise(resolve => { grant = resolve; }) });
    const start = f.provider.start('uz', vi.fn());
    await f.provider.stop();
    grant(f.stream);
    await start;
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.instances).toHaveLength(0);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('cancellation aborts a pending transcription and suppresses its stale result', async () => {
    let respond!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { respond = resolve; }));
    const f = fixture({ fetcher });
    const onText = vi.fn();
    await f.provider.start('ru', onText);
    const stop = f.provider.stop();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    f.provider.cancel();
    expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    respond(Response.json({ text: 'stale transcript' }));
    await stop;
    expect(onText).not.toHaveBeenCalled();
  });

  it('returns silence as an empty final transcript without substituting a phrase', async () => {
    const f = fixture({ fetcher: vi.fn<typeof fetch>(async () => Response.json({ text: '' })) });
    const onText = vi.fn();
    await f.provider.start('uz', onText);
    await f.provider.stop();
    expect(onText).toHaveBeenCalledExactlyOnceWith('', true);
  });

  it('identifies an unsupported language without silently dropping its service error', async () => {
    const f = fixture({ fetcher: vi.fn<typeof fetch>(async () => Response.json({ code: 'invalid_language' }, { status: 400 })) });
    await f.provider.start('en', vi.fn());
    await expect(f.provider.stop()).rejects.toMatchObject({ code: 'unsupported_language' });
    expect(f.statuses.at(-1)).toBe('error');
  });

  it('identifies an unreachable speech service for actionable UI feedback', async () => {
    const f = fixture({ fetcher: vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }) });
    await f.provider.start('uz', vi.fn());
    await expect(f.provider.stop()).rejects.toMatchObject({ code: 'service_unavailable' });
    expect(f.track.stop).toHaveBeenCalledOnce();
  });

  it('surfaces model service failure and never emits a transcript', async () => {
    const f = fixture({ fetcher: vi.fn<typeof fetch>(async () => Response.json({ error: 'Local speech recognition is busy.' }, { status: 503 })) });
    const onText = vi.fn();
    await f.provider.start('uz', onText);
    await expect(f.provider.stop()).rejects.toThrow('busy');
    expect(onText).not.toHaveBeenCalled();
    expect(f.statuses.at(-1)).toBe('error');
    expect(f.track.stop).toHaveBeenCalledOnce();
  });

  it('rejects malformed JSON response shape without inventing recognition', async () => {
    const f = fixture({ fetcher: vi.fn<typeof fetch>(async () => Response.json({ transcript: 'wrong contract' })) });
    const onText = vi.fn();
    await f.provider.start('en', onText);
    await expect(f.provider.stop()).rejects.toThrow('invalid transcript');
    expect(onText).not.toHaveBeenCalled();
  });

  it('deduplicates repeated stops so one turn produces one upload', async () => {
    const f = fixture();
    await f.provider.start('uz', vi.fn());
    const a = f.provider.stop();
    const b = f.provider.stop();
    expect(a).toBe(b);
    await a;
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
});
