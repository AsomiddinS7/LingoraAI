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
  | 'UPSTREAM_ERROR'
  // v1 platform codes
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'NOT_AVAILABLE';

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
  /** v1: display name inserted when my_name is signed (max 40). Data, never prompt text. */
  name?: string;
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

// ---------- v1 platform contract (Lingora Platform v1, section 6) ----------
export type FeedbackKind = 'wrong_sign' | 'wrong_translation' | 'other';
export interface FeedbackRequest {
  kind: FeedbackKind;
  sign_ids: string[];
  model_id: string | null;
  note?: string;
}

export interface MeResponse {
  id: string;
  email: string | null;
  display_name: string;
  language: Lang;
  role: 'user' | 'admin';
}
