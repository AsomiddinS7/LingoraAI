// API client: 8 second timeout, one retry, then a typed error the UI turns into a visible fallback (N6).
import { isErrorBody } from './validate';
import type { ApiErrorCode } from '../types';

export type ClientErrorCode = ApiErrorCode | 'OFFLINE' | 'NETWORK' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  constructor(
    public code: ClientErrorCode,
    message: string = code,
    public retryAfterS?: number,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** CSRF token from /api/auth/login, /register or /me; sent on unsafe requests (backend section 7). */
let csrfToken: string | null = null;
export const csrf = {
  set: (t: string | null) => {
    csrfToken = t;
  },
  get: () => csrfToken,
};

/**
 * Bearer session for a cross-site API (static site on GitHub Pages, API on another host):
 * browsers do not send SameSite cookies there, so the session token travels in a header.
 * Same-origin deployments keep the httpOnly cookie and never see the token.
 */
const TOKEN_KEY = 'lingora.session';
let bearerToken: string | null = null;
try {
  bearerToken = localStorage.getItem(TOKEN_KEY);
} catch {
  /* storage blocked: the session lasts until reload */
}
export const bearer = {
  set: (t: string | null) => {
    bearerToken = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
  get: () => bearerToken,
};

/** True when the API lives on another origin than the page. */
export function isCrossOrigin(base: string): boolean {
  if (!/^https?:\/\//i.test(base)) return false;
  try {
    return new URL(base).origin !== window.location.origin;
  } catch {
    return false;
  }
}

export interface ApiClientOptions {
  transport: () => Transport;
  baseUrl: () => string;
  isOffline: () => boolean;
  timeoutMs?: number;
}

const RETRYABLE: ClientErrorCode[] = ['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'NETWORK'];

export function createApiClient(opts: ApiClientOptions) {
  async function once<T>(method: Method, path: string, body: unknown, validate: (v: unknown) => v is T): Promise<T> {
    const base = opts.baseUrl();
    const cross = isCrossOrigin(base);
    // A free-tier API host may need ~50 s to wake up; give cross-site calls room for that.
    const timeoutMs = opts.timeoutMs ?? (cross ? 70000 : 8000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await opts.transport()(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cross
            ? { 'X-Lingora-Auth': 'bearer', ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}) }
            : method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        // Same site: the httpOnly session cookie. Cross site: no cookies, the bearer header instead.
        credentials: cross ? 'omit' : 'same-origin',
      });
    } catch (e) {
      if (controller.signal.aborted) throw new ApiError('UPSTREAM_TIMEOUT', 'No answer within the timeout');
      throw new ApiError('NETWORK', e instanceof Error ? e.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body handled below */
    }

    if (!res.ok) {
      if (isErrorBody(json)) {
        throw new ApiError(json.error.code, json.error.message, json.error.retry_after_s, res.status);
      }
      throw new ApiError(res.status >= 500 ? 'UPSTREAM_ERROR' : 'BAD_REQUEST', `HTTP ${res.status}`, undefined, res.status);
    }
    if (!validate(json)) throw new ApiError('INVALID_RESPONSE', 'Response does not match the contract');
    return json;
  }

  async function request<T>(method: Method, path: string, body: unknown, validate: (v: unknown) => v is T): Promise<T> {
    if (opts.isOffline()) throw new ApiError('OFFLINE', 'Offline');
    try {
      return await once(method, path, body, validate);
    } catch (e) {
      if (!(e instanceof ApiError) || !RETRYABLE.includes(e.code)) throw e;
      if (opts.isOffline()) throw new ApiError('OFFLINE', 'Offline');
      return once(method, path, body, validate); // one retry
    }
  }

  return {
    get: <T>(path: string, validate: (v: unknown) => v is T) => request('GET', path, undefined, validate),
    post: <T>(path: string, body: unknown, validate: (v: unknown) => v is T) => request('POST', path, body, validate),
    patch: <T>(path: string, body: unknown, validate: (v: unknown) => v is T) => request('PATCH', path, body, validate),
    del: <T>(path: string, validate: (v: unknown) => v is T) => request('DELETE', path, undefined, validate),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
