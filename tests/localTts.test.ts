import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalNeuralTts } from '../src/providers/localTts';

const wav = () => new Response(new Uint8Array(100), { headers: { 'Content-Type': 'audio/wav' } });
function fixture(fetcher: typeof fetch = vi.fn(async () => wav())) {
  const audio = { src: '', onended: null as (() => void) | null, onerror: null as (() => void) | null,
    play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() };
  const createAudio = vi.fn(() => audio as unknown as HTMLAudioElement);
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const provider = new LocalNeuralTts({ fetcher, createAudio });
  return { audio, createAudio, provider, fetcher, revoke };
}
afterEach(() => vi.restoreAllMocks());
describe('local neural voice lifecycle', () => {
  it('plays the actual returned audio and waits for playback to finish', async () => {
    const f = fixture(); let completed = false;
    const speaking = f.provider.speak('Menga yordam kerak.', 'uz').then(() => { completed = true; });
    await vi.waitFor(() => expect(f.audio.play).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    expect(f.fetcher).toHaveBeenCalledWith(new URL('http://127.0.0.1:8792/api/synthesize'), expect.objectContaining({
      credentials: 'omit', cache: 'no-store', body: JSON.stringify({ text: 'Menga yordam kerak.', language: 'uz' }),
    }));
    f.audio.onended?.(); await speaking; expect(completed).toBe(true); expect(f.revoke).toHaveBeenCalledOnce();
  });
  it('cancelling an in-flight request prevents late audio from playing', async () => {
    let respond!: (response: Response) => void;
    const f = fixture(vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const speaking = f.provider.speak('Salom.', 'uz');
    f.provider.cancel(); await speaking;
    respond(wav()); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.createAudio).not.toHaveBeenCalled();
    expect((f.fetcher as ReturnType<typeof vi.fn>).mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('stops and releases active playback when superseded', async () => {
    const f = fixture(); const speaking = f.provider.speak('Salom.', 'uz');
    await vi.waitFor(() => expect(f.audio.play).toHaveBeenCalledOnce());
    f.provider.cancel(); await speaking;
    expect(f.audio.pause).toHaveBeenCalledOnce(); expect(f.revoke).toHaveBeenCalledOnce();
    expect(f.audio.onended).toBe(null);
  });
  it('rejects unsupported languages and invalid server results without substituting speech', async () => {
    const f = fixture(vi.fn(async () => Response.json({ text: 'not audio' })));
    await expect(f.provider.speak('Hello.', 'en')).rejects.toMatchObject({ code: 'no_voice' });
    expect(f.fetcher).not.toHaveBeenCalled();
    await expect(f.provider.speak('Salom.', 'uz')).rejects.toMatchObject({ code: 'failed' });
    expect(f.createAudio).not.toHaveBeenCalled();
  });
});
