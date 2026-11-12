import { useEffect, useRef, useState } from 'react';
import { glossFor } from '../data';
import { startFpsMeter } from '../pipeline/framePump';
import { metrics, useMetrics } from '../pipeline/metrics';
import { useI18n, type MessageKey } from '../i18n';
import { useCamera } from '../state/CameraContext';
import { useConversation } from '../state/ConversationContext';
import { Icon } from './Icon';
import { StatusChip } from './StatusChip';
import { HandOverlay } from './HandOverlay';
import { sampleStore, useSampleVersion } from '../ml/samples';
import { useRuntime } from '../runtime';
import { href } from '../router';

/** CameraPanel: live preview, permission flow and every camera/classifier failure state (F1, N2). */
export function CameraPanel() {
  const { t, lang } = useI18n();
  const cam = useCamera();
  const conv = useConversation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const perf = useMetrics();
  const realModel = useRuntime((s) => s.config.signClassifier === 'mediapipe');
  useSampleVersion();
  const untrained = realModel && sampleStore.all().length === 0;

  // Measure the frame rate the camera really delivers (one callback per decoded frame).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cam.stream) return;
    const stop = startFpsMeter(v, (fps) => metrics.set({ cameraFps: fps }));
    return () => {
      stop();
      metrics.set({ cameraFps: null });
    };
  }, [cam.stream]);

  // Visual indicator: flash the frame and show the label the moment a gesture is detected.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidateAt = conv.state.candidate?.at;
  useEffect(() => {
    const c = conv.state.candidate;
    if (!c) return; // accepting/discarding must not cancel the hide timer
    setFlash(glossFor(c.label, lang));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateAt]);
  useEffect(() => () => void (flashTimer.current && clearTimeout(flashTimer.current)), []);

  // Load the classifier lazily once a camera screen is shown (N1).
  useEffect(() => conv.ensureClassifier(), [conv.ensureClassifier]);

  // Auto-start only when permission is already granted, so the browser prompt is never a surprise.
  useEffect(() => {
    let cancelled = false;
    const p = navigator.permissions?.query?.({ name: 'camera' as PermissionName });
    p?.then((r) => !cancelled && r.state === 'granted' && cam.status === 'off' && void cam.start()).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen turns the camera off and ends signing that can no longer be seen.
  const phaseRef = useRef(conv.state.phase);
  phaseRef.current = conv.state.phase;
  useEffect(
    () => () => {
      cam.stop();
      if (phaseRef.current === 'SIGNER_LISTENING' || phaseRef.current === 'CONFIRM_SIGN') conv.dispatch({ type: 'STOP' });
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
      conv.setVideo(v);
    } else conv.setVideo(null);
    return () => conv.setVideo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam.stream]);

  const live = cam.status === 'live';

  return (
    <section aria-label={t('camera.region')}>
      <div className={`camera${flash ? ' detected' : ''}`}>
        <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" style={{ display: live ? 'block' : 'none' }} />

        {!live && <CameraMessage />}

        {live && (
          <>
            <div className="camera-overlay top">
              <span className="pill">
                <span className="dot" aria-hidden="true" />
                {perf.cameraFps === null ? t('camera.region') : t('camera.fps', { fps: Math.round(perf.cameraFps) })}
                {perf.classifier === 'mock' && ` · ${t('perf.mockShort')}`}
              </span>
              {conv.faceHint && <span className="pill">{t('hint.label', { hint: t(`hint.${conv.faceHint}` as MessageKey) })}</span>}
            </div>
            {realModel && conv.classifierStatus === 'ready' && <HandOverlay />}
            {flash && (
              <div className="detect-banner" aria-hidden="true">
                <Icon name="check" />
                <span>{flash}</span>
              </div>
            )}
            <div className="camera-overlay bottom">
              <button type="button" className="btn" onClick={cam.stop}>
                <Icon name="stop" />
                {t('camera.stop')}
              </button>
            </div>
          </>
        )}
      </div>
      <p className="camera-privacy muted">
        <Icon name="lock" />
        {t('camera.privacy')}
      </p>
      <ClassifierState />
      {untrained && (
        <div className="notice warn" role="status">
          <Icon name="info" />
          <p>
            <a href={href('console')}>{t('train.noModel')}</a>
          </p>
        </div>
      )}
      {live && <StatusChip />}
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

function ClassifierState() {
  const { t } = useI18n();
  const { classifierStatus, retryClassifier } = useConversation();
  if (classifierStatus === 'loading')
    return (
      <div className="notice info" role="status">
        <div className="spinner" aria-hidden="true" />
        <p>{t('classifier.loading')}</p>
      </div>
    );
  if (classifierStatus === 'failed')
    return (
      <div className="notice bad" role="alert">
        <Icon name="alert" />
        <div>
          <strong>{t('classifier.failed.title')}</strong>
          <p>{t('classifier.failed.body')}</p>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={retryClassifier}>
            <Icon name="refresh" />
            {t('classifier.retry')}
          </button>
        </div>
      </div>
    );
  return null;
}
