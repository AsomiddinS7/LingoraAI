import { PHRASE_CATEGORIES, PHRASES } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import type { Phrase } from '../types';
import { Icon, type IconName } from './Icon';

/** Phrasebook list (F7). Works with every other feature off: pure local data. */
export function PhraseList({ onPick, icon = 'play', headingLevel = 3 }: { onPick: (p: Phrase) => void; icon?: IconName; headingLevel?: 2 | 3 }) {
  const { t, lang } = useI18n();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div>
      {PHRASE_CATEGORIES.map((cat) => (
        <section key={cat} aria-labelledby={`cat-${cat}`}>
          <H className="cat-title eyebrow" id={`cat-${cat}`}>
            {t(`phrases.cat.${cat}` as MessageKey)}
          </H>
          <ul className="phrase-list">
            {PHRASES.filter((p) => p.category === cat).map((p) => (
              <li key={p.id}>
                <button type="button" className="phrase-btn" onClick={() => onPick(p)} lang={lang}>
                  <span>{p.text[lang]}</span>
                  <Icon name={icon} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
