// Wires the pure conversation machine to the services: sentence/simplify API, TTS, STT, feedback.
// Sign recognition itself lives in SignWindowContext (v1 sign window).
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { NAME_MAX, SIMPLIFY_MAX_CHARS } from '../api/validate';
import { useI18n } from '../i18n';
import { backend, getStt, getTts, mockFaceHints, sentenceService } from '../providers';
import { TtsError } from '../providers/tts';
import { runtime, useRuntime } from '../runtime';
import type { FaceHint, FeedbackKind } from '../types';
import { uuidv4 } from '../lib/id';
import { initialState, reducer, type ConvEvent, type ConvState } from './machine';

interface ConversationValue {
  state: ConvState;
  dispatch: (e: ConvEvent) => void;
  faceHint: FaceHint | null;
  /** Display name for this session (guests type it once; v1 spec 2.2). Memory only. */
  name: string;
  setName: (n: string) => void;
  acceptSentence: () => void;
  speakDirect: (text: string) => void;
  sayListener: (text: string) => void;
  pttStart: () => Promise<void>;
  pttStop: () => Promise<void>;
  simplify: (turnId: string) => void;
  cancelSpeech: () => void;
  sendFeedback: (kind: FeedbackKind, signIds: string[]) => Promise<'ok' | 'failed'>;
  sessionId: string;
}

const Ctx = createContext<ConversationValue | null>(null);

const CONTEXT = 'greeting'; // v1 demo scenario: greeting and self-introduction

export function ConversationProvider({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  const [state, dispatch] = useReducer(reducer, initialState);
  const config = useRuntime((s) => s.config);
  const [sessionId] = useState(uuidv4);
  const [faceHint, setFaceHint] = useState<FaceHint | null>(null);
  const [name, setNameState] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const nameRef = useRef(name);
  nameRef.current = name;

  const setName = useCallback((n: string) => setNameState(n.slice(0, NAME_MAX)), []);

  // ----- face hints (Plan A, display only) -----
  useEffect(() => {
    if (!config.faceHints) {
      setFaceHint(null);
      return;
    }
    return mockFaceHints.subscribe(setFaceHint);
  }, [config.faceHints]);
  const faceHintRef = useRef(faceHint);
  faceHintRef.current = faceHint;

  // ----- COMPOSING: call /api/sentence -----
  useEffect(() => {
    if (state.phase !== 'COMPOSING') return;
    const id = state.requestId;
    const hint = faceHintRef.current;
    const n = nameRef.current.trim();
    sentenceService
      .compose({
        session_id: sessionId,
        language: lang,
        context: CONTEXT,
        signs: state.buffer.map((b) => ({ label: b.label, confidence: b.confidence })),
        face_hints: runtime.get().config.faceHints ? { question: hint === 'eyebrows_raised', negation: hint === 'head_shake' } : null,
        ...(n && state.buffer.some((b) => b.label === 'my_name') ? { name: n } : {}),
      })
      .then(
        (res) => {
          if (stateRef.current.requestId !== id || stateRef.current.phase !== 'COMPOSING') return;
          if (res.status === 'ok') dispatch({ type: 'COMPOSE_OK', sentence: res.sentence });
          else dispatch({ type: 'COMPOSE_REFUSED', reason: res.reason });
        },
        (err) => {
          if (stateRef.current.requestId !== id || stateRef.current.phase !== 'COMPOSING') return;
          const e = err instanceof ApiError ? err : new ApiError('NETWORK');
          dispatch({ type: 'COMPOSE_FAILED', code: e.code, retryAfterS: e.retryAfterS });
        },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.requestId]);

  // ----- SPEAKING: read aloud through the TtsProvider -----
  const tts = useMemo(() => getTts(config).provider, [config]);
  useEffect(() => {
    if (state.phase !== 'SPEAKING' || !state.speaking) return;
    let alive = true;
    tts.speak(state.speaking, lang).then(
      () => alive && dispatch({ type: 'SPEAK_DONE' }),
      (err) => alive && dispatch({ type: 'SPEAK_DONE', issue: err instanceof TtsError ? err.code : 'failed' }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.speaking]);

  const cancelSpeech = useCallback(() => {
    tts.cancel();
    dispatch({ type: 'SPEAK_DONE' });
  }, [tts]);

  // ----- SIMPLIFYING: call /api/simplify -----
  useEffect(() => {
    if (state.phase !== 'SIMPLIFYING' || !state.simplifyTarget) return;
    const target = state.turns.find((t) => t.id === state.simplifyTarget);
    if (!target) return;
    const turnId = target.id;
    sentenceService.simplify({ session_id: sessionId, language: lang, text: target.text.slice(0, SIMPLIFY_MAX_CHARS) }).then(
      (res) => {
        if (stateRef.current.phase !== 'SIMPLIFYING') return;
        if (res.status === 'ok')
          dispatch({ type: 'SIMPLIFY_OK', turnId, text: res.simplified, matches: res.phrasebook_matches, id: uuidv4(), at: Date.now() });
        else dispatch({ type: 'SIMPLIFY_FAILED', error: { kind: 'refused', reason: res.reason } });
      },
      (err) => {
        if (stateRef.current.phase !== 'SIMPLIFYING') return;
        const e = err instanceof ApiError ? err : new ApiError('NETWORK');
        dispatch({ type: 'SIMPLIFY_FAILED', error: { kind: 'api', code: e.code, retryAfterS: e.retryAfterS } });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.simplifyTarget]);

  // ----- push-to-talk -----
  const sttRef = useRef<ReturnType<typeof getStt> | null>(null);
  const pttStart = useCallback(async () => {
    const choice = getStt(runtime.get().config);
    if (choice.kind !== 'ptt') return;
    sttRef.current = choice;
    dispatch({ type: 'PTT_START' });
    try {
      await choice.provider.start(lang, (text, final) => {
        if (final) dispatch({ type: 'FINAL', text, id: uuidv4(), at: Date.now() });
        else dispatch({ type: 'PARTIAL', text });
      });
    } catch (err) {
      console.warn('[Lingora] speech input failed', err);
      dispatch({ type: 'PTT_FAILED' });
    }
  }, [lang]);

  const pttStop = useCallback(async () => {
    const choice = sttRef.current;
    sttRef.current = null;
    if (choice?.kind !== 'ptt') return;
    try {
      await choice.provider.stop();
    } catch {
      dispatch({ type: 'PTT_FAILED' });
    }
    if (stateRef.current.phase === 'TRANSCRIBING') dispatch({ type: 'FINAL', text: stateRef.current.partial, id: uuidv4(), at: Date.now() });
  }, []);

  // ----- STOP cancels everything in flight -----
  const wrappedDispatch = useCallback(
    (e: ConvEvent) => {
      if (e.type === 'STOP') {
        tts.cancel();
        const stt = sttRef.current;
        sttRef.current = null;
        if (stt?.kind === 'ptt') void stt.provider.stop();
      }
      dispatch(e);
    },
    [tts],
  );

  // ----- one-tap feedback (v1 spec 2.3 flow 5) -----
  const sendFeedback = useCallback(async (kind: FeedbackKind, signIds: string[]) => {
    try {
      await backend.feedback({ kind, sign_ids: signIds.slice(0, 5), model_id: null });
      return 'ok' as const;
    } catch {
      return 'failed' as const;
    }
  }, []);

  const value: ConversationValue = {
    state,
    dispatch: wrappedDispatch,
    faceHint,
    name,
    setName,
    acceptSentence: () => dispatch({ type: 'ACCEPT_SENTENCE', id: uuidv4(), at: Date.now() }),
    speakDirect: (text) => dispatch({ type: 'SPEAK_DIRECT', text, id: uuidv4(), at: Date.now() }),
    sayListener: (text) => dispatch({ type: 'LISTENER_TYPED', text, id: uuidv4(), at: Date.now() }),
    pttStart,
    pttStop,
    simplify: (turnId) => dispatch({ type: 'SIMPLIFY', turnId }),
    cancelSpeech,
    sendFeedback,
    sessionId,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConversation(): ConversationValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConversation outside ConversationProvider');
  return v;
}
