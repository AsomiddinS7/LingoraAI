// Phrasebook (F7): local data only, so it works with everything else off.
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { TtsNotice } from '../components/Notices';
import { PhraseList } from '../components/PhrasePicker';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';
import type { Phrase } from '../types';

export function PhrasesScreen() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const [shown, setShown] = useState<Phrase | null>(null);
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conv.state.phase);

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="screen-title">
        <h1>{t('phrases.title')}</h1>
        <span className="badge">{t('common.placeholder')}</span>
      </div>
      <p className="muted">{t('phrases.hint')}</p>
      <TtsNotice />
      <PhraseList onPick={setShown} icon="play" />
      <Modal open={!!shown} onClose={() => setShown(null)} title={t('phrases.title')}>
        {shown && (
          <div className="phrase-show stack">
            <p className="result-text xl" lang={lang}>{shown.text[lang]}</p>
            <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => conv.speakDirect(shown.text[lang])}>
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
