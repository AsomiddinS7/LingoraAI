// F9: About and limitations. Lists supported signs and where the tool must not be used.
import { Icon } from '../components/Icon';
import { InterpreterButton } from '../components/InterpreterButton';
import { VOCABULARY } from '../data';
import { useI18n } from '../i18n';
import { href } from '../router';

export function AboutScreen() {
  const { t, lang } = useI18n();
  return (
    <div>
      <div className="screen-title">
        <h1>{t('about.title')}</h1>
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

        <section className="card" aria-labelledby="signs">
          <div className="card-title">
            <h2 id="signs">{t('about.signs')}</h2>
            <span className="badge">{t('common.placeholder')}</span>
          </div>
          <ul className="sign-list">
            {VOCABULARY.map((v) => (
              <li key={v.label}>
                <div lang={lang} style={{ fontWeight: 700 }}>{v.gloss[lang]}</div>
                <code>{v.label}</code>
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
        </section>

        <section className="card">
          <h2>{t('about.more')}</h2>
          <div className="footer-links">
            <a className="btn" href={href('conversation')}>
              <Icon name="chat" />
              {t('nav.conversation')}
            </a>
            <a className="btn" href={href('console')}>
              <Icon name="sliders" />
              {t('nav.console')}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
