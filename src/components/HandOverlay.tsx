import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { handTracking, type HandFrame } from '../ml/handTracking';

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/**
 * Draws the tracked hand skeleton over the (mirrored) video. Drawing is imperative on a canvas,
 * so 30 updates per second never re-render React.
 */
export function HandOverlay() {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const [hand, setHand] = useState(0);

  useEffect(() => {
    let had = 0;
    const draw = (f: HandFrame | null) => {
      const c = ref.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, w, h);
      if (f) {
        // Match object-fit: contain, including letterboxing in a portrait camera.
        const scale = Math.min(w / f.width, h / f.height);
        const dw = f.width * scale, dh = f.height * scale;
        const ox = (w - dw) / 2, oy = (h - dh) / 2;
        for (const [hand, color] of [[f.left, '#5fd38a'], [f.right, '#68c8ff']] as const) {
        if (!hand) continue;
        const p = hand.map((l) => [ox + (1 - l.x) * dw, oy + l.y * dh]);
        g.lineWidth = 3;
        g.strokeStyle = color;
        g.beginPath();
        for (const [a, b] of BONES) {
          g.moveTo(p[a][0], p[a][1]);
          g.lineTo(p[b][0], p[b][1]);
        }
        g.stroke();
        g.fillStyle = '#ffffff';
        for (const [x, y] of p) {
          g.beginPath();
          g.arc(x, y, 3.5, 0, Math.PI * 2);
          g.fill();
        }
        }
      }
      const count = f ? Number(!!f.left) + Number(!!f.right) : 0;
      if (count !== had) {
        had = count;
        setHand(had);
      }
    };
    draw(handTracking.latest());
    return handTracking.subscribe(draw);
  }, []);

  return (
    <>
      <canvas ref={ref} className="hand-overlay" aria-hidden="true" />
      <span className={`pill hand-pill ${hand ? 'on' : ''}`}>{hand ? t('hand.count', { n: hand }) : t('hand.no')}</span>
    </>
  );
}
