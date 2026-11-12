import { useEffect, useRef, type ReactNode } from 'react';
import { whichPlan } from '../config';
import { useI18n, type MessageKey } from '../i18n';
import { usesMockApi } from '../providers';
import { href, useRoute, type Route } from '../router';
import { useRuntime } from '../runtime';
import { LANGS, type Lang } from '../types';
import { BrandMark, Icon, type IconName } from './Icon';
import { InterpreterButton } from './InterpreterButton';
import { OfflineBanner } from './Notices';

const TOP: { route: Route; key: MessageKey }[] = [
  { route: 'sign', key: 'nav.sign' },
  { route: 'speak', key: 'nav.speak' },
  { route: 'phrases', key: 'nav.phrases' },
  { route: 'conversation', key: 'nav.conversation' },
  { route: 'console', key: 'nav.console' },
  { route: 'about', key: 'nav.about' },
];

const BOTTOM: { route: Route; key: MessageKey; icon: IconName }[] = [
  { route: 'sign', key: 'nav.sign', icon: 'hand' },
  { route: 'speak', key: 'nav.speak', icon: 'speaker' },
  { route: 'phrases', key: 'nav.phrases', icon: 'book' },
  { route: 'about', key: 'nav.about', icon: 'info' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const route = useRoute();
  const config = useRuntime((s) => s.config);
  const plan = whichPlan(config);
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
        <a className="brand" href={href('sign')}>
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
          <div className="badges">
            {usesMockApi(config) && <span className="badge">{t('badge.mock')}</span>}
            <span className="badge plain">{plan === 'custom' ? t('badge.planCustom') : t('badge.plan', { plan })}</span>
          </div>
          <label className="sr-only" htmlFor="lang-select">{t('lang.label')}</label>
          <select id="lang-select" className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l} lang={l}>
                {t(`lang.${l}` as MessageKey)}
              </option>
            ))}
          </select>
          <InterpreterButton compact />
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
