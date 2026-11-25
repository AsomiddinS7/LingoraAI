// Welcome, Sign in / Register, Profile and privacy, Phrasebook, Contribute, Help and limits.
import { useEffect, useState, type FormEvent } from 'react';
import { account, useAccount } from '../account';
import type { ConsentTextRow } from '../api/validate';
import { ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { initials } from '../components/AppShell';
import { InterpreterButton } from '../components/InterpreterButton';
import { Modal } from '../components/Modal';
import { NamePrompt } from '../components/NamePrompt';
import { SocialSignIn, useSocialAvailable } from '../components/SocialSignIn';
import { TtsNotice } from '../components/Notices';
import { CATEGORIES, learning, useLearning, type Category } from '../learning';
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
import { accountsEnabled, platformApiEnabled } from '../config';

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
          {accountsEnabled && <div className="btn-row" style={{ justifyContent: 'center' }}>
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
  const social = useSocialAvailable();

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
      {social && (
        <>
          <section className="card">
            <SocialSignIn />
          </section>
          <p className="divider"><span>{t('social.orEmail')}</span></p>
        </>
      )}
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
        {busy && <p className="small muted" role="status">{t('auth.waking')}</p>}
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
  const social = useSocialAvailable();
  const { phrases, saved, history } = useLearning();
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

  // Learning numbers come only from this device's real practice records (see learning.ts).
  const bySlug = new Map(phrases.map((p) => [p.slug, p]));
  const practicedSlugs = new Set(history.map((h) => h.slug).filter((s) => bySlug.has(s)));
  const savedPhrases = saved.flatMap((s) => {
    const p = bySlug.get(s);
    return p ? [p] : [];
  });
  const recent = history.filter((h) => bySlug.has(h.slug)).slice(0, 8);
  // Browsers format uz dates poorly; use the common dd.mm.yyyy, hh:mm form for Uzbek.
  const intl = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const time = { format: (at: number) => intl.format(at).split('/').join('.') };
  const name = me?.display_name || conv.name || t('profile.guestName');

  return (
    <div className="dash">
      <h1>{t('profile.title')}</h1>
      <div className="dash-grid">
        <div className="dash-col">
          <section className="card stack" aria-labelledby="id-h">
            <div className="id-card">
              <span className="avatar" aria-hidden="true">{me || conv.name ? initials(name) : <Icon name="person" />}</span>
              <div style={{ minWidth: 0 }}>
                <h2 id="id-h">{name}{me?.role === 'admin' && <span className="badge" style={{ marginLeft: 8 }}>admin</span>}</h2>
                <p className="small muted" style={{ overflowWrap: 'anywhere' }}>{me ? (me.email ?? t('profile.account')) : t('profile.guestShort')}</p>
              </div>
            </div>
            {me ? (
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => void download()}>
                  <Icon name="download" />
                  {t('profile.export')}
                </button>
                <button type="button" className="btn" onClick={() => void account.logout()}>{t('profile.signOut')}</button>
              </div>
            ) : accountsEnabled ? (
              <div className="stack">
                <p className="small muted" style={{ margin: 0 }}>{t('profile.signInLead')}</p>
                {social && <SocialSignIn />}
                <div className="btn-row">
                  <a className="btn btn-primary" href={href('signin')}>{t('welcome.signin')}</a>
                  <a className="btn" href={href('register')}>{t('welcome.register')}</a>
                </div>
              </div>
            ) : null}
            {msg && <p role="alert" className="small">{t(msg)}</p>}
            {me && platformApiEnabled && (
              <a className="row-link" href={href('contribute')}>
                <Icon name="hand" />
                <span>
                  <strong>{t('contribute.title')}</strong>
                  <span className="muted small">{t('profile.contributeHint')}</span>
                </span>
              </a>
            )}
          </section>

          <section className="card stack" aria-labelledby="pref-h">
            <h2 id="pref-h">{t('profile.preferences')}</h2>
            {conv.name ? (
              <p style={{ margin: 0 }}>
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
              <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{t('profile.theme')}</legend>
              <div className="segmented" role="group">
                {(['system', 'light', 'dark'] as Theme[]).map((th) => (
                  <button key={th} type="button" className={theme === th ? 'on' : ''} aria-pressed={theme === th} onClick={() => setTheme(th)}>
                    {t(`theme.${th}` as MessageKey)}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>

          {me && (
            <section className="card stack" style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--line))' }}>
              <h2 style={{ color: 'var(--danger)' }}>{t('profile.delete')}</h2>
              <p className="small" style={{ margin: 0 }}>{t('profile.deleteBody')}</p>
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
          )}
        </div>

        <div className="dash-col">
          <section className="card stack" aria-labelledby="dash-h">
            <div className="card-head">
              <h2 id="dash-h">{t('dash.title')}</h2>
              <span className="small muted">{t('dash.local')}</span>
            </div>
            <div className="stats">
              <div className="stat"><span className="stat-v">{history.length}</span><span className="stat-k">{t('dash.practiced')}</span></div>
              <div className="stat"><span className="stat-v">{practicedSlugs.size}</span><span className="stat-k">{t('dash.unique')}</span></div>
              <div className="stat"><span className="stat-v">{savedPhrases.length}</span><span className="stat-k">{t('dash.saved')}</span></div>
            </div>
            <h3 style={{ margin: '8px 0 0' }}>{t('dash.byCategory')}</h3>
            <ul className="progress-list">
              {CATEGORIES.map((c) => {
                const total = phrases.filter((p) => p.category === c).length;
                const done = phrases.filter((p) => p.category === c && practicedSlugs.has(p.slug)).length;
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <li key={c} className="progress-row">
                    <span>{t(`cat.${c}` as MessageKey)}</span>
                    <span className="num">{t('dash.of', { a: done, b: total })}</span>
                    <span className="bar" role="img" aria-label={`${done} / ${total}`}><span style={{ width: `${pct}%` }} /></span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card" aria-labelledby="recent-h">
            <div className="card-head">
              <h2 id="recent-h">{t('dash.recent')}</h2>
              {history.length > 0 && <button type="button" className="btn btn-quiet" onClick={() => learning.clearHistory()}>{t('dash.clear')}</button>}
            </div>
            {recent.length ? (
              <ul className="activity">
                {recent.map((h, i) => (
                  <li key={`${h.at}-${i}`}>
                    <span lang={lang}>{bySlug.get(h.slug)?.texts[lang]}</span>
                    <time dateTime={new Date(h.at).toISOString()}>{time.format(h.at)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">
                <p style={{ marginTop: 0 }}>{t('dash.empty')}</p>
                <a className="btn" href={href('phrasebook')}>{t('dash.openPhrasebook')}</a>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="saved-h">
            <div className="card-head"><h2 id="saved-h">{t('dash.saved')}</h2></div>
            {savedPhrases.length ? (
              <ul className="saved-list">
                {savedPhrases.map((p) => <li key={p.slug} lang={lang}>{p.texts[lang]}</li>)}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>{t('phrases.noSaved')}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Phrasebook
const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" /></svg>
);
const STAR_OUTLINE = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" /></svg>
);

type Filter = Category | 'all' | 'saved';

export function PhrasebookScreen() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const { phrases, saved } = useLearning();
  const [shown, setShown] = useState<PhraseRow | null>(null);
  const [own, setOwn] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conv.state.phase);
  // A second language under each phrase helps learning: English for Uzbek, Uzbek otherwise.
  const sub: Lang = lang === 'uz' ? 'en' : 'uz';
  const q = query.trim().toLowerCase();
  const visible = phrases.filter((p) =>
    (filter === 'all' || (filter === 'saved' ? saved.includes(p.slug) : p.category === filter)) &&
    (!q || LANGS.some((l) => p.texts[l]?.toLowerCase().includes(q))),
  );
  const count = (f: Filter) => phrases.filter((p) => (f === 'all' ? true : f === 'saved' ? saved.includes(p.slug) : p.category === f)).length;
  const play = (p: PhraseRow) => {
    if (busy) return;
    conv.speakDirect(p.texts[lang]);
    learning.practiced(p.slug);
  };
  const filters: Filter[] = ['all', 'saved', ...CATEGORIES];
  const label = (f: Filter) => (f === 'all' ? t('phrases.all') : f === 'saved' ? t('phrases.saved') : t(`cat.${f}` as MessageKey));

  return (
    <div className="pb">
      <div className="pb-head">
        <div>
          <h1>{t('phrases.title')}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{t('phrases.hint')}</p>
        </div>
        <span className="small muted">{t('phrases.count', { n: visible.length })}</span>
      </div>
      <div className="pb-tools">
        <div className="pb-search">
          <Icon name="search" />
          <label className="sr-only" htmlFor="pb-q">{t('phrases.search')}</label>
          <input id="pb-q" className="input" type="search" value={query} placeholder={t('phrases.search')} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="pb-filters" role="group" aria-label={t('phrases.title')}>
          {filters.map((f) => (
            <button key={f} type="button" className="filter-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'saved' && <span style={{ display: 'inline-flex', width: 14 }}>{STAR}</span>}
              {label(f)} <span className="count">{count(f)}</span>
            </button>
          ))}
        </div>
        <form
          className="own-text"
          style={{ margin: 0 }}
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
        <TtsNotice />
      </div>
      {visible.length === 0 ? (
        <p className="empty-state">{filter === 'saved' && !q ? t('phrases.noSaved') : t('phrases.none')}</p>
      ) : (
        <ul className="pb-grid">
          {visible.map((p) => {
            const on = saved.includes(p.slug);
            return (
              <li key={p.slug}>
                <article className="phrase-card">
                  <div className="phrase-card-top">
                    <span className="cat-badge">{t(`cat.${p.category}` as MessageKey)}</span>
                    <button type="button" className="star-btn" aria-pressed={on} aria-label={on ? t('phrases.unsave') : t('phrases.save')} title={on ? t('phrases.unsave') : t('phrases.save')} onClick={() => learning.toggleSave(p.slug)}>
                      {on ? STAR : STAR_OUTLINE}
                    </button>
                  </div>
                  <div>
                    <p className="phrase-card-text" lang={lang}>{p.texts[lang]}</p>
                    <p className="phrase-card-sub" lang={sub}>{p.texts[sub]}</p>
                  </div>
                  <div className="phrase-card-actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => play(p)} aria-label={t('speak.readAloud')}>
                      <Icon name="speaker" />
                      {t('phrases.listen')}
                    </button>
                    <button type="button" className="btn btn-icon" aria-label={t('phrases.show')} title={t('phrases.show')} onClick={() => { setShown(p); learning.practiced(p.slug); }}>
                      <Icon name="expand" />
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
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
