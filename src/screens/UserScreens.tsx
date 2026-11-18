// Welcome, Sign in / Register, Profile and privacy, Phrasebook, Contribute, Help and limits.
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { InterpreterButton } from '../components/InterpreterButton';
import { Modal } from '../components/Modal';
import { NamePrompt } from '../components/NamePrompt';
import { TtsNotice } from '../components/Notices';
import { PhraseList } from '../components/PhrasePicker';
import { catalog, useCatalog, type PhraseRow } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import { writePref } from '../lib/prefs';
import { backend, usesMockApi } from '../providers';
import { href } from '../router';
import { useRuntime } from '../runtime';
import { useConversation } from '../state/ConversationContext';
import { useTheme, type Theme } from '../theme';
import { LANGS, type Lang } from '../types';

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
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={() => go(href('signin'))}>{t('welcome.signin')}</button>
            <button type="button" className="btn" onClick={() => go(href('register'))}>{t('welcome.register')}</button>
          </div>
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
  const register = mode === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (register && password.length < 10) return setError('auth.errorWeak');
    setBusy(true);
    try {
      if (register) await backend.register({ email, password, display_name: displayName, language: lang, consent_ids: [] });
      else await backend.login(email, password);
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
      {mock && <ServerNotice />}
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="auth-email">{t('auth.email')}</label>
          <input id="auth-email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={mock} />
        </div>
        <div className="field">
          <label htmlFor="auth-password">{t('auth.password')}</label>
          <input id="auth-password" className="input" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} disabled={mock} aria-describedby={register ? 'pw-hint' : undefined} />
          {register && <p id="pw-hint" className="small muted">{t('auth.passwordHint')}</p>}
        </div>
        {register && (
          <>
            <div className="field">
              <label htmlFor="auth-name">{t('auth.displayName')}</label>
              <input id="auth-name" className="input" autoComplete="nickname" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={mock} />
            </div>
            <label className="toggle">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={mock} />
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
        <button type="submit" className="btn btn-primary btn-lg" disabled={mock || busy || !email || !password || (register && (!consent || !displayName.trim()))}>
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
  const mock = useRuntime((s) => usesMockApi(s.config));
  return (
    <div className="narrow">
      <h1>{t('profile.title')}</h1>
      <section className="card stack">
        <h2>{t('profile.session')}</h2>
        <p className="muted">{t('profile.guest')}</p>
        {conv.name ? (
          <p>
            <strong>{t('profile.name')}:</strong> {conv.name}{' '}
            <button type="button" className="link-btn" onClick={() => conv.setName('')}>{t('profile.clearName')}</button>
          </p>
        ) : (
          <NamePrompt />
        )}
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
          <div className="btn-row" role="group">
            {(['system', 'light', 'dark'] as Theme[]).map((th) => (
              <button key={th} type="button" className={`btn ${theme === th ? 'btn-primary' : ''}`} aria-pressed={theme === th} onClick={() => setTheme(th)}>
                {t(`theme.${th}` as MessageKey)}
              </button>
            ))}
          </div>
        </fieldset>
      </section>
      <section className="card stack" style={{ marginTop: 16 }}>
        <h2>{t('profile.account')}</h2>
        {mock && <ServerNotice />}
        <p className="muted">{t('profile.accountOnly')}</p>
        <ul className="plain-list">
          <li><Icon name="check" /> {t('profile.consents')}</li>
          <li><Icon name="hand" /> {t('profile.clips')}</li>
          <li><Icon name="download" /> {t('profile.export')}</li>
          <li><Icon name="x" /> {t('profile.delete')}</li>
        </ul>
        <div className="btn-row">
          <a className="btn btn-primary" href={href('signin')}>{t('welcome.signin')}</a>
          <a className="btn" href={href('register')}>{t('welcome.register')}</a>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Phrasebook
export function PhrasebookScreen() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const [shown, setShown] = useState<PhraseRow | null>(null);
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conv.state.phase);
  return (
    <div>
      <div className="screen-title">
        <h1>{t('phrases.title')}</h1>
        <span className="badge">{t('common.placeholder')}</span>
      </div>
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
      <section className="card stack" style={{ marginTop: 16 }}>
        <p className="small">{t('contribute.local')}</p>
        <a className="btn" href={href('console')}>
          <Icon name="sliders" />
          {t('nav.console')}
        </a>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Help and limits
export function HelpScreen() {
  const { t, lang } = useI18n();
  useCatalog();
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
          <div className="card-title">
            <h2 id="signs">{t('about.signs')}</h2>
            <span className="badge">{t('common.placeholder')}</span>
          </div>
          <ul className="sign-list">
            {catalog.signs().map((s) => (
              <li key={s.id}>
                <div lang={lang} style={{ fontWeight: 700 }}>{s.labels[lang]}</div>
                <code>{s.slug}</code>
                <div className="small muted">{t('help.replayNA')}</div>
              </li>
            ))}
          </ul>
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
          <a className="btn" href={href('console')}>
            <Icon name="sliders" />
            {t('nav.console')}
          </a>
        </section>
      </div>
    </div>
  );
}
