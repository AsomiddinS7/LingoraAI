import { useEffect, useRef } from 'react';
import { glossFor } from '../data';
import { useI18n } from '../i18n';
import { startFpsMeter } from '../pipeline/framePump';
import { metrics, useMetrics } from '../pipeline/metrics';
import { useRuntime } from '../runtime';
import { useCamera } from '../state/CameraContext';
import { useSignWindow, type SignWindowValue } from '../state/SignWindowContext';
import { HandOverlay } from './HandOverlay';
import { Icon } from './Icon';

/** Camera with permission flow, landmark overlay and a visible state for every window phase. */
export type CameraController = Pick<SignWindowValue, 'ensure' | 'cancel' | 'setVideo' | 'win'>;
export function CameraPanel({ controller, recognizedText }: { controller?: CameraController; recognizedText?: string } = {}) {
  const { t, lang } = useI18n();
  const cam = useCamera();
  const defaultController = useSignWindow();
  const sw = controller ?? defaultController;
  const videoRef = useRef<HTMLVideoElement>(null);
  useMetrics();
  const configuredRecognizer = useRuntime((s) => s.config.recognizer);
  const recognizer = controller ? 'motion' : configuredRecognizer;

  // Load the recognizer lazily when a camera screen is shown (first load stays small).
  useEffect(() => {
    sw.ensure();
  }, [sw.ensure]);

  // Auto-start only when permission is already granted, so the browser prompt is never a surprise.
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query?.({ name: 'camera' as PermissionName })
      .then((r) => !cancelled && r.state === 'granted' && cam.status === 'off' && void cam.start())
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen turns the camera off and cancels a running window.
  useEffect(
    () => () => {
      cam.stop();
      sw.cancel();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = cam.stream;
    if (cam.stream) {
      v.play().catch(() => {});
      sw.setVideo(v);
    } else sw.setVideo(null);
    return () => sw.setVideo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam.stream]);

  // Measure the frame rate the camera really delivers.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cam.stream) return;
    const stop = startFpsMeter(v, (fps) => metrics.set({ cameraFps: fps }));
    return () => {
      stop();
      metrics.set({ cameraFps: null });
    };
  }, [cam.stream]);

  const live = cam.status === 'live';
  const phase = sw.win.phase;
  const recognized = phase === 'result' && sw.win.outcome === 'recognized' && sw.win.selected;

  return (
    <section aria-label={t('camera.region')}>
      <div className={`camera phase-${phase}${recognized ? ' detected' : ''}`}>
        <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" style={{ display: live ? 'block' : 'none' }} />
        {!live && <CameraMessage />}
        {live && (
          <>
            {(recognizer === 'static' || recognizer === 'motion') && phase !== 'loading' && phase !== 'unavailable' && <HandOverlay />}
            <div className="camera-overlay top">
              <span className="pill" title={t('camera.privacy')}>
                <Icon name="lock" />
                {t('camera.onDevice')}
                {recognizer === 'mock' && ` · ${t('camera.demo')}`}
              </span>
              {(phase === 'countdown' || phase === 'recording') && (
                <span className={`pill phase-pill ${phase}`}>{phase === 'recording' ? t('win.recShort') : t('win.countdownShort')}</span>
              )}
            </div>
            {recognized && (
              <div className="detect-banner" aria-hidden="true" style={recognizedText ? { width: 'calc(100% - 24px)', maxHeight: '70%', overflow: 'auto', fontSize: '1rem', borderRadius: 12, padding: 12 } : undefined}>
                <Icon name="check" />
                <span>{recognizedText ?? glossFor(sw.win.selected!, lang)}</span>
              </div>
            )}
            <button type="button" className="icon-btn cam-off" onClick={cam.stop} aria-label={t('camera.stop')} title={t('camera.stop')}>
              <Icon name="x" />
            </button>
          </>
        )}
      </div>
      {live && <p className="small muted">{t('camera.framing')}</p>}
    </section>
  );
}

function CameraMessage() {
  const { t } = useI18n();
  const cam = useCamera();
  switch (cam.status) {
    case 'requesting':
      return (
        <div className="camera-msg" role="status">
          <div className="spinner" style={{ margin: '0 auto 12px' }} aria-hidden="true" />
          <p>{t('camera.requesting')}</p>
        </div>
      );
    case 'denied':
      return (
        <div className="camera-msg" role="alert">
          <h3>{t('camera.denied.title')}</h3>
          <p>{t('camera.denied.body')}</p>
          <button type="button" className="btn" onClick={() => void cam.start()}>
            <Icon name="refresh" />
            {t('camera.start')}
          </button>
        </div>
      );
    case 'notFound':
    case 'unsupported':
    case 'error':
      return (
        <div className="camera-msg" role="alert">
          <p>{t(cam.status === 'notFound' ? 'camera.notFound' : cam.status === 'unsupported' ? 'camera.unsupported' : 'camera.error')}</p>
          <button type="button" className="btn" onClick={() => void cam.start()}>
            <Icon name="refresh" />
            {t('common.retry')}
          </button>
        </div>
      );
    default:
      return (
        <div className="camera-msg">
          <p>{t('camera.off')}</p>
          <button type="button" className="btn btn-lg" onClick={() => void cam.start()}>
            <Icon name="camera" />
            {t('camera.start')}
          </button>
        </div>
      );
  }
}
