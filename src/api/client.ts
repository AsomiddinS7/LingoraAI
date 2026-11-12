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

export interface ApiClientOptions {
  transport: () => Transport;
  baseUrl: () => string;
  isOffline: () => boolean;
  timeoutMs?: number;
}

const RETRYABLE: ClientErrorCode[] = ['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'NETWORK'];

export function createApiClient(opts: ApiClientOptions) {
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function once<T>(method: 'GET' | 'POST', path: string, body: unknown, validate: (v: unknown) => v is T): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await opts.transport()(opts.baseUrl() + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
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

  async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, validate: (v: unknown) => v is T): Promise<T> {
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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
