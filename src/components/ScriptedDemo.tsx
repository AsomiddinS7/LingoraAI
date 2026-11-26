import { useEffect, useMemo, useState } from 'react';
import { PRESENTATION_TEXT } from '../data/presentation';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';

/** Timed presentation text. It deliberately does not consume camera data. */
export function ScriptedDemo() {
  const { lang } = useI18n();
  const say = (uz: string, en: string, ru: string) => lang === 'uz' ? uz : lang === 'ru' ? ru : en;
  const conversation = useConversation();
  const [text, setText] = useState(PRESENTATION_TEXT);
  const [seconds, setSeconds] = useState(3);
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);
  const words = useMemo(() => text.trim().split(/\s+/u).filter(Boolean), [text]);
  const visible = words.slice(0, shown).join(' ');
  const finished = words.length > 0 && shown >= words.length;

  useEffect(() => {
    if (!running || finished || !words.length) return;
    const timer = window.setInterval(() => setShown(current => Math.min(current + 1, words.length)), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [running, finished, seconds, words.length]);
  useEffect(() => { if (finished) setRunning(false); }, [finished]);

  const start = () => {
    if (!words.length) return;
    if (finished) setShown(0);
    setRunning(true);
  };
  const reset = () => { setRunning(false); setShown(0); };
  return <section className="card stack" aria-labelledby="scripted-demo-title">
    <h2 id="scripted-demo-title">{say('Tayyor matn namoyishi', 'Scripted text demonstration', 'Демонстрация готового текста')}</h2>
    <p className="notice info">{say('Bu oldindan kiritilgan matn. So‘zlar vaqt bo‘yicha chiqadi; kamera ishoralarni tarjima qilmaydi.',
      'This is prepared text. Words appear on a timer; the camera is not translating signs.',
      'Это заранее введённый текст. Слова появляются по таймеру; камера не переводит жесты.')}</p>
    <label htmlFor="scripted-demo-text">{say('Namoyish matni', 'Demonstration text', 'Текст демонстрации')}</label>
    <textarea id="scripted-demo-text" rows={5} maxLength={5000} value={text} disabled={running}
      onChange={event => { setText(event.target.value); setShown(0); }} />
    <label htmlFor="scripted-demo-speed">{say('Har bir so‘z oralig‘i (soniya)', 'Seconds per word', 'Секунд на слово')}</label>
    <input id="scripted-demo-speed" type="number" min="0.5" max="10" step="0.5" value={seconds} disabled={running}
      onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) setSeconds(Math.min(10, Math.max(.5, value))); }} />
    <div className="btn-row">
      {!running ? <button type="button" className="btn btn-primary" disabled={!words.length} onClick={start}>
        {shown > 0 && !finished ? say('Davom ettirish', 'Resume', 'Продолжить') : say('Namoyishni boshlash', 'Start demonstration', 'Начать демонстрацию')}
      </button> : <button type="button" className="btn" onClick={() => setRunning(false)}>{say('Pauza', 'Pause', 'Пауза')}</button>}
      <button type="button" className="btn" onClick={reset}>{say('Qaytadan', 'Reset', 'Сбросить')}</button>
      <button type="button" className="btn" disabled={!visible || running} onClick={() => void conversation.speakDirect(visible, 'uz')}>
        {say('Ko‘rsatilgan matnni ovozga aylantirish', 'Read displayed text aloud', 'Озвучить показанный текст')}
      </button>
    </div>
    <p className="small muted" role="status">{say('Tayyor matn', 'Prepared text', 'Готовый текст')} · {shown}/{words.length}</p>
    <p className="result-text" lang="uz" aria-live="polite" data-testid="scripted-demo-output">{visible}</p>
  </section>;
}
