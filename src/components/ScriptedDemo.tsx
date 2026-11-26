import { useEffect, useMemo, useRef, useState } from 'react';
import { PRESENTATION_TEXT } from '../data/presentation';
import preparedAudioCues from '../data/preparedAudioCues.json';
import { useI18n } from '../i18n';
import { getTts } from '../providers';
import { useRuntime } from '../runtime';
import { useConversation } from '../state/ConversationContext';

class PreparedVoice {
  private finish?: (error?: Error) => void;
  speak(text: string, _language: string): Promise<void> {
    const index = preparedAudioCues.indexOf(text);
    if (index < 0) return Promise.reject(new Error('Unknown prepared audio'));
    this.cancel();
    return new Promise((resolve, reject) => {
      const audio = new Audio(`${import.meta.env.BASE_URL}audio/introduction/${index + 1}.wav`);
      let closed = false;
      const finish = (error?: Error) => {
        if (closed) return;
        closed = true;
        audio.onended = audio.onerror = null;
        audio.pause();
        if (this.finish === finish) this.finish = undefined;
        if (error) reject(error); else resolve();
      };
      this.finish = finish;
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error('Playback failed'));
      void audio.play().catch(() => finish(new Error('Playback failed')));
    });
  }
  cancel() { this.finish?.(); }
}

/** Split on sentence boundaries and respect the hosted voice's 300-character limit. */
export function speechChunks(text: string): string[] {
  const sentences = text.trim().match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? [];
  const result: string[] = [];
  for (const sentence of sentences) {
    let current = '';
    for (const word of sentence.trim().split(/\s+/u).filter(Boolean)) {
      if (current && current.length + word.length + 1 > 300) { result.push(current); current = ''; }
      let rest = word;
      while (rest.length > 300) { result.push(rest.slice(0, 300)); rest = rest.slice(300); }
      if (rest) current = current ? `${current} ${rest}` : rest;
    }
    if (current) result.push(current);
  }
  return result;
}

/** Speaks prepared text on a timer. It does not consume camera data. */
export function ScriptedDemo() {
  const { lang } = useI18n();
  const say = (uz: string, en: string, ru: string) => lang === 'uz' ? uz : lang === 'ru' ? ru : en;
  const conversation = useConversation();
  const phase = useRef(conversation.state.phase);
  phase.current = conversation.state.phase;
  const settings = useRef<HTMLDetailsElement>(null);
  const config = useRuntime(s => s.config);
  const [text, setText] = useState(PRESENTATION_TEXT);
  const preparedVoice = useMemo(() => new PreparedVoice(), []);
  const onlineVoice = useMemo(() => getTts(config).provider, [config]);
  const isBundled = text.trim() === preparedAudioCues.join(' ');
  const voice = isBundled ? preparedVoice : onlineVoice;
  const [seconds, setSeconds] = useState(3);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const chunks = useMemo(() => speechChunks(text), [text]);
  const finished = chunks.length > 0 && index >= chunks.length;
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conversation.state.phase);

  useEffect(() => {
    if (!running || finished || !chunks.length) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void voice.speak(chunks[index], 'uz').then(() => {
        if (alive) setIndex(current => current + 1);
      }, () => {
        if (alive) { setError(true); setRunning(false); }
      });
    }, index === 0 ? seconds * 1000 : 0);
    return () => { alive = false; window.clearTimeout(timer); if (phase.current !== 'SPEAKING') voice.cancel(); };
  }, [running, finished, index, seconds, chunks, voice]);
  useEffect(() => { if (finished || (running && busy)) setRunning(false); }, [finished, busy, running]);

  const start = () => {
    if (!chunks.length || busy) return;
    if (finished) setIndex(0);
    if (settings.current) settings.current.open = false;
    setError(false); setRunning(true);
  };
  const reset = () => { setRunning(false); setIndex(0); setError(false); };
  return <section className="card stack" aria-label={say('Tayyor matn', 'Prepared text', 'Готовый текст')}>
    <p className="notice info">{say('Bu oldindan kiritilgan matn ovozi. Kamera ishoralarni tarjima qilmaydi.',
      'This audio reads prepared text; the camera is not translating signs.',
      'Это озвученный заранее подготовленный текст; камера не переводит жесты.')}</p>
    <details ref={settings}>
      <summary>{say('Matn va vaqtni sozlash', 'Edit text and timing', 'Изменить текст и время')}</summary>
      <label htmlFor="scripted-demo-text">{say('Tayyor matn', 'Prepared text', 'Готовый текст')}</label>
      <textarea id="scripted-demo-text" rows={5} maxLength={5000} value={text} disabled={running}
        onChange={event => { setText(event.target.value); setIndex(0); setError(false); }} />
      <p className="small muted">{say('Standart matn tayyor ovozdan foydalanadi. O‘zgartirilgan matn uchun onlayn ovoz xizmati kerak.',
        'The default text uses prepared audio. Edited text requires the online voice service.',
        'Для стандартного текста используется готовая запись. Для изменённого текста нужен онлайн-сервис.')}</p>
      <label htmlFor="scripted-demo-speed">{say('Boshlashdan oldingi vaqt (soniya)', 'Start delay (seconds)', 'Задержка перед началом (секунды)')}</label>
      <input id="scripted-demo-speed" type="number" min="0.5" max="10" step="0.5" value={seconds} disabled={running}
        onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setSeconds(Math.min(10, Math.max(.5, value))); }} />
    </details>
    <div className="btn-row">
      {!running ? <button type="button" className="btn btn-primary" disabled={!chunks.length || busy} onClick={start}>
        {index > 0 && !finished ? say('Davom ettirish', 'Resume', 'Продолжить') : say('Ovozni boshlash', 'Start audio', 'Воспроизвести')}
      </button> : <button type="button" className="btn" onClick={() => setRunning(false)}>{say('Pauza', 'Pause', 'Пауза')}</button>}
      <button type="button" className="btn" onClick={reset}>{say('Qaytadan', 'Reset', 'Сбросить')}</button>
    </div>
    <p className="small muted" role="status">{say('Tayyor audio', 'Prepared audio', 'Готовое аудио')} · {index}/{chunks.length}</p>
    {error && <p className="notice warn" role="alert">{say('Ovoz ijro etilmadi. Qurilma ovozini tekshiring; o‘zgartirilgan matn uchun onlayn xizmat mavjudligini tekshiring.',
      'Audio could not be played. Check your device sound; edited text also needs the online voice service.',
      'Не удалось воспроизвести звук. Проверьте звук и повторите попытку.')}</p>}
  </section>;
}
