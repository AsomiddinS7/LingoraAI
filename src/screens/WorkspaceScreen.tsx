// Screen B: desktop conversation workspace (1280 px), stacks on phones.
import { CameraPanel } from '../components/CameraPanel';
import { InterpreterButton } from '../components/InterpreterButton';
import { LatestReply, PushToTalk, TypedReply } from '../components/ListenerPanel';
import { PhraseList } from '../components/PhrasePicker';
import { SignControls, SignFlow } from '../components/SignFlow';
import { TranscriptList } from '../components/TranscriptList';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';

export function WorkspaceScreen() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conv.state.phase);

  return (
    <div>
      <div className="screen-title">
        <h1>{t('ws.title')}</h1>
        <InterpreterButton />
      </div>
      <div className="workspace">
        <section className="stack col-sticky" aria-labelledby="ws-signer">
          <h2 id="ws-signer" className="eyebrow">{t('ws.signer')}</h2>
          <CameraPanel />
          <SignControls />
          <SignFlow />
        </section>

        <section className="stack" aria-labelledby="ws-transcript">
          <div className="card">
            <h2 id="ws-transcript">{t('transcript.title')}</h2>
            <TranscriptList />
          </div>
          <LatestReply />
          <div className="card stack">
            <h2 style={{ margin: 0 }}>{t('listener.title')}</h2>
            <PushToTalk />
            <TypedReply />
          </div>
        </section>

        <section className="card col-sticky" aria-labelledby="ws-phrases" style={{ maxHeight: 'calc(100dvh - 100px)', overflowY: 'auto' }}>
          <h2 id="ws-phrases">{t('ws.phrasebook')}</h2>
          <PhraseList
            icon="check"
            onPick={(p) => {
              if (!busy) conv.dispatch({ type: 'CHOOSE_PHRASE', text: p.text[lang] });
            }}
          />
        </section>
      </div>
    </div>
  );
}
