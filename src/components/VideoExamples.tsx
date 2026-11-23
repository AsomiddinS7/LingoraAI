import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { glossFor, vocabulary, vocabLabels, useCatalog } from '../data';
import { useI18n } from '../i18n';
import { sequenceStore, type SequenceStore } from '../ml/sequenceStore';
import { extractVideoSequence } from '../ml/videoSequence';
import { normalizeSequence, TEMPLATE_LIMITS, type MotionTemplate } from '../ml/sequence';
import { runtime } from '../runtime';
import { useCamera } from '../state/CameraContext';
import { useSignWindow } from '../state/SignWindowContext';
import { href } from '../router';
import type { Lang } from '../types';

export interface VideoExampleEntry { label: string; gloss: Record<Lang, string> }

/** Prepare examples from already-recorded footage. This screen never records a camera. */
export function VideoExamples({ store = sequenceStore, entries, onReady, maxSeconds = 12 }: {
  store?: SequenceStore; entries?: readonly VideoExampleEntry[]; onReady?: () => void; maxSeconds?: number;
} = {}) {
  const { t, lang } = useI18n();
  useCatalog();
  useSyncExternalStore(store.subscribe, store.version, store.version);
  const camera = useCamera();
  const signWindow = useSignWindow();
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrl = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [filename, setFilename] = useState('');
  const [ready, setReady] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(2);
  const [label, setLabel] = useState(entries?.[0]?.label ?? 'hello');
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const counts = store.counts();
  const labels = Object.keys(counts);
  const busy = progress !== null;
  const options = entries ?? vocabulary();
  const displayLabel = (id: string) => entries?.find((entry) => entry.label === id)?.gloss[lang] ?? glossFor(id, lang);

  useEffect(() => () => {
    abort.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);
  const message = (text: string, error = false) => { setStatus(text); setFailed(error); };
  const chooseVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 500_000_000) { message(t('video.tooLarge'), true); return; }
    camera.stop(); signWindow.cancel();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setReady(false); setConfirmed(false); setFilename(file.name); setStart(0); setEnd(2); message('');
    const video = videoRef.current;
    if (video) { video.src = objectUrl.current; video.load(); }
  };
  const extract = async () => {
    const video = videoRef.current;
    if (!video || !ready || busy || (entries && !confirmed)) return;
    camera.stop(); signWindow.cancel();
    abort.current = new AbortController();
    setProgress(0); message('');
    try {
      // Let camera ownership detach before using the same local tracking models.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const frames = await extractVideoSequence(video, start, end, {
        signal: abort.current.signal, onProgress: setProgress, maxSeconds,
      });
      if (!normalizeSequence(frames)) throw new Error('tracking');
      const example: MotionTemplate = {
        id: `video-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        label, frames,
        source: { kind: 'recording', name: `${filename} [${start.toFixed(2)}-${end.toFixed(2)}s]` },
      };
      store.replace([...store.all(), example]);
      if (store === sequenceStore) runtime.setConfig({ recognizer: 'motion' });
      onReady?.();
      message(t('video.added', { sign: displayLabel(label), frames: frames.length }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') message(t('video.cancelled'));
      else message(t('video.extractFailed'), true);
    } finally { abort.current = null; setProgress(null); }
  };
  const importExamples = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > TEMPLATE_LIMITS.bytes) throw new Error('size');
      const n = store.importJson(await file.text(), entries?.map((entry) => entry.label) ?? vocabLabels());
      if (store === sequenceStore) runtime.setConfig({ recognizer: 'motion' });
      onReady?.();
      message(t('video.imported', { n }));
    } catch { message(t('video.importFailed'), true); }
    input.value = '';
  };
  const exportExamples = () => {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = entries ? 'lingora-signed-speech-examples.json' : 'lingora-video-examples.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="card span-2 video-examples" aria-labelledby="video-examples-title">
      <div className="card-title">
        <h2 id="video-examples-title">{t('video.title')}</h2>
        <span className="small muted">{t('video.count', { n: store.all().length, signs: labels.length })}</span>
      </div>
      <p>{t('video.description')}</p>
      <p className="small muted">{t('video.private')}</p>
      <div className="btn-row">
        <label className="btn file-button">{t('video.open')}<input type="file" accept="video/*" disabled={busy} onChange={chooseVideo} /></label>
        <label className="btn file-button">{t('video.import')}<input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => void importExamples(e)} /></label>
        <button type="button" className="btn" disabled={!labels.length || busy} onClick={exportExamples}>{t('video.export')}</button>
        <button type="button" className="btn btn-quiet" disabled={!labels.length || busy} onClick={() => { store.clear(); message(t('video.cleared')); }}>{t('video.clear')}</button>
      </div>
      <video ref={videoRef} controls playsInline className="source-video" hidden={!filename}
        onLoadedMetadata={() => { setReady(true); setEnd(Math.min(2, videoRef.current?.duration ?? 2)); }}
        onError={() => { setReady(false); message(t('video.decodeFailed'), true); }} />
      {filename && <p className="small muted source-filename">{filename}</p>}
      {ready && (
        <fieldset className="video-fields" disabled={busy}>
          <legend>{t('video.selectInterval')}</legend>
          <label>{t('video.meaning')}<select className="input" value={label} onChange={(e) => { setLabel(e.target.value); setConfirmed(false); }}>
            {options.map((entry) => <option key={entry.label} value={entry.label}>{entry.gloss[lang]}</option>)}
          </select></label>
          <label>{t('video.start')}<input className="input" type="number" min="0" step="0.01" value={start} onChange={(e) => { setStart(Number(e.target.value)); setConfirmed(false); }} /></label>
          <button type="button" className="btn" onClick={() => { setStart(videoRef.current?.currentTime ?? 0); setConfirmed(false); }}>{t('video.markStart')}</button>
          <label>{t('video.end')}<input className="input" type="number" min="0" step="0.01" value={end} onChange={(e) => { setEnd(Number(e.target.value)); setConfirmed(false); }} /></label>
          <button type="button" className="btn" onClick={() => { setEnd(videoRef.current?.currentTime ?? 0); setConfirmed(false); }}>{t('video.markEnd')}</button>
          {entries && <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{lang === 'uz' ? 'Tanlangan video oralig‘i aynan shu jumlani ifodalashini tekshirdim.' : lang === 'ru' ? 'Я проверил(а), что выбранный фрагмент соответствует этой фразе.' : 'I verified that this video interval signs this exact phrase.'}</label>}
          {entries && <p className="small muted">{lang === 'uz' ? `Har bir oraliq: 0,3–${maxSeconds} soniya.` : lang === 'ru' ? `Длительность фрагмента: 0,3–${maxSeconds} секунд.` : `Each interval: 0.3–${maxSeconds} seconds.`}</p>}
          <button type="button" className="btn btn-primary" disabled={end - start < 0.3 || end - start > maxSeconds || (Boolean(entries) && !confirmed)} onClick={() => void extract()}>{t('video.extract')}</button>
        </fieldset>
      )}
      {busy && <div className="video-progress" role="status"><progress max="1" value={progress ?? 0} /><span>{t('video.progress', { n: Math.round((progress ?? 0) * 100) })}</span><button type="button" className="btn" onClick={() => abort.current?.abort()}>{t('common.cancel')}</button></div>}
      {status && <p className={`notice ${failed ? 'bad' : 'info'}`} role={failed ? 'alert' : 'status'}>{status}</p>}
      {labels.length > 0 ? <ul className="example-counts">{labels.map((id) => <li key={id}><span>{displayLabel(id)}</span><span>{t('video.examples', { n: counts[id] })}</span></li>)}</ul>
        : <p className="notice info">{t('video.empty')}</p>}
      <p className="small muted">{t('video.limitations')}</p>
      {!entries && <a className="btn" href={href('conversation')}>{t('video.tryCamera')}</a>}
    </section>
  );
}
