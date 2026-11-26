import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { handTracking, type HandFrame } from '../ml/handTracking';
import { useCamera } from '../state/CameraContext';
import { useConversation } from '../state/ConversationContext';

/** Movement controls a prepared recording; it does not recognize signs. */
export function MovementAudio() {
  const { lang } = useI18n();
  const camera = useCamera();
  const { state } = useConversation();
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(state.phase);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (camera.status !== 'live') return;
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;
    let index = 1, active = true, playing = false, complete = false;
    let lastMovement = -Infinity, reference: HandFrame | null = null, referenceAt = 0;
    let startPending = false;
    const source = () => `${import.meta.env.BASE_URL}audio/introduction/${index}.wav`;
    audio.src = source();
    const play = () => {
      if (!active || complete || busyRef.current || playing || startPending) return;
      startPending = true;
      void audio.play().then(() => {
        startPending = false;
        if (!active || busyRef.current || performance.now() - lastMovement > 1800) { audio.pause(); return; }
        playing = true; setBlocked(false);
      }, () => { startPending = false; if (active) setBlocked(true); });
    };
    audio.onended = () => {
      playing = false;
      if (index === 6) { complete = true; return; }
      index += 1; audio.src = source();
      if (performance.now() - lastMovement <= 1800) play();
    };
    const unsub = handTracking.subscribe((frame) => {
      if (!frame || (!frame.left && !frame.right)) { reference = null; return; }
      const now = performance.now();
      if (reference) {
        let total = 0, count = 0;
        for (const side of ['left', 'right'] as const) {
          const a = reference[side], b = frame[side];
          if (!a || !b) continue;
          for (const point of [0, 5, 8, 12, 16, 20]) {
            if (!a[point] || !b[point]) continue;
            total += Math.hypot(a[point].x - b[point].x, a[point].y - b[point].y); count++;
          }
        }
        if (count && total / count >= 0.014) { lastMovement = now; reference = frame; referenceAt = now; play(); }
        else if (now - referenceAt >= 250) { reference = frame; referenceAt = now; }
      } else { reference = frame; referenceAt = now; }
    });
    const timer = window.setInterval(() => {
      if ((performance.now() - lastMovement > 1800 || busyRef.current) && !audio.paused) {
        audio.pause(); playing = false;
      }
    }, 150);
    return () => {
      active = false; unsub(); clearInterval(timer); audio.onended = null; audio.pause();
      audio.removeAttribute('src'); audio.load(); audioRef.current = null; setBlocked(false);
    };
  }, [camera.status]);

  const unlock = () => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().then(() => setBlocked(false), () => setBlocked(true));
  };
  return <div className="small muted" role="status">
    {lang === 'uz' ? 'Namoyish: oldindan tayyorlangan ovoz' : lang === 'ru' ? 'Демонстрация: заранее подготовленная запись' : 'Demo: prepared audio'}
    {blocked && <button type="button" className="btn" onClick={unlock}>{lang === 'uz' ? 'Ovozni yoqish' : lang === 'ru' ? 'Включить звук' : 'Enable audio'}</button>}
  </div>;
}
