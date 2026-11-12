// Text to speech: the signer types and it is read aloud; or the hearing person's reply as large text.
// Works with the classifier and the API both down (N2, U1).
import { useState } from 'react';
import { ListenerPanel } from '../components/ListenerPanel';
import { Icon } from '../components/Icon';
import { TtsNotice } from '../components/Notices';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';

type Tab = 'type' | 'reply';

export function SpeakScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('type');
  return (
    <div>
      <div className="screen-title">
        <h1>{t('speak.title')}</h1>
      </div>
      <div className="tabs" role="tablist" aria-label={t('speak.tabs')}>
        <button type="button" role="tab" id="tab-type" aria-selected={tab === 'type'} aria-controls="panel-type" onClick={() => setTab('type')}>
          {t('speak.tabType')}
        </button>
        <button type="button" role="tab" id="tab-reply" aria-selected={tab === 'reply'} aria-controls="panel-reply" onClick={() => setTab('reply')}>
          {t('speak.tabReply')}
        </button>
      </div>
      {tab === 'type' ? (
        <div role="tabpanel" id="panel-type" aria-labelledby="tab-type">
          <TypeToSpeak />
        </div>
      ) : (
        <div role="tabpanel" id="panel-reply" aria-labelledby="tab-reply" style={{ maxWidth: 760 }}>
          <ListenerPanel />
        </div>
      )}
    </div>
  );
}

function TypeToSpeak() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const [text, setText] = useState('');
  const speaking = conv.state.phase === 'SPEAKING';
  const blocked = ['COMPOSING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conv.state.phase);

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) conv.speakDirect(text);
        }}
      >
        <div className="field">
          <label htmlFor="type-to-speak">{t('speak.typeLabel')}</label>
          <textarea id="type-to-speak" className="input" lang={lang} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('speak.typePlaceholder')} rows={3} />
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={!text.trim() || speaking || blocked}>
            <Icon name="speaker" />
            {t('speak.readAloud')}
          </button>
          {speaking && (
            <button type="button" className="btn btn-lg" onClick={conv.cancelSpeech}>
              <Icon name="stop" />
              {t('conv.stopSpeaking')}
            </button>
          )}
          <button type="button" className="btn btn-lg btn-quiet" onClick={() => setText('')} disabled={!text}>
            {t('speak.clear')}
          </button>
        </div>
      </form>
      {text.trim() && (
        <div className="card" aria-live="polite">
          <p className="result-text xl" lang={lang}>{text}</p>
        </div>
      )}
      <TtsNotice />
    </div>
  );
}
