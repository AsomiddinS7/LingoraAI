import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { href, useRoute, type Route } from '../router';
import { LANGS, type Lang } from '../types';
import { BrandMark, Icon, type IconName } from './Icon';
import { InterpreterButton } from './InterpreterButton';
import { OfflineBanner } from './Notices';
import { useAccount } from '../account';
import { accountsEnabled } from '../config';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Signed in: avatar + name (opens Profile). Signed out: sign-in entry. Without accounts: Profile. */
function AccountControl() {
  const { t } = useI18n();
  const me = useAccount();
  if (me) {
    return (
      <a className="account-btn" href={href('profile')} aria-label={`${t('nav.account')}: ${me.display_name}`}>
        <span className="avatar" aria-hidden="true">{initials(me.display_name)}</span>
        <span className="account-name">{me.display_name}</span>
      </a>
    );
  }
  return (
    <a className="account-btn signed-out" href={href(accountsEnabled ? 'signin' : 'profile')} aria-label={accountsEnabled ? t('welcome.signin') : t('nav.profile')}>
      <span className="avatar" aria-hidden="true"><Icon name="person" /></span>
      <span className="account-name">{accountsEnabled ? t('welcome.signin') : t('nav.profile')}</span>
    </a>
  );
}

const TOP: { route: Route; key: MessageKey }[] = [
  { route: 'conversation', key: 'nav.conversation' },
  { route: 'presentation', key: 'presentation.nav' },
  { route: 'phrasebook', key: 'nav.phrasebook' },
  { route: 'help', key: 'nav.help' },
  { route: 'profile', key: 'nav.profile' },
];

const BOTTOM: { route: Route; key: MessageKey; icon: IconName }[] = [
  { route: 'conversation', key: 'nav.conversation', icon: 'chat' },
  { route: 'presentation', key: 'presentation.short', icon: 'hand' },
  { route: 'phrasebook', key: 'nav.phrasebook', icon: 'book' },
  { route: 'help', key: 'nav.help', icon: 'info' },
  { route: 'profile', key: 'nav.profile', icon: 'person' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page on navigation so screen readers announce the new screen.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus();
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        {t('app.skip')}
      </a>
      <header className="header">
        <a className="brand" href={href('conversation')}>
          <BrandMark />
          <span>{t('app.name')}</span>
        </a>
        <nav className="top-nav" aria-label={t('nav.main')}>
          {TOP.map((n) => (
            <a key={n.route} href={href(n.route)} aria-current={route === n.route ? 'page' : undefined}>
              {t(n.key)}
            </a>
          ))}
        </nav>
        <div className="header-tools">
          <label className="sr-only" htmlFor="lang-select">{t('lang.label')}</label>
          <span className="lang-select-wrap">
            <select id="lang-select" className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l} value={l} lang={l}>
                  {t(`lang.${l}` as MessageKey)}
                </option>
              ))}
            </select>
          </span>
          <InterpreterButton compact />
          <AccountControl />
        </div>
      </header>
      <OfflineBanner />
      <main id="main" ref={mainRef} tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      <nav className="bottom-nav" aria-label={t('nav.main')}>
        {BOTTOM.map((n) => (
          <a key={n.route} href={href(n.route)} aria-current={route === n.route ? 'page' : undefined}>
            <span className="ico-wrap"><Icon name={n.icon} /></span>
            {t(n.key)}
          </a>
        ))}
      </nav>
    </div>
  );
}
