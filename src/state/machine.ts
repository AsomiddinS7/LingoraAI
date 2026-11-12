// Conversation state machine (brief section 10). Pure reducer, no side effects, fully unit-tested.
// Rule: nothing reaches SPEAKING unless the signer accepted it (or typed it themselves).
import type { ClientErrorCode } from '../api/client';
import type { TtsErrorCode } from '../providers/tts';
import type { Recognition, RefusalReason, Turn } from '../types';

export type Phase =
  | 'IDLE'
  | 'SIGNER_LISTENING'
  | 'CONFIRM_SIGN'
  | 'COMPOSING'
  | 'CONFIRM_SENTENCE'
  | 'SPEAKING'
  | 'LISTENER_TURN'
  | 'TRANSCRIBING'
  | 'SIMPLIFYING'
  | 'ERROR';

export type SentenceSource = 'model' | 'phrase' | 'fallback' | 'typed';

export type ConvError =
  | { kind: 'api'; code: ClientErrorCode; retryAfterS?: number }
  | { kind: 'refused'; reason: RefusalReason };

export interface ConvState {
  phase: Phase;
  /** Confirmed signs waiting to be composed into one sentence (1 to 5). */
  buffer: Recognition[];
  /** The sign waiting for the signer's confirmation. */
  candidate: Recognition | null;
  /** Latest classifier event, for the status chip. */
  last: { label: string; confidence: number } | null;
  notRecognized: boolean;
  proposal: { text: string; source: SentenceSource } | null;
  speaking: string | null;
  partial: string;
  error: ConvError | null;
  turns: Turn[];
  simplifyTarget: string | null;
  resumePhase: Phase;
  simplifyError: ConvError | null;
  matches: string[];
  ttsIssue: TtsErrorCode | null;
  sttIssue: boolean;
  /** Increments every time a compose request must be sent. */
  requestId: number;
}

export const MAX_SIGNS = 5;

export const initialState: ConvState = {
  phase: 'IDLE',
  buffer: [],
  candidate: null,
  last: null,
  notRecognized: false,
  proposal: null,
  speaking: null,
  partial: '',
  error: null,
  turns: [],
  simplifyTarget: null,
  resumePhase: 'IDLE',
  simplifyError: null,
  matches: [],
  ttsIssue: null,
  sttIssue: false,
  requestId: 0,
};

export type ConvEvent =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'SIGN_EVENT'; label: string; confidence: number; at: number; threshold: number }
  | { type: 'ACCEPT_SIGN' }
  | { type: 'ADD_SIGN' }
  | { type: 'DISCARD_SIGN' }
  | { type: 'CHOOSE_PHRASE'; text: string }
  | { type: 'COMPOSE_OK'; sentence: string }
  | { type: 'COMPOSE_REFUSED'; reason: RefusalReason }
  | { type: 'COMPOSE_FAILED'; code: ClientErrorCode; retryAfterS?: number }
  | { type: 'RETRY' }
  | { type: 'USE_WORDS'; text: string }
  | { type: 'ACCEPT_SENTENCE'; id: string; at: number }
  | { type: 'REJECT_SENTENCE' }
  | { type: 'SPEAK_DIRECT'; text: string; id: string; at: number }
  | { type: 'REPEAT'; text: string }
  | { type: 'SPEAK_DONE'; issue?: TtsErrorCode }
  | { type: 'PTT_START' }
  | { type: 'PARTIAL'; text: string }
  | { type: 'FINAL'; text: string; id: string; at: number }
  | { type: 'PTT_FAILED' }
  | { type: 'LISTENER_TYPED'; text: string; id: string; at: number }
  | { type: 'EDIT_TURN'; id: string; text: string }
  | { type: 'SIMPLIFY'; turnId: string }
  | { type: 'SIMPLIFY_OK'; turnId: string; text: string; matches: string[]; id: string; at: number }
  | { type: 'SIMPLIFY_FAILED'; error: ConvError }
  | { type: 'DISMISS_NOTICES' };

// The hearing person may interrupt while the signer is still signing; a pending sign is dropped.
export const LISTENER_ENTRY: Phase[] = ['IDLE', 'SIGNER_LISTENING', 'CONFIRM_SIGN', 'LISTENER_TURN', 'ERROR'];
const BUSY: Phase[] = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'];

export function reducer(s: ConvState, e: ConvEvent): ConvState {
  switch (e.type) {
    case 'START':
      if (!['IDLE', 'LISTENER_TURN', 'ERROR'].includes(s.phase)) return s;
      return { ...s, phase: 'SIGNER_LISTENING', error: null, candidate: null, notRecognized: false, last: null, ttsIssue: null };

    case 'STOP':
      return {
        ...initialState,
        turns: s.turns,
        requestId: s.requestId,
      };

    case 'SIGN_EVENT': {
      if (s.phase !== 'SIGNER_LISTENING') return s;
      // 'none' with confidence 0 = no hand in view: clear the status instead of "Not recognized".
      if (e.label === 'none' && e.confidence === 0) return { ...s, last: null, notRecognized: false };
      const last = { label: e.label, confidence: e.confidence };
      if (e.label === 'none' || e.confidence < e.threshold) return { ...s, last, notRecognized: true };
      return {
        ...s,
        last,
        notRecognized: false,
        phase: 'CONFIRM_SIGN',
        candidate: { label: e.label, confidence: e.confidence, at: e.at },
      };
    }

    case 'ACCEPT_SIGN':
      if (s.phase !== 'CONFIRM_SIGN' || !s.candidate) return s;
      return {
        ...s,
        phase: 'COMPOSING',
        buffer: [...s.buffer, s.candidate].slice(-MAX_SIGNS),
        candidate: null,
        requestId: s.requestId + 1,
      };

    case 'ADD_SIGN':
      if (s.phase !== 'CONFIRM_SIGN' || !s.candidate || s.buffer.length + 1 >= MAX_SIGNS) return s;
      return { ...s, phase: 'SIGNER_LISTENING', buffer: [...s.buffer, s.candidate], candidate: null, notRecognized: false };

    case 'DISCARD_SIGN':
      if (s.phase !== 'CONFIRM_SIGN') return s;
      return { ...s, phase: 'SIGNER_LISTENING', candidate: null, notRecognized: false };

    case 'CHOOSE_PHRASE':
      if (BUSY.includes(s.phase)) return s;
      return { ...s, phase: 'CONFIRM_SENTENCE', proposal: { text: e.text, source: 'phrase' }, candidate: null, buffer: [], error: null };

    case 'COMPOSE_OK':
      if (s.phase !== 'COMPOSING') return s;
      return { ...s, phase: 'CONFIRM_SENTENCE', proposal: { text: e.sentence, source: 'model' } };

    case 'COMPOSE_REFUSED':
      if (s.phase !== 'COMPOSING') return s;
      return { ...s, phase: 'ERROR', error: { kind: 'refused', reason: e.reason } };

    case 'COMPOSE_FAILED':
      if (s.phase !== 'COMPOSING') return s;
      return { ...s, phase: 'ERROR', error: { kind: 'api', code: e.code, retryAfterS: e.retryAfterS } };

    case 'RETRY':
      if (s.phase !== 'ERROR' || s.buffer.length === 0) return s;
      return { ...s, phase: 'COMPOSING', error: null, requestId: s.requestId + 1 };

    case 'USE_WORDS':
      if (s.phase !== 'ERROR') return s;
      return { ...s, phase: 'CONFIRM_SENTENCE', error: null, proposal: { text: e.text, source: 'fallback' } };

    case 'ACCEPT_SENTENCE':
      if (s.phase !== 'CONFIRM_SENTENCE' || !s.proposal) return s;
      return {
        ...s,
        phase: 'SPEAKING',
        speaking: s.proposal.text,
        turns: [...s.turns, { id: e.id, speaker: 'signer', text: s.proposal.text, at: e.at }],
        proposal: null,
        buffer: [],
        ttsIssue: null,
      };

    case 'REJECT_SENTENCE':
      if (s.phase !== 'CONFIRM_SENTENCE') return s;
      return { ...s, phase: 'SIGNER_LISTENING', proposal: null, buffer: [], notRecognized: false, last: null };

    case 'SPEAK_DIRECT':
      if (BUSY.includes(s.phase) || !e.text.trim()) return s;
      return {
        ...s,
        phase: 'SPEAKING',
        speaking: e.text.trim(),
        turns: [...s.turns, { id: e.id, speaker: 'signer', text: e.text.trim(), at: e.at }],
        proposal: null,
        candidate: null,
        buffer: [],
        ttsIssue: null,
      };

    case 'REPEAT':
      // Re-read text the signer already accepted earlier; no new turn.
      if (BUSY.includes(s.phase)) return s;
      return { ...s, phase: 'SPEAKING', speaking: e.text, ttsIssue: null };

    case 'SPEAK_DONE':
      if (s.phase !== 'SPEAKING') return s;
      return { ...s, phase: 'LISTENER_TURN', speaking: null, ttsIssue: e.issue ?? null };

    case 'PTT_START':
      if (!LISTENER_ENTRY.includes(s.phase)) return s;
      return { ...s, phase: 'TRANSCRIBING', partial: '', sttIssue: false, error: null, candidate: null, notRecognized: false };

    case 'PARTIAL':
      if (s.phase !== 'TRANSCRIBING') return s;
      return { ...s, partial: e.text };

    case 'FINAL': {
      if (s.phase !== 'TRANSCRIBING') return s;
      const text = e.text.trim();
      return {
        ...s,
        phase: 'LISTENER_TURN',
        partial: '',
        turns: text ? [...s.turns, { id: e.id, speaker: 'listener', text, at: e.at }] : s.turns,
      };
    }

    case 'PTT_FAILED':
      if (s.phase !== 'TRANSCRIBING') return s;
      return { ...s, phase: 'LISTENER_TURN', partial: '', sttIssue: true };

    case 'LISTENER_TYPED': {
      const text = e.text.trim();
      if (!text || !LISTENER_ENTRY.includes(s.phase)) return s;
      return {
        ...s,
        phase: 'LISTENER_TURN',
        error: null,
        candidate: null,
        turns: [...s.turns, { id: e.id, speaker: 'listener', text, at: e.at }],
      };
    }

    case 'EDIT_TURN': {
      const text = e.text.trim();
      if (!text) return s;
      return { ...s, turns: s.turns.map((t) => (t.id === e.id && t.speaker === 'listener' ? { ...t, text } : t)) };
    }

    case 'SIMPLIFY':
      if (!['LISTENER_TURN', 'IDLE', 'SIGNER_LISTENING'].includes(s.phase)) return s;
      if (!s.turns.some((t) => t.id === e.turnId && t.speaker === 'listener')) return s;
      return { ...s, phase: 'SIMPLIFYING', simplifyTarget: e.turnId, resumePhase: s.phase, simplifyError: null, matches: [] };

    case 'SIMPLIFY_OK':
      if (s.phase !== 'SIMPLIFYING') return s;
      return {
        ...s,
        phase: s.resumePhase,
        simplifyTarget: null,
        matches: e.matches,
        turns: [...s.turns, { id: e.id, speaker: 'listener', text: e.text, at: e.at, simplifiedFrom: e.turnId }],
      };

    case 'SIMPLIFY_FAILED':
      if (s.phase !== 'SIMPLIFYING') return s;
      return { ...s, phase: s.resumePhase, simplifyTarget: null, simplifyError: e.error };

    case 'DISMISS_NOTICES':
      return { ...s, ttsIssue: null, sttIssue: false, simplifyError: null };
  }
}
