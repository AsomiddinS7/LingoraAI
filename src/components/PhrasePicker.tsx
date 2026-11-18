// Phrasebook grid (F7). Phrases come from GET /api/phrasebook with a bundled fallback,
// so it works with everything else off.
import { useCatalog, catalog, type PhraseRow } from '../data';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './Icon';

export function PhraseList({ onPick, icon = 'speaker' }: { onPick: (p: PhraseRow) => void; icon?: IconName }) {
  const { lang } = useI18n();
  useCatalog();
  return (
    <ul className="phrase-grid">
      {catalog.phrases().map((p) => (
        <li key={p.id}>
          <button type="button" className="phrase-btn" onClick={() => onPick(p)} lang={lang}>
            <span>{p.texts[lang]}</span>
            <Icon name={icon} />
          </button>
        </li>
      ))}
    </ul>
  );
}
