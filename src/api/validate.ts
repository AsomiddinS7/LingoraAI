// Hand-written validators for the section 7 contract. Used by the mock server (requests),
// the API client (responses) and the schema tests. No schema library, to keep dependencies few.
import { LANGS, type ApiErrorBody, type HealthResponse, type SentenceRequest, type SentenceResponse, type SimplifyRequest, type SimplifyResponse, type SpeechTokenResponse, type UsageResponse } from '../types';

const ERROR_CODES = ['BAD_REQUEST', 'RATE_LIMITED', 'CAP_REACHED', 'UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'NOT_AVAILABLE'];
const REFUSAL_REASONS = ['out_of_scope', 'low_confidence', 'unsafe_topic'];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isLang = (v: unknown) => isStr(v) && (LANGS as string[]).includes(v);

export const SIMPLIFY_MAX_CHARS = 300;
export const MAX_SIGNS = 5;

/** Returns null when valid, otherwise a human-readable reason (sent back as BAD_REQUEST message). */
export function checkSentenceRequest(v: unknown, vocabulary: string[]): string | null {
  if (!isObj(v)) return 'body must be an object';
  if (!isStr(v.session_id) || !UUID_V4.test(v.session_id)) return 'session_id must be a uuid-v4';
  if (!isLang(v.language)) return 'language must be uz, ru or en';
  if (!isStr(v.context) || v.context.length === 0) return 'context is required';
  if (!Array.isArray(v.signs) || v.signs.length < 1 || v.signs.length > MAX_SIGNS) return 'signs must have 1 to 5 items';
  for (const s of v.signs) {
    if (!isObj(s) || !isStr(s.label) || !vocabulary.includes(s.label)) return 'every label must be in the vocabulary';
    if (!isNum(s.confidence) || s.confidence < 0 || s.confidence > 1) return 'confidence must be between 0 and 1';
  }
  if (v.face_hints !== null) {
    if (!isObj(v.face_hints) || !isBool(v.face_hints.question) || !isBool(v.face_hints.negation))
      return 'face_hints must be null or { question, negation }';
  }
  if (v.name !== undefined && (!isStr(v.name) || v.name.trim().length === 0 || v.name.length > NAME_MAX)) return 'name must be 1 to 40 characters';
  const allowed = ['session_id', 'language', 'context', 'signs', 'face_hints', 'name'];
  if (Object.keys(v).some((k) => !allowed.includes(k))) return 'unknown field';
  return null;
}

export const NAME_MAX = 40;
export const FEEDBACK_NOTE_MAX = 300;

export function checkFeedbackRequest(v: unknown): string | null {
  if (!isObj(v)) return 'body must be an object';
  if (!['wrong_sign', 'wrong_translation', 'other'].includes(v.kind as string)) return 'kind is invalid';
  if (!Array.isArray(v.sign_ids) || v.sign_ids.length > 5 || !v.sign_ids.every(isStr)) return 'sign_ids must be up to 5 strings';
  if (v.model_id !== null && !isStr(v.model_id)) return 'model_id must be a string or null';
  if (v.note !== undefined && (!isStr(v.note) || v.note.length > FEEDBACK_NOTE_MAX)) return 'note must be at most 300 characters';
  const allowed = ['kind', 'sign_ids', 'model_id', 'note'];
  if (Object.keys(v).some((k) => !allowed.includes(k))) return 'unknown field';
  return null;
}

function isLabels(v: unknown): boolean {
  return isObj(v) && isStr(v.en) && isStr(v.ru) && isStr(v.uz);
}

export interface SignsPage {
  items: { id: string; slug: string; labels: { en: string; ru: string; uz: string }; scenario: string; status: 'draft' | 'active' | 'retired'; sort_order: number }[];
  total: number;
}
export function isSignsPage(v: unknown): v is SignsPage {
  return isObj(v) && isNum(v.total) && Array.isArray(v.items) && v.items.every((r) => isObj(r) && isStr(r.id) && isStr(r.slug) && isLabels(r.labels) && isStr(r.status) && isNum(r.sort_order));
}

export interface PhrasesPage {
  items: { id: string; slug: string; texts: { en: string; ru: string; uz: string } }[];
  total: number;
}
export function isPhrasesPage(v: unknown): v is PhrasesPage {
  return isObj(v) && isNum(v.total) && Array.isArray(v.items) && v.items.every((r) => isObj(r) && isStr(r.id) && isStr(r.slug) && isLabels(r.texts));
}

export function isFeedbackAck(v: unknown): v is { status: 'ok'; id: string } {
  return isObj(v) && v.status === 'ok' && isStr(v.id);
}

export function isActiveModel(v: unknown): v is { manifest_url: string; version: string; sha256: string } {
  return isObj(v) && isStr(v.manifest_url) && isStr(v.version) && isStr(v.sha256);
}

export function isMe(v: unknown): v is { id: string; email: string | null; display_name: string; language: 'uz' | 'ru' | 'en'; role: 'user' | 'admin' } {
  return isObj(v) && isStr(v.id) && (isStr(v.email) || v.email === null) && isStr(v.display_name) && isLang(v.language) && (v.role === 'user' || v.role === 'admin');
}

export function checkSimplifyRequest(v: unknown): string | null {
  if (!isObj(v)) return 'body must be an object';
  if (!isStr(v.session_id) || !UUID_V4.test(v.session_id)) return 'session_id must be a uuid-v4';
  if (!isLang(v.language)) return 'language must be uz, ru or en';
  if (!isStr(v.text) || v.text.trim().length === 0) return 'text is required';
  if (v.text.length > SIMPLIFY_MAX_CHARS) return 'text must be at most 300 characters';
  return null;
}

function isRefusal(v: Obj): boolean {
  return v.status === 'refused' && isStr(v.reason) && REFUSAL_REASONS.includes(v.reason) && v.sentence === null && v.needs_human === true;
}

export function isSentenceResponse(v: unknown): v is SentenceResponse {
  if (!isObj(v)) return false;
  if (v.status === 'ok') return isStr(v.sentence) && v.sentence.length > 0 && isLang(v.language) && isBool(v.needs_human);
  return isRefusal(v);
}

export function isSimplifyResponse(v: unknown): v is SimplifyResponse {
  if (!isObj(v)) return false;
  if (v.status === 'ok')
    return isStr(v.simplified) && Array.isArray(v.phrasebook_matches) && v.phrasebook_matches.every(isStr);
  // A simplify refusal has the same shape as a sentence refusal ("or a refusal as above").
  return isRefusal(v);
}

export function isErrorBody(v: unknown): v is ApiErrorBody {
  if (!isObj(v) || !isObj(v.error)) return false;
  const e = v.error;
  return isStr(e.code) && ERROR_CODES.includes(e.code) && isStr(e.message) && (e.retry_after_s === undefined || isNum(e.retry_after_s));
}

export function isSpeechToken(v: unknown): v is SpeechTokenResponse {
  return isObj(v) && isStr(v.token) && isStr(v.region) && isNum(v.expires_in_s);
}

export function isUsage(v: unknown): v is UsageResponse {
  return isObj(v) && isNum(v.calls_session) && isNum(v.calls_total) && isNum(v.cap) && isBool(v.mock);
}

export function isHealth(v: unknown): v is HealthResponse {
  return isObj(v) && isBool(v.ok) && isBool(v.mock);
}

// Re-exported request types so callers can build bodies with type safety.
export type { SentenceRequest, SimplifyRequest };


export interface ConsentTextRow {
  id: string;
  type: 'account' | 'contribute_data' | 'voice';
  version: number;
  language: string;
  body: string;
}
export function isConsentsPage(v: unknown): v is { items: ConsentTextRow[]; total: number } {
  return isObj(v) && isNum(v.total) && Array.isArray(v.items) && v.items.every((r) => isObj(r) && isStr(r.id) && isStr(r.type) && isNum(r.version) && isStr(r.body));
}

export function isOk(v: unknown): v is { status: 'ok' } {
  return isObj(v) && v.status === 'ok';
}

export function isAnyObject(v: unknown): v is Record<string, unknown> {
  return isObj(v);
}

export function isProviders(v: unknown): v is { google: boolean; telegram: { bot_id: number } | null } {
  return isObj(v) && isBool(v.google) && (v.telegram === null || (isObj(v.telegram) && isNum(v.telegram.bot_id)));
}
