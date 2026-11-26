// Conversation (main), minimal: no page title, no duplicate panels.
// Phone: compact camera + one action row on top, the chat below, the reply bar pinned at the bottom.
// Desktop: camera and the sign flow on the left; the chat and the reply bar on the right.
import { CameraPanel } from '../components/CameraPanel';
import { Chat, Composer } from '../components/Chat';
import { SentenceCard } from '../components/ConversationCards';
import { SignWindowPanel } from '../components/SignWindowPanel';
import { useI18n } from '../i18n';
import { RecognitionStatus } from '../components/RecognitionStatus';
import { TypedMessage } from '../components/TypedMessage';
import { useEffect, useRef } from 'react';
import { useConversation } from '../state/ConversationContext';
import { href } from '../router';
import { Icon } from '../components/Icon';
import { useCamera } from '../state/CameraContext';

export function ConversationScreen() {
  const { t } = useI18n();
  const conv = useConversation();
  const cam = useCamera();
  const current = useRef(conv);
  current.current = conv;
  useEffect(() => () => {
    // A microphone must never keep listening after its conversation screen closes.
    current.current.pttCancel();
    current.current.cancelSpeech();
  }, []);
  return (
    <div className="talk">
      <h1 className="sr-only">{t('nav.conversation')}</h1>
      <section className="talk-signer" aria-label={t('ws.signer')}>
        <div className="panel cam-panel">
          <div className="panel-head">
            <h2 className="panel-title"><Icon name="camera" />{t('panel.input')}</h2>
            <span className={`status-dot${cam.status === 'live' ? ' on' : ''}`}>{cam.status === 'live' ? t('panel.live') : t('panel.off')}</span>
          </div>
          <div className="panel-body"><CameraPanel /></div>
        </div>
        <div className="stage">
          <SignWindowPanel />
          <SentenceCard />
          <TypedMessage />
          <RecognitionStatus />
          <a className="link-btn" href={href('presentation')}>{t('presentation.open')}</a>
        </div>
      </section>
      <section className="talk-chat panel chat-panel" aria-labelledby="chat-h">
        <div className="panel-head">
          <h2 className="panel-title" id="chat-h"><Icon name="chat" />{t('panel.conversation')}</h2>
        </div>
        <Chat />
        <Composer />
      </section>
    </div>
  );
}
