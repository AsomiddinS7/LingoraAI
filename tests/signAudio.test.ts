import { afterEach, expect, it, vi } from 'vitest';
import { SignAudioTts } from '../src/providers/signAudio';

afterEach(() => { vi.unstubAllGlobals(); });

it('speaks each exact Uzbek trial word using its own clip and waits for playback', async () => {
  const created: { src: string; onended: (() => void) | null; onerror: (() => void) | null; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('Audio', class {
    onended = null; onerror = null; play = vi.fn(async () => {}); pause = vi.fn();
    constructor(public src: string) { created.push(this); }
  });
  const fallback = { speak: vi.fn(async () => {}), cancel: vi.fn() };
  const voice = new SignAudioTts(fallback);
  for (const [word, file] of [['Salom.', 'hello'], ['Xayr.', 'goodbye'], ['Iltimos.', 'please']]) {
    const playing = voice.speak(word, 'uz');
    const audio = created.at(-1)!;
    expect(audio.src).toContain(`/audio/signs/${file}.wav`);
    expect(audio.play).toHaveBeenCalledOnce();
    audio.onended?.();
    await playing;
  }
  expect(fallback.speak).not.toHaveBeenCalled();
  await voice.speak('Yordam.', 'uz');
  expect(fallback.speak).toHaveBeenCalledWith('Yordam.', 'uz');
});
