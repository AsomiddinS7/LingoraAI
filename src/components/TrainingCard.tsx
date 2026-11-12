// Records training samples for the real recognizer: hand landmarks only, never video.
import { useEffect, useRef, useState } from 'react';
import { VOCABULARY } from '../data';
import { useI18n } from '../i18n';
import { handTracking, loadHandLandmarker } from '../ml/handTracking';
import { sampleStore, useSampleVersion } from '../ml/samples';
import { useRuntime } from '../runtime';
import { useCamera } from '../state/CameraContext';
import { HandOverlay } from './HandOverlay';
import { Icon } from './Icon';

type Phase = { kind: 'idle' } | { kind: 'countdown'; n: number } | { kind: 'recording' } | { kind: 'saved'; n: number; label: string } | { kind: 'nohand' };

export function TrainingCard() {
  const { t, lang } = useI18n();
  const cam = useCamera();
  const policy = useRuntime((s) => s.config.dataCollection);
  useSampleVersion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tracker, setTracker] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [label, setLabel] = useState(VOCABULARY[0]?.label ?? '');
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const counts = sampleStore.counts();

  useEffect(() => {
    loadHandLandmarker().then(
      () => setTracker('ready'),
      () => setTracker('failed'),
    );
  }, []);

  useEffect(() => () => cam.stop(), [cam.stop]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cam.stream || tracker !== 'ready') return;
    v.srcObject = cam.stream;
    v.play().catch(() => {});
    return handTracking.acquire(v);
  }, [cam.stream, tracker]);

  const record = async () => {
    for (let n = 3; n > 0; n--) {
      setPhase({ kind: 'countdown', n });
      await new Promise((r) => setTimeout(r, 1000));
    }
    setPhase({ kind: 'recording' });
    const vecs: number[][] = [];
    const unsub = handTracking.subscribe((f) => f && vecs.push(f.features));
    await new Promise((r) => setTimeout(r, 1500));
    unsub();
    if (vecs.length < 8) {
      setPhase({ kind: 'nohand' });
      return;
    }
    sampleStore.addTake(label, vecs);
    setPhase({ kind: 'saved', n: vecs.length, label });
  };

  const download = () => {
    const blob = new Blob([sampleStore.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `signconnect-landmarks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const live = cam.status === 'live';
  const busy = phase.kind === 'countdown' || phase.kind === 'recording';
  const gloss = (l: string) => VOCABULARY.find((v) => v.label === l)?.gloss[lang] ?? l;

  return (
    <section className="card span-2" aria-labelledby="train">
      <h2 id="train">{t('train.title')}</h2>
      <p className="small">{t('train.intro')}</p>
      <p className="small muted">{t('console.data.policy', { policy })} · {t('train.hint')}</p>
      <div className="train-grid">
        <div>
          <div className="camera" style={{ aspectRatio: '4 / 3' }}>
            <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" style={{ display: live ? 'block' : 'none' }} />
            {live && tracker === 'ready' && <HandOverlay />}
            {!live && (
              <div className="camera-msg">
                <p>{t('train.cameraNeeded')}</p>
                <button type="button" className="btn" onClick={() => void cam.start()}>
                  <Icon name="camera" />
                  {t('camera.start')}
                </button>
              </div>
            )}
            {busy && (
              <div className="detect-banner" style={{ background: phase.kind === 'recording' ? '#a1261b' : '#0b5c55' }}>
                {phase.kind === 'countdown' ? t('train.countdown', { n: phase.n }) : t('train.recording')}
              </div>
            )}
          </div>
          {tracker === 'loading' && <p className="small muted">{t('train.loading')}</p>}
          {tracker === 'failed' && (
            <div className="notice bad" role="alert">
              <Icon name="alert" />
              <p>{t('train.failed')}</p>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="field">
            <label htmlFor="train-label">{t('console.data.label')}</label>
            <select id="train-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy}>
              {VOCABULARY.map((v) => (
                <option key={v.label} value={v.label}>{`${v.gloss[lang]} (${v.label})`}</option>
              ))}
            </select>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            {t('console.data.consent')}
          </label>
          <button type="button" className="btn btn-primary btn-lg" disabled={!consent || !live || tracker !== 'ready' || busy} onClick={() => void record()}>
            <Icon name="hand" />
            {t('train.record')}
          </button>
          <div aria-live="polite">
            {phase.kind === 'saved' && <p className="small" style={{ color: 'var(--ok)', fontWeight: 700 }}>{t('train.saved', { n: phase.n, label: gloss(phase.label) })}</p>}
            {phase.kind === 'nohand' && <p className="small" style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('train.noHand')}</p>}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('train.table.sign')}</th>
                <th scope="col">{t('train.table.takes')}</th>
                <th scope="col">{t('train.table.frames')}</th>
              </tr>
            </thead>
            <tbody>
              {VOCABULARY.map((v) => (
                <tr key={v.label}>
                  <td>{v.gloss[lang]}</td>
                  <td>{counts[v.label]?.takes ?? 0}</td>
                  <td>{counts[v.label]?.frames ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row">
            <button type="button" className="btn" onClick={download} disabled={sampleStore.all().length === 0}>
              <Icon name="download" />
              {t('console.data.export')}
            </button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {t('train.import')}
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const n = sampleStore.importJson(await f.text(), VOCABULARY.map((v) => v.label));
                    setImportMsg(t('train.importOk', { n }));
                  } catch {
                    setImportMsg(t('train.importBad'));
                  }
                }}
              />
            </label>
            <button type="button" className="btn btn-danger" onClick={() => sampleStore.clear()} disabled={sampleStore.all().length === 0}>
              {t('train.clear')}
            </button>
          </div>
          {importMsg && <p className="small" role="status">{importMsg}</p>}
        </div>
      </div>
    </section>
  );
}
