// Data model (brief section 11) and provider interfaces (brief section 6).
// The UI imports only these interfaces, never a concrete provider.

export type Lang = 'uz' | 'ru' | 'en';
export const LANGS: Lang[] = ['uz', 'ru', 'en'];

/** A label from vocabulary.json. */
export type SignLabel = string;

export interface Recognition {
  label: SignLabel;
  confidence: number;
  at: number;
}

export interface Turn {
  id: string;
  speaker: 'signer' | 'listener';
  text: string;
  at: number;
  /** UI-only: marks a listener turn that is the simplified version of another turn. */
  simplifiedFrom?: string;
}

export interface Phrase {
  id: string;
  category: string;
  text: Record<Lang, string>;
}

// ---------- API contract (brief section 7) ----------

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'CAP_REACHED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; retry_after_s?: number };
}

export interface FaceHintsPayload {
  question: boolean;
  negation: boolean;
}

export interface SentenceRequest {
  session_id: string;
  language: Lang;
  context: string;
  signs: { label: SignLabel; confidence: number }[];
  face_hints: FaceHintsPayload | null;
}

export type RefusalReason = 'out_of_scope' | 'low_confidence' | 'unsafe_topic';

export interface Refusal {
  status: 'refused';
  reason: RefusalReason;
  sentence: null;
  needs_human: true;
}

export type SentenceResponse =
  | { status: 'ok'; sentence: string; language: Lang; needs_human: boolean }
  | Refusal;

export interface SimplifyRequest {
  session_id: string;
  language: Lang;
  text: string;
}

export type SimplifyResponse =
  | { status: 'ok'; simplified: string; phrasebook_matches: string[] }
  | Refusal;

export interface SpeechTokenResponse {
  token: string;
  region: string;
  expires_in_s: number;
}

export interface UsageResponse {
  calls_session: number;
  calls_total: number;
  cap: number;
  mock: boolean;
}

export interface HealthResponse {
  ok: boolean;
  mock: boolean;
}

// ---------- Provider interfaces (brief section 6) ----------

export interface SignClassifier {
  load(): Promise<void>;
  attach(
    video: HTMLVideoElement,
    onSign: (r: { label: SignLabel | 'none'; confidence: number }) => void,
  ): void;
  detach(): void;
}

export interface SentenceService {
  compose(req: SentenceRequest): Promise<SentenceResponse>;
  simplify(req: SimplifyRequest): Promise<SimplifyResponse>;
}

export interface SttProvider {
  start(lang: Lang, onText: (t: string, final: boolean) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface TtsProvider {
  speak(text: string, lang: Lang): Promise<void>;
  cancel(): void;
}

/** Optional provider for F11 (Plan A). Display only. */
export type FaceHint = 'eyebrows_raised' | 'head_shake' | 'head_nod';
export interface FaceHintProvider {
  subscribe(onHint: (hint: FaceHint | null) => void): () => void;
}
