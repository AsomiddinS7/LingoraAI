// Conversation (main). Phone: camera on top, Sign now, result card, conversation list.
// Desktop: camera and result on the left, conversation and listener input on the right.
import { useState } from 'react';
import { CameraPanel } from '../components/CameraPanel';
import { PhrasePickerModal, SentenceCard } from '../components/ConversationCards';
import { Icon } from '../components/Icon';
import { InterpreterButton } from '../components/InterpreterButton';
import { LatestReply, PushToTalk, TypedReply } from '../components/ListenerPanel';
import { SignWindowPanel } from '../components/SignWindowPanel';
import { TranscriptList } from '../components/TranscriptList';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';

export function ConversationScreen() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState('');
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conv.state.phase);

  return (
    <div>
      <div className="screen-title">
        <h1>{t('nav.conversation')}</h1>
        <InterpreterButton />
      </div>
      <div className="conv-layout">
        <section className="stack conv-signer" aria-labelledby="signer-h">
          <h2 id="signer-h" className="eyebrow">{t('ws.signer')}</h2>
          <CameraPanel />
          <SignWindowPanel />
          <SentenceCard />
          <details className="card type-instead">
            <summary>{t('conv.typeInstead')}</summary>
            <form
              className="field"
              style={{ marginTop: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) {
                  conv.speakDirect(typed);
                  setTyped('');
                }
              }}
            >
              <label htmlFor="type-to-speak">{t('speak.typeLabel')}</label>
              <textarea id="type-to-speak" className="input" lang={lang} rows={2} value={typed} onChange={(e) => setTyped(e.target.value)} />
              <div className="btn-row">
                <button type="submit" className="btn btn-primary" disabled={!typed.trim() || busy}>
                  <Icon name="speaker" />
                  {t('speak.readAloud')}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setPicking(true)}>
                  <Icon name="book" />
                  {t('win.choosePhrase')}
                </button>
              </div>
            </form>
            <PhrasePickerModal open={picking} onClose={() => setPicking(false)} />
          </details>
        </section>

        <section className="stack conv-listener" aria-labelledby="conv-h">
          <div className="card">
            <h2 id="conv-h">{t('transcript.title')}</h2>
            <TranscriptList />
          </div>
          <LatestReply />
          <div className="card stack">
            <h2 style={{ margin: 0 }}>{t('listener.title')}</h2>
            <PushToTalk />
            <TypedReply />
          </div>
        </section>
      </div>
    </div>
  );
}
