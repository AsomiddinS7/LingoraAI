// Camera: getUserMedia only (no ML here). The stream never leaves the device: it is only
// attached to a <video> element that the team's SignClassifier reads locally.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { runtime } from '../runtime';

export type CameraStatus = 'off' | 'requesting' | 'live' | 'denied' | 'notFound' | 'unsupported' | 'error';

interface CameraValue {
  status: CameraStatus;
  stream: MediaStream | null;
  start: () => Promise<void>;
  stop: () => void;
}

const Ctx = createContext<CameraValue | null>(null);

export function CameraProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CameraStatus>('off');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setStatus((s) => (s === 'live' || s === 'requesting' ? 'off' : s));
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    if (runtime.get().demo.simCameraDenied) {
      setStatus('denied');
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    setStatus('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false, // never audio
      });
      streamRef.current = s;
      setStream(s);
      setStatus('live');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') setStatus('notFound');
      else setStatus('error');
    }
  }, []);

  // Stop the camera when the tab is closed.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return <Ctx.Provider value={{ status, stream, start, stop }}>{children}</Ctx.Provider>;
}

export function useCamera(): CameraValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCamera outside CameraProvider');
  return v;
}
