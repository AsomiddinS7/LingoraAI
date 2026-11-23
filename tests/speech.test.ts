import { describe, expect, it, vi } from 'vitest';
import { AzureSpeechStt, AzureSpeechTts, createSpeechTokenSource } from '../src/providers/azureSpeech';

const token = { token: 'a-real-looking-token-for-test', region: 'westeurope', expires_in_s: 540 };

function sdkFixture() {
  const configs: Record<string, unknown>[] = [];
  const microphones: { close: ReturnType<typeof vi.fn> }[] = [];
  const recognizers: FakeRecognizer[] = [];
  const speakers: FakeSpeaker[] = [];
  const synthesizers: FakeSynthesizer[] = [];
  class FakeRecognizer {
    static enableTelemetry = vi.fn();
    recognizing?: (_: unknown, event: { result: { text: string } }) => void;
    recognized?: (_: unknown, event: { result: { text: string; reason: number } }) => void;
    canceled?: (_: unknown, event: { reason: number }) => void;
    sessionStopped?: () => void;
    close = vi.fn();
    startContinuousRecognitionAsync = vi.fn((done: () => void) => done());
    stopContinuousRecognitionAsync = vi.fn((done: () => void) => done());
    constructor() { recognizers.push(this); }
  }
  class FakeSpeaker {
    onAudioEnd?: () => void;
    pause = vi.fn();
    close = vi.fn();
    constructor() { speakers.push(this); }
  }
  class FakeSynthesizer {
    close = vi.fn();
    speakTextAsync = vi.fn((_text: string, done: (result: { reason: number }) => void) => done({ reason: 2 }));
    constructor() { synthesizers.push(this); }
  }
  const sdk = {
    SpeechConfig: { fromAuthorizationToken: vi.fn(() => { const config = {}; configs.push(config); return config; }) },
    AudioConfig: {
      fromDefaultMicrophoneInput: vi.fn(() => { const mic = { close: vi.fn() }; microphones.push(mic); return mic; }),
      fromSpeakerOutput: vi.fn(() => ({ close: vi.fn() })),
    },
    SpeechRecognizer: FakeRecognizer,
    SpeakerAudioDestination: FakeSpeaker,
    SpeechSynthesizer: FakeSynthesizer,
    ResultReason: { RecognizedSpeech: 1, SynthesizingAudioCompleted: 2 },
    CancellationReason: { Error: 1 },
  } as unknown as typeof import('microsoft-cognitiveservices-speech-sdk');
  return { sdk, configs, microphones, recognizers, speakers, synthesizers };
}

describe('real speech token client', () => {
  it('deduplicates concurrent calls and refreshes before expiry', async () => {
    let now = 0;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(token));
    const get = createSpeechTokenSource({ fetcher, now: () => now });
    const [first, second] = await Promise.all([get(), get()]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 509000;
    await get();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 510000;
    await get();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('rejects mock tokens and does not cache a failed authorization', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...token, token: 'mock-token-for-demo' }))
      .mockResolvedValueOnce(Response.json(token));
    const get = createSpeechTokenSource({ fetcher });
    await expect(get()).rejects.toMatchObject({ code: 'token' });
    await expect(get()).resolves.toEqual(token);
  });
});

describe('Azure microphone lifecycle', () => {
  it('joins final segments with partial text and emits one final turn on stop', async () => {
    const f = sdkFixture();
    const stt = new AzureSpeechStt({ getToken: async () => token, loadSdk: async () => f.sdk });
    const text = vi.fn();
    await stt.start('uz', text);
    const rec = f.recognizers[0];
    rec.recognized?.(null, { result: { text: 'Salom.', reason: 1 } });
    rec.recognizing?.(null, { result: { text: 'Qalaysiz' } });
    expect(text).toHaveBeenLastCalledWith('Salom. Qalaysiz', false);
    // Azure can deliver a final segment while stop drains the recognition stream.
    rec.stopContinuousRecognitionAsync.mockImplementationOnce((done) => {
      rec.recognized?.(null, { result: { text: 'Qalaysiz?', reason: 1 } });
      done();
    });
    await stt.stop();
    expect(text).toHaveBeenLastCalledWith('Salom. Qalaysiz?', true);
    expect(text.mock.calls.filter((call) => call[1] === true)).toHaveLength(1);
    expect(f.configs[0]).toMatchObject({ speechRecognitionLanguage: 'uz-UZ' });
    expect(rec.close).toHaveBeenCalledTimes(1);
    expect(f.microphones[0].close).toHaveBeenCalledTimes(1);
  });

  it('does not open a microphone after stop cancels a pending token request', async () => {
    const f = sdkFixture();
    let release!: (value: typeof token) => void;
    const stt = new AzureSpeechStt({
      loadSdk: async () => f.sdk,
      getToken: () => new Promise((resolve) => { release = resolve; }),
    });
    const starting = stt.start('uz', vi.fn());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await stt.stop();
    release(token);
    await starting;
    expect(f.recognizers).toHaveLength(0);
  });

  it('reports asynchronous service cancellation and frees microphone resources', async () => {
    const f = sdkFixture();
    const onError = vi.fn();
    const stt = new AzureSpeechStt({ getToken: async () => token, loadSdk: async () => f.sdk, onError });
    await stt.start('uz', vi.fn());
    f.recognizers[0].canceled?.(null, { reason: 1 });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'recognition' }));
    expect(f.microphones[0].close).toHaveBeenCalledTimes(1);
    await expect(stt.stop()).rejects.toMatchObject({ code: 'recognition' });
  });
});

describe('Azure speech playback', () => {
  it('waits for actual playback completion and uses an Uzbek neural voice', async () => {
    const f = sdkFixture();
    const tts = new AzureSpeechTts({ getToken: async () => token, loadSdk: async () => f.sdk });
    let completed = false;
    const speaking = tts.speak('Salom', 'uz').then(() => { completed = true; });
    await vi.waitFor(() => expect(f.synthesizers).toHaveLength(1));
    expect(completed).toBe(false);
    expect(f.configs[0]).toMatchObject({ speechSynthesisVoiceName: 'uz-UZ-MadinaNeural' });
    f.speakers[0].onAudioEnd?.();
    await speaking;
    expect(completed).toBe(true);
    expect(f.synthesizers[0].close).toHaveBeenCalledTimes(1);
  });

  it('cancel settles an active speak promise and stops its audio', async () => {
    const f = sdkFixture();
    const tts = new AzureSpeechTts({ getToken: async () => token, loadSdk: async () => f.sdk });
    const speaking = tts.speak('Salom', 'uz');
    await vi.waitFor(() => expect(f.speakers).toHaveLength(1));
    tts.cancel();
    await speaking;
    expect(f.speakers[0].pause).toHaveBeenCalledTimes(1);
    expect(f.speakers[0].close).toHaveBeenCalledTimes(1);
  });
});
