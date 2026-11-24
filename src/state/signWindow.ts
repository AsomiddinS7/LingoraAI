// Sign window state machine (v1 spec section 8):
// idle -> countdown -> recording -> processing -> result (Confirm / Pick another / Try again).
// Pure reducer; the hook in SignWindowContext drives it from the recognizer's events.
import type { RecognitionResult } from '../recognition/types';

export type WindowPhase = 'loading' | 'unavailable' | 'idle' | 'countdown' | 'recording' | 'processing' | 'result' | 'error';

export interface WindowState {
  phase: WindowPhase;
  ms: number;
  totalMs: number | null;
  result: RecognitionResult | null;
  /** recognized: best sign is usable; not_recognized: none or below threshold */
  outcome: 'recognized' | 'not_recognized' | null;
  /** label the signer chose: the best sign, or an alternative via "Pick another" */
  selected: string | null;
  picking: boolean;
  error: string | null;
}

export const initialWindow: WindowState = {
  phase: 'loading',
  ms: 0,
  totalMs: null,
  result: null,
  outcome: null,
  selected: null,
  picking: false,
  error: null,
};

export type WindowEvent =
  | { type: 'LOADING' }
  | { type: 'READY' }
  | { type: 'LOAD_FAILED'; message: string }
  | { type: 'START' }
  | { type: 'PROGRESS'; phase: 'countdown' | 'recording' | 'processing'; ms: number; totalMs?: number }
  | { type: 'RESULT'; result: RecognitionResult; threshold: number }
  | { type: 'ERROR'; message: string }
  | { type: 'TIMEOUT' }
  | { type: 'CANCEL' }
  | { type: 'PICK_ANOTHER' }
  | { type: 'SELECT'; label: string }
  | { type: 'RESET' };

const ACTIVE: WindowPhase[] = ['countdown', 'recording', 'processing'];
const ORDER = { countdown: 0, recording: 1, processing: 2 } as const;

export function windowReducer(s: WindowState, e: WindowEvent): WindowState {
  switch (e.type) {
    case 'LOADING':
      return { ...initialWindow, phase: 'loading' };
    case 'READY':
      return s.phase === 'loading' || s.phase === 'unavailable' ? { ...initialWindow, phase: 'idle' } : s;
    case 'LOAD_FAILED':
      return { ...initialWindow, phase: 'unavailable', error: e.message };
    case 'START':
      if (!['idle', 'result', 'error'].includes(s.phase)) return s;
      return { ...initialWindow, phase: 'countdown' };
    case 'PROGRESS': {
      if (!ACTIVE.includes(s.phase)) return s; // late events after cancel/result are ignored
      // never move backwards (e.g. a stale countdown tick after recording started)
      if (ORDER[e.phase] < ORDER[s.phase as keyof typeof ORDER]) return s;
      return { ...s, phase: e.phase, ms: e.ms, totalMs: e.totalMs ?? null };
    }
    case 'RESULT': {
      if (!ACTIVE.includes(s.phase)) return s;
      const ok = e.result.label !== 'none' && e.result.confidence >= e.threshold;
      return {
        ...s,
        phase: 'result',
        result: e.result,
        outcome: ok ? 'recognized' : 'not_recognized',
        selected: ok ? e.result.label : null,
        picking: false,
      };
    }
    case 'ERROR':
      if (s.phase === 'loading' || s.phase === 'unavailable') return s;
      return { ...s, phase: 'error', error: e.message };
    case 'TIMEOUT':
      if (s.phase !== 'recording' && s.phase !== 'processing') return s;
      return { ...s, phase: 'error', error: 'timeout' };
    case 'CANCEL':
      if (s.phase === 'loading' || s.phase === 'unavailable') return s;
      return { ...initialWindow, phase: 'idle' };
    case 'PICK_ANOTHER':
      return s.phase === 'result' ? { ...s, picking: true } : s;
    case 'SELECT':
      if (s.phase !== 'result') return s;
      if (s.outcome === 'not_recognized' && (!s.result || !['ambiguous', 'insufficient_motion', 'trimmed_suggestion'].includes(s.result.reason ?? '')
        || !s.result.alternatives.some((a) => a.label === e.label))) return s;
      return { ...s, selected: e.label, picking: false, outcome: 'recognized' };
    case 'RESET':
      return s.phase === 'loading' || s.phase === 'unavailable' ? s : { ...initialWindow, phase: 'idle' };
  }
}

/** Honest uncertainty in words, always shown together with the number (v1 spec 9). */
export type ConfidenceWord = 'sure' | 'maybe' | 'not_sure';
export function confidenceWord(c: number, threshold: number, sureAt: number): ConfidenceWord {
  if (c >= sureAt) return 'sure';
  if (c >= threshold) return 'maybe';
  return 'not_sure';
}
