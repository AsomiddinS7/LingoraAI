// In-browser mock of the team backend (brief sections 7 and 8). It speaks HTTP shapes
// (status code + JSON body) so the real API client is exercised unchanged.
import { checkSentenceRequest, checkSimplifyRequest } from './validate';
import { RATE_LIMIT_RETRY_AFTER_S, SIMPLIFIED_PREFIX, SUCCESS_SENTENCE, type Fixture } from './fixtures';
import { glossFor, PHRASES, VOCAB_LABELS } from '../data';
import type { ApiErrorBody, ApiErrorCode, Lang, SentenceRequest, SimplifyRequest } from '../types';

export interface MockSettings {
  fixture: Fixture;
  /** Plan A speech: /api/speech-token answers; Plan B: 404. */
  speechTokenEnabled: boolean;
}

export interface MockResult {
  status: number;
  body: unknown;
}

export interface MockServerOptions {
  getSettings: () => MockSettings;
  /** Delay before answering, in ms. Brief: 300 to 800 ms so loading states are visible. */
  delayMs?: () => number;
}

const err = (code: ApiErrorCode, message: string, retry_after_s?: number): ApiErrorBody => ({
  error: retry_after_s === undefined ? { code, message } : { code, message, retry_after_s },
});

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

/** Never answers until the caller aborts (the client's 8 s timeout). */
function hang(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

export function createMockServer(opts: MockServerOptions) {
  const delay = opts.delayMs ?? (() => 300 + Math.floor(Math.random() * 500));
  let callsSession = 0;
  let callsTotal = 0;

  /** Fixture-driven failures shared by the two model endpoints. Returns null for the success path. */
  async function failureFor(fixture: Fixture, signal?: AbortSignal): Promise<MockResult | null> {
    switch (fixture) {
      case 'validation_error':
        return { status: 400, body: err('BAD_REQUEST', 'Validation failed (mock fixture)') };
      case 'timeout':
        return hang(signal);
      case 'upstream_error':
        return { status: 502, body: err('UPSTREAM_ERROR', 'Upstream model error (mock fixture)') };
      case 'rate_limited':
        return { status: 429, body: err('RATE_LIMITED', 'Too many requests', RATE_LIMIT_RETRY_AFTER_S) };
      case 'cap_reached':
        return { status: 429, body: err('CAP_REACHED', 'Usage cap reached (mock fixture)') };
      default:
        return null;
    }
  }

  function sentence(req: SentenceRequest, fixture: Fixture): MockResult {
    if (fixture === 'refused') {
      return { status: 200, body: { status: 'refused', reason: 'out_of_scope', sentence: null, needs_human: true } };
    }
    const lang: Lang = req.language;
    const words = req.signs.map((s) => glossFor(s.label, lang)).join(', ');
    let text = SUCCESS_SENTENCE[lang].replace('{words}', words.charAt(0).toUpperCase() + words.slice(1));
    text += req.face_hints?.question ? '?' : '.';
    return { status: 200, body: { status: 'ok', sentence: text, language: lang, needs_human: false } };
  }

  function simplify(req: SimplifyRequest, fixture: Fixture): MockResult {
    if (fixture === 'refused') {
      return { status: 200, body: { status: 'refused', reason: 'out_of_scope', sentence: null, needs_human: true } };
    }
    // Mock behaviour: keep the first sentence, at most 12 words.
    const first = req.text.split(/(?<=[.!?])\s+/)[0] ?? req.text;
    const words = first.split(/\s+/).filter(Boolean);
    const short = words.slice(0, 12).join(' ') + (words.length > 12 ? ' …' : '');
    const lower = req.text.toLowerCase();
    const matches = PHRASES.filter((p) =>
      Object.values(p.text).some((t) => lower.includes(t.toLowerCase().replace(/[.!?…]/g, '').trim())),
    ).map((p) => p.id);
    return {
      status: 200,
      body: { status: 'ok', simplified: SIMPLIFIED_PREFIX + short, phrasebook_matches: matches.length ? matches : ['please_repeat'] },
    };
  }

  async function handle(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<MockResult> {
    await sleep(delay(), signal);
    const { fixture, speechTokenEnabled } = opts.getSettings();
    const route = `${method.toUpperCase()} ${path.split('?')[0]}`;

    switch (route) {
      case 'GET /api/health':
        return { status: 200, body: { ok: true, mock: true } };
      case 'GET /api/usage':
        // TODO [CONFIRM]: real cap comes from the team backend; the mock reports 0 (no cap set).
        return { status: 200, body: { calls_session: callsSession, calls_total: callsTotal, cap: 0, mock: true } };
      case 'GET /api/speech-token':
        if (!speechTokenEnabled) return { status: 404, body: err('BAD_REQUEST', 'Speech token is only available in Plan A') };
        return { status: 200, body: { token: 'mock-token', region: 'mock-region', expires_in_s: 540 } };
      case 'POST /api/sentence': {
        const failure = await failureFor(fixture, signal);
        if (failure) return failure;
        const problem = checkSentenceRequest(body, VOCAB_LABELS);
        if (problem) return { status: 400, body: err('BAD_REQUEST', problem) };
        callsSession++;
        callsTotal++;
        return sentence(body as SentenceRequest, fixture);
      }
      case 'POST /api/simplify': {
        const failure = await failureFor(fixture, signal);
        if (failure) return failure;
        const problem = checkSimplifyRequest(body);
        if (problem) return { status: 400, body: err('BAD_REQUEST', problem) };
        callsSession++;
        callsTotal++;
        return simplify(body as SimplifyRequest, fixture);
      }
      default:
        return { status: 404, body: err('BAD_REQUEST', `No mock route for ${route}`) };
    }
  }

  /** fetch-compatible wrapper so the API client cannot tell mock from real. */
  async function mockFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const result = await handle(init.method ?? 'GET', path, body, init.signal ?? undefined);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  return { handle, fetch: mockFetch };
}

export type MockServer = ReturnType<typeof createMockServer>;
