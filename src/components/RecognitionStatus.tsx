import { glossFor } from '../data';
import { useI18n } from '../i18n';
import { sequenceStore, useSequenceVersion } from '../ml/sequenceStore';
import { useRuntime } from '../runtime';
import { href } from '../router';

export function RecognitionStatus() {
  const { t, lang } = useI18n();
  useSequenceVersion();
  const recognizer = useRuntime((s) => s.config.recognizer);
  const labels = Object.keys(sequenceStore.counts());
  if (recognizer === 'mock') return <p className="notice warn" role="status">{t('motion.demo')}</p>;
  if (recognizer !== 'motion') return null;
  return <div className="recognition-status" role="status">
    <strong>{t('motion.title')}</strong>
    {!labels.length && <p>{t('motion.empty')}</p>}
    {labels.length > 0 && <p className="supported-signs">{labels.map((l) => glossFor(l, lang)).join(' · ')}</p>}
    <details><summary>{t('motion.details')}</summary>
      <p>{labels.length ? t('motion.ready', { n: labels.length }) : t('motion.empty')}</p>
      <p className="small muted">{t('motion.instructions')}</p>
      <a className="link-btn" href={href('console')}>{t('motion.prepare')}</a>
    </details>
  </div>;
}
