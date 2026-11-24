// Welcome, Sign in / Register, Profile and privacy, Phrasebook, Contribute, Help and limits.
import { useEffect, useState, type FormEvent } from 'react';
import { account, useAccount } from '../account';
import type { ConsentTextRow } from '../api/validate';
import { ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { InterpreterButton } from '../components/InterpreterButton';
import { Modal } from '../components/Modal';
import { NamePrompt } from '../components/NamePrompt';
import { SocialSignIn } from '../components/SocialSignIn';
import { TtsNotice } from '../components/Notices';
import { PhraseList } from '../components/PhrasePicker';
import { catalog, useCatalog, type PhraseRow } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import { writePref } from '../lib/prefs';
import { backend, usesMockApi } from '../providers';
import { href } from '../router';
import { useRuntime } from '../runtime';
import { sequenceStore, useSequenceVersion } from '../ml/sequenceStore';
import { useConversation } from '../state/ConversationContext';
import { useTheme, type Theme } from '../theme';
import { LANGS, type Lang } from '../types';
import { platformApiEnabled } from '../config';

function ServerNotice() {
  const { t } = useI18n();
  return (
    <div className="notice warn" role="status">
      <Icon name="info" />
      <p>{t('server.notConnected')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Welcome
export function WelcomeScreen() {
  const { t, lang, setLang } = useI18n();
  const go = (r: string) => {
    writePref('welcomed', '1');
    window.location.hash = r;
  };
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <h1>{t('app.name')}</h1>
        <p className="lead">{t('welcome.lead')}</p>
        <div className="lang-buttons" role="group" aria-label={t('lang.label')}>
          {LANGS.map((l) => (
            <button key={l} type="button" className={`btn ${l === lang ? 'btn-primary' : ''}`} aria-pressed={l === lang} onClick={() => setLang(l)} lang={l}>
              {t(`lang.${l}` as MessageKey)}
            </button>
          ))}
        </div>
        <ol className="how">
          <li>{t('welcome.how1')}</li>
          <li>{t('welcome.how2')}</li>
          <li>{t('welcome.how3')}</li>
        </ol>
        <div className="stack">
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => go(href('conversation'))}>
            <Icon name="hand" />
            {t('welcome.guest')}
          </button>
          <p className="small muted" style={{ textAlign: 'center' }}>{t('welcome.guestNote')}</p>
          {platformApiEnabled && <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={() => go(href('signin'))}>{t('welcome.signin')}</button>
            <button type="button" className="btn" onClick={() => go(href('register'))}>{t('welcome.register')}</button>
          </div>}
        </div>
        <div className="notice warn" role="note">
          <Icon name="alert" />
          <p>{t('welcome.limits')}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Sign in / Register
export function AuthScreen({ mode }: { mode: 'signin' | 'register' }) {
  const { t, lang } = useI18n();
  const mock = useRuntime((s) => usesMockApi(s.config));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentText, setConsentText] = useState<ConsentTextRow | null>(null);
  const register = mode === 'register';

  // The current account consent text, in the user's language (versioned on the server).
  useEffect(() => {
    if (!register || mock) return;
    let current = true; // ignore answers for a language the user already switched away from
    backend.consents(lang).then(
      (r) => current && setConsentText(r.items.find((i) => i.type === 'account') ?? null),
      () => current && setConsentText(null),
    );
    return () => {
      current = false;
    };
  }, [register, mock, lang]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (register && password.length < 10) return setError('auth.errorWeak');
    setBusy(true);
    try {
      if (register) await account.register({ email, password, display_name: displayName, language: lang, consent_ids: consentText ? [consentText.id] : [] });
      else await account.login(email, password);
      window.location.hash = href('conversation');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      setError(code === 'NOT_AVAILABLE' ? 'server.notConnected' : code === 'UNAUTHENTICATED' ? 'auth.errorCreds' : code === 'CONFLICT' ? 'auth.errorExists' : 'auth.errorGeneric');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <h1>{register ? t('auth.register.title') : t('auth.signin.title')}</h1>
      <section className="card">
        <SocialSignIn />
      </section>
      <p className="divider"><span>{t('social.orEmail')}</span></p>
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="auth-email">{t('auth.email')}</label>
          <input id="auth-email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="auth-password">{t('auth.password')}</label>
          <input id="auth-password" className="input" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={register ? 'pw-hint' : undefined} />
          {register && <p id="pw-hint" className="small muted">{t('auth.passwordHint')}</p>}
        </div>
        {register && (
          <>
            <div className="field">
              <label htmlFor="auth-name">{t('auth.displayName')}</label>
              <input id="auth-name" className="input" autoComplete="nickname" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            {consentText && (
              <div className="consent-text" lang={lang}>
                <p className="eyebrow">{t('auth.consentVersion', { v: consentText.version })}</p>
                <p>{consentText.body}</p>
              </div>
            )}
            <label className="toggle">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              {t('auth.consentAccount')}
            </label>
            <p className="small muted">{t('auth.consentNote')}</p>
          </>
        )}
        {error && (
          <div className="notice bad" role="alert">
            <Icon name="alert" />
            <p>{t(error)}</p>
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !email || !password || (register && (!consent || !displayName.trim() || (!mock && !consentText)))}>
          {busy && <div className="spinner" aria-hidden="true" />}
          {register ? t('auth.submitRegister') : t('auth.submitSignin')}
        </button>
      </form>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <a className="btn" href={href(register ? 'signin' : 'register')}>{register ? t('auth.switchToSignin') : t('auth.switchToRegister')}</a>
        <a className="btn btn-primary" href={href('conversation')}>{t('auth.guest')}</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Profile and privacy
export function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const conv = useConversation();
  const me = useAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<MessageKey | null>(null);

  const download = async () => {
    try {
      const data = await backend.exportMe();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'lingora-my-data.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      setMsg('auth.errorGeneric');
    }
  };

  if (me)
    return (
      <div className="narrow">
        <h1>{t('profile.title')}</h1>
        <section className="card stack">
          <h2>{t('profile.account')}</h2>
          <p>
            <strong>{me.display_name}</strong>
            {me.email && <> · {me.email}</>}
            {me.role === 'admin' && <span className="badge" style={{ marginLeft: 8 }}>admin</span>}
          </p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void download()}>
              <Icon name="download" />
              {t('profile.export')}
            </button>
            <button type="button" className="btn" onClick={() => void account.logout()}>
              {t('profile.signOut')}
            </button>
          </div>
          {msg && <p role="alert" className="small">{t(msg)}</p>}
        <a className="row-link" href={href('contribute')}>
          <Icon name="hand" />
          <span>
            <strong>{t('contribute.title')}</strong>
            <span className="muted small">{t('profile.contributeHint')}</span>
          </span>
        </a>
        </section>
        <section className="card stack" style={{ marginTop: 16, borderColor: 'var(--danger)' }}>
          <h2 style={{ color: 'var(--danger)' }}>{t('profile.delete')}</h2>
          <p className="small">{t('profile.deleteBody')}</p>
          {!confirmDelete ? (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>{t('profile.delete')}</button>
          ) : (
            <div className="btn-row">
              <button type="button" className="btn btn-danger" onClick={() => void account.deleteAccount().catch(() => setMsg('auth.errorGeneric'))}>
                {t('profile.deleteConfirm')}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
            </div>
          )}
        </section>
      </div>
    );

  return (
    <div className="narrow">
      <h1>{t('profile.title')}</h1>
      {platformApiEnabled && <section className="card stack" aria-labelledby="signin-h">
        <h2 id="signin-h">{t('profile.signInTitle')}</h2>
        <p className="muted">{t('profile.signInLead')}</p>
        <SocialSignIn />
        <a className="link-btn" href={href('signin')}>{t('social.email')}</a>
      </section>}

      <section className="card stack" style={{ marginTop: 16 }} aria-labelledby="session-h">
        <h2 id="session-h">{t('profile.session')}</h2>
        {conv.name ? (
          <p>
            <strong>{t('profile.name')}:</strong> {conv.name}{' '}
            <button type="button" className="link-btn" onClick={() => conv.setName('')}>{t('profile.clearName')}</button>
          </p>
        ) : (
          <NamePrompt />
        )}
        <div className="settings-row">
          <div className="field">
            <label htmlFor="profile-lang">{t('lang.label')}</label>
            <select id="profile-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l} value={l} lang={l}>{t(`lang.${l}` as MessageKey)}</option>
              ))}
            </select>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 6 }}>{t('profile.theme')}</legend>
            <div className="segmented" role="group">
              {(['system', 'light', 'dark'] as Theme[]).map((th) => (
                <button key={th} type="button" className={theme === th ? 'on' : ''} aria-pressed={theme === th} onClick={() => setTheme(th)}>
                  {t(`theme.${th}` as MessageKey)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <p className="small muted">{t('profile.guest')}</p>
      </section>

      {platformApiEnabled && <a className="card row-link" style={{ marginTop: 16 }} href={href('contribute')}>
        <Icon name="hand" />
        <span>
          <strong>{t('contribute.title')}</strong>
          <span className="muted small">{t('profile.contributeHint')}</span>
        </span>
      </a>}
    </div>
  );
}

// ---------------------------------------------------------------- Phrasebook
export function PhrasebookScreen() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const [shown, setShown] = useState<PhraseRow | null>(null);
  const [own, setOwn] = useState('');
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conv.state.phase);
  return (
    <div className="narrow">
      <h1>{t('phrases.title')}</h1>
      <form
        className="own-text"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim() && !busy) {
            conv.speakDirect(own);
            setShown({ id: 'own', slug: 'own', texts: { en: own, ru: own, uz: own } });
            setOwn('');
          }
        }}
      >
        <label className="sr-only" htmlFor="own-text">{t('phrases.typeOwn')}</label>
        <input id="own-text" className="composer-input" lang={lang} value={own} placeholder={t('phrases.typeOwn')} onChange={(e) => setOwn(e.target.value)} />
        <button type="submit" className="icon-btn send" disabled={!own.trim() || busy} aria-label={t('speak.readAloud')} title={t('speak.readAloud')}>
          <Icon name="speaker" />
        </button>
      </form>
      <p className="muted">{t('phrases.hint')}</p>
      <TtsNotice />
      <PhraseList
        onPick={(p) => {
          setShown(p);
          if (!busy) conv.speakDirect(p.texts[lang]); // tap a phrase: spoken at once
        }}
      />
      <Modal open={!!shown} onClose={() => setShown(null)} title={t('phrases.title')}>
        {shown && (
          <div className="phrase-show stack">
            <p className="result-text xl" lang={lang}>{shown.texts[lang]}</p>
            <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => conv.speakDirect(shown.texts[lang])}>
              <Icon name="speaker" />
              {t('speak.readAloud')}
            </button>
            <TtsNotice />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- Contribute
export function ContributeScreen() {
  const { t } = useI18n();
  const mock = useRuntime((s) => usesMockApi(s.config));
  return (
    <div className="narrow">
      <h1>{t('contribute.title')}</h1>
      <section className="card stack">
        <p>{t('contribute.body')}</p>
        {mock && <ServerNotice />}
        <p className="muted">{t('contribute.needAccount')}</p>
        <div className="btn-row">
          <a className="btn btn-primary" href={href('signin')}>{t('welcome.signin')}</a>
          <a className="btn" href={href('register')}>{t('welcome.register')}</a>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Help and limits
export function HelpScreen() {
  const { t, lang } = useI18n();
  useCatalog();
  useSequenceVersion();
  const motion = useRuntime((s) => s.config.recognizer === 'motion');
  const supported = motion ? catalog.signs().filter((s) => Object.hasOwn(sequenceStore.counts(), s.slug)) : catalog.signs();
  return (
    <div>
      <div className="screen-title">
        <h1>{t('help.title')}</h1>
      </div>
      <div className="about-grid">
        <section className="card">
          <h2>{t('about.what')}</h2>
          <p>{t('about.whatBody')}</p>
        </section>
        <section className="card" style={{ borderColor: 'var(--danger)' }} aria-labelledby="not-for">
          <h2 id="not-for" style={{ color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icon name="alert" />
            {t('about.notFor')}
          </h2>
          <ul className="not-for">
            <li>{t('about.notFor.medical')}</li>
            <li>{t('about.notFor.legal')}</li>
            <li>{t('about.notFor.emergency')}</li>
          </ul>
          <p>{t('about.notFor.cta')}</p>
          <InterpreterButton />
        </section>
        <section className="card span-2" aria-labelledby="signs">
          <h2 id="signs">{t('about.signs')}</h2>
          <ul className="sign-list">
            {supported.map((s) => (
              <li key={s.id}>
                <span lang={lang}>{s.labels[lang]}</span>
              </li>
            ))}
          </ul>
          {supported.length === 0 && <p>{t('motion.empty')}</p>}
          <p className="small muted" style={{ marginTop: 10 }}>{t('about.signsNote')}</p>
        </section>
        <section className="card">
          <h2>{t('about.limits')}</h2>
          <ul>
            <li>{t('about.limit1')}</li>
            <li>{t('about.limit2')}</li>
            <li>{t('about.limit3')}</li>
            <li>{t('about.limit4')}</li>
          </ul>
        </section>
        <section className="card">
          <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icon name="lock" />
            {t('about.privacy')}
          </h2>
          <p>{t('about.privacyBody')}</p>
        </section>
      </div>
    </div>
  );
}
