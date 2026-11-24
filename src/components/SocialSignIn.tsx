// "Continue with Google / Telegram". Both are full-page redirects: no third-party script runs in Lingora.
// First sign-up needs the account consent (spec section 7); returning users can sign in without it.
import { useEffect, useState } from 'react';
import { account } from '../account';
import { ApiError } from '../api/client';
import type { ConsentTextRow } from '../api/validate';
import { useI18n, type MessageKey } from '../i18n';
import { backend, usesMockApi } from '../providers';
import { href } from '../router';
import { useRuntime } from '../runtime';
import { Icon } from './Icon';

const CONSENT_KEY = 'lingora.pendingConsent';

type Providers = { google: boolean; telegram: { bot_id: number } | null };

// One request per page load, shared by every place that shows the social buttons.
let providersOnce: Promise<Providers | null> | null = null;
function loadProviders(): Promise<Providers | null> {
  providersOnce ??= backend.providers().then((p) => p, () => {
    providersOnce = null; // retry next time (e.g. the API host was still waking up)
    return null;
  });
  return providersOnce;
}

/** True once the server reports that Google or Telegram sign-in is configured. */
export function useSocialAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadProviders().then((p) => alive && setOk(!!p && (p.google || !!p.telegram)));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}

function TelegramMark() {
  return (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill="#29A9EB" />
      <path fill="#fff" d="M5.4 11.7l11.3-4.4c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.4-.1l-6.6 4.2-2.8-.9c-.6-.2-.6-.6.1-.8z" />
    </svg>
  );
}

/** Reads ?error=... from the hash route (set by the server after a failed redirect). */
function routeError(): MessageKey | null {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const e = q.get('error');
  return e && ['failed', 'cancelled', 'not_available', 'consent_required'].includes(e) ? (`social.error.${e}` as MessageKey) : null;
}

export function SocialSignIn() {
  const { t, lang } = useI18n();
  const mock = useRuntime((s) => usesMockApi(s.config));
  const [providers, setProviders] = useState<Providers | null>(null);
  const [terms, setTerms] = useState<ConsentTextRow | null>(null);
  const [agree, setAgree] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [error] = useState<MessageKey | null>(routeError);

  useEffect(() => {
    let alive = true;
    void loadProviders().then((p) => alive && setProviders(p));
    backend.consents(lang).then(
      (r) => alive && setTerms(r.items.find((i) => i.type === 'account') ?? null),
      () => alive && setTerms(null),
    );
    return () => {
      alive = false;
    };
  }, [lang]);

  const consentId = agree && terms ? terms.id : '';
  const offline = mock || providers === null;

  const google = () => {
    window.location.href = `api/auth/google/start?lang=${lang}${consentId ? `&consent=${consentId}` : ''}`;
  };

  const telegram = () => {
    if (!providers?.telegram) return;
    try {
      sessionStorage.setItem(CONSENT_KEY, JSON.stringify({ consent: consentId, lang }));
    } catch {
      /* storage blocked: consent will be asked again if needed */
    }
    const origin = window.location.origin;
    const returnTo = origin + window.location.pathname; // Telegram appends #tgAuthResult=...
    window.location.href = `https://oauth.telegram.org/auth?${new URLSearchParams({ bot_id: String(providers.telegram.bot_id), origin, request_access: 'write', return_to: returnTo })}`;
  };

  return (
    <div className="social stack">
      {offline && (
        <p className="small muted" role="status">
          <Icon name="info" /> {t('social.unavailable')}
        </p>
      )}
      <button type="button" className="btn btn-lg social-btn" disabled={offline || !providers?.google} onClick={google}>
        <GoogleMark />
        {t('social.google')}
      </button>
      <button type="button" className="btn btn-lg social-btn" disabled={offline || !providers?.telegram} onClick={telegram}>
        <TelegramMark />
        {t('social.telegram')}
      </button>
      <label className={`toggle consent-toggle ${error === 'social.error.consent_required' ? 'attention' : ''}`}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          {t('social.agree')}{' '}
          {terms && (
            <button type="button" className="link-btn" onClick={() => setShowTerms((s) => !s)} aria-expanded={showTerms}>
              {t('social.readTerms')}
            </button>
          )}
        </span>
      </label>
      {showTerms && terms && (
        <div className="consent-text" lang={lang}>
          <p>{terms.body}</p>
        </div>
      )}
      <p className="small muted">{t('social.consentHint')}</p>
      {error && (
        <div className="notice warn" role="alert">
          <Icon name="alert" />
          <p>{t(error)}</p>
        </div>
      )}
    </div>
  );
}

/** Finishes Telegram's redirect: #tgAuthResult=<base64 JSON> -> POST /api/auth/telegram. */
export async function finishTelegramRedirect(): Promise<void> {
  const m = window.location.hash.match(/^#tgAuthResult=([^&]+)/);
  if (!m) return;
  let pending: { consent?: string; lang?: string } = {};
  try {
    pending = JSON.parse(sessionStorage.getItem(CONSENT_KEY) ?? '{}');
    sessionStorage.removeItem(CONSENT_KEY);
  } catch {
    /* ignore */
  }
  try {
    const json = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(decodeURIComponent(escape(json))) as Record<string, unknown>;
    await account.telegram({ ...data, ...(pending.consent ? { consent_text_id: pending.consent } : {}), language: pending.lang ?? 'uz' });
    window.location.hash = href('conversation');
  } catch (err) {
    const consent = err instanceof ApiError && err.message === 'consent_required';
    window.location.hash = `${href(consent ? 'register' : 'signin')}?error=${consent ? 'consent_required' : 'failed'}`;
  }
}
