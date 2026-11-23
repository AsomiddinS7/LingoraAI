// Drives the sign window state machine from the configured recognizer
// (sequence | static | mock) and hands confirmed signs to the conversation.
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { createRecognizer } from '../providers';
import { metrics } from '../pipeline/metrics';
import type { SequenceRecognizer } from '../recognition/types';
import { runtime, useRuntime } from '../runtime';
import { useConversation } from './ConversationContext';
import { initialWindow, windowReducer, type WindowState } from './signWindow';

export interface SignWindowValue {
  win: WindowState;
  /** Load the recognizer (lazy: only when a camera screen opens). */
  ensure: () => void;
  reload: () => void;
  setVideo: (v: HTMLVideoElement | null) => void;
  start: () => void;
  cancel: () => void;
  finish: () => void;
  pickAnother: () => void;
  select: (label: string) => void;
  /** Confirm the selected sign; compose=true writes the sentence, false collects another sign. */
  confirm: (compose: boolean) => void;
  tryAgain: () => void;
}

const Ctx = createContext<SignWindowValue | null>(null);

export function SignWindowProvider({ children }: { children: ReactNode }) {
  const [win, dispatch] = useReducer(windowReducer, initialWindow);
  const recognizerName = useRuntime((s) => s.config.recognizer);
  const conv = useConversation();
  const recRef = useRef<SequenceRecognizer | null>(null);
  const [rec, setRec] = useState<SequenceRecognizer | null>(null);
  const [wanted, setWanted] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const winRef = useRef(win);
  winRef.current = win;

  // ----- load (lazily) and reload when the recognizer switch changes -----
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    dispatch({ type: 'LOADING' });
    metrics.set({ classifier: recognizerName });
    createRecognizer(runtime.get().config).then(
      (rec) => {
        if (!alive) return rec.detach();
        rec.on('progress', (p) => dispatch({ type: 'PROGRESS', phase: p.phase, ms: p.ms, totalMs: p.totalMs }));
        rec.on('result', (r) => {
          const t0 = performance.now();
          // Template matching applies distance + ambiguity rejection itself. Its score
          // is similarity, not a calibrated probability from the static classifier.
          dispatch({ type: 'RESULT', result: r, threshold: recognizerName === 'motion' ? 0 : runtime.get().config.confidenceThreshold });
          requestAnimationFrame(() => setTimeout(() => metrics.recordLatency(performance.now() - t0), 0));
        });
        rec.on('error', (e) => dispatch({ type: 'ERROR', message: e.message }));
        recRef.current = rec;
        setRec(rec);
        dispatch({ type: 'READY' });
      },
      (err: unknown) => {
        console.warn('[Lingora] recognizer unavailable', err);
        if (alive) dispatch({ type: 'LOAD_FAILED', message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      alive = false;
      recRef.current?.detach();
      recRef.current = null;
      setRec(null);
    };
  }, [wanted, recognizerName, generation]);

  // ----- attach to the camera video -----
  useEffect(() => {
    if (!rec || !video) return;
    rec.attach(video);
    return () => rec.detach();
  }, [rec, video]);

  // ----- watchdog: never hang in recording/processing -----
  useEffect(() => {
    if (win.phase !== 'recording' && win.phase !== 'processing') return;
    const cfg = runtime.get().config.signWindow;
    const limit = win.phase === 'recording' ? cfg.maxRecordingMs + 1500 : cfg.processingTimeoutMs;
    const id = setTimeout(() => {
      recRef.current?.cancelWindow();
      dispatch({ type: 'TIMEOUT' });
    }, limit);
    return () => clearTimeout(id);
  }, [win.phase]);

  const ensure = useCallback(() => setWanted(true), []);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  const start = useCallback(() => {
    if (!recRef.current || !video) return;
    dispatch({ type: 'START' });
    recRef.current.startWindow();
  }, [video]);

  const cancel = useCallback(() => {
    recRef.current?.cancelWindow();
    dispatch({ type: 'CANCEL' });
  }, []);

  const confirm = useCallback(
    (compose: boolean) => {
      const w = winRef.current;
      if (w.phase !== 'result' || !w.selected || !w.result) return;
      const conf = w.selected === w.result.label ? w.result.confidence : (w.result.alternatives.find((a) => a.label === w.selected)?.confidence ?? 0);
      conv.dispatch({ type: 'SIGN_CONFIRMED', label: w.selected, confidence: Math.min(1, Math.max(0, conf)), at: Date.now(), compose });
      dispatch({ type: 'RESET' });
    },
    [conv],
  );

  const value: SignWindowValue = {
    win,
    ensure,
    reload,
    setVideo,
    start,
    cancel,
    finish: () => recRef.current?.finishWindow?.(),
    pickAnother: () => dispatch({ type: 'PICK_ANOTHER' }),
    select: (label) => dispatch({ type: 'SELECT', label }),
    confirm,
    tryAgain: start,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSignWindow(): SignWindowValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSignWindow outside SignWindowProvider');
  return v;
}
