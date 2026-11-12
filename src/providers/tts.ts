// TtsProvider implementations. Browser speech synthesis now; the team adds Azure Speech later.
import type { Lang, TtsProvider } from '../types';

export type TtsErrorCode = 'no_voice' | 'unsupported' | 'failed';

export class TtsError extends Error {
  constructor(public code: TtsErrorCode) {
    super(code);
    this.name = 'TtsError';
  }
}

const LOCALES: Record<Lang, string> = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };

function loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  // Chrome fills the list asynchronously.
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1200);
  });
}

export async function hasVoiceFor(lang: Lang): Promise<boolean> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const voices = await loadVoices(window.speechSynthesis);
  return voices.some((v) => v.lang.toLowerCase().startsWith(lang));
}

export class BrowserSynthesisTts implements TtsProvider {
  async speak(text: string, lang: Lang): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) throw new TtsError('unsupported');
    const synth = window.speechSynthesis;
    const voices = await loadVoices(synth);
    const voice = voices.find((v) => v.lang.toLowerCase().startsWith(lang));
    // Brief section 5: if there is no Uzbek or Russian voice, show the text and say so.
    if (!voice) throw new TtsError('no_voice');
    synth.cancel();
    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang || LOCALES[lang];
      u.rate = 0.95;
      // Some Chrome builds never fire onend; never leave the conversation stuck in SPEAKING.
      const guard = setTimeout(resolve, 4000 + text.length * 150);
      u.onend = () => {
        clearTimeout(guard);
        resolve();
      };
      u.onerror = (e) => {
        clearTimeout(guard);
        if (e.error === 'interrupted' || e.error === 'canceled') resolve();
        else reject(new TtsError('failed'));
      };
      synth.speak(u);
    });
  }

  cancel(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}
