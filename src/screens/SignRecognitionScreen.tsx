import { useEffect, useRef } from 'react';
import { CameraPanel } from '../components/CameraPanel';
import { Chat, Composer } from '../components/Chat';
import { SentenceCard } from '../components/ConversationCards';
import { Icon } from '../components/Icon';
import { SignWindowPanel } from '../components/SignWindowPanel';
import { useI18n } from '../i18n';
import { useCamera } from '../state/CameraContext';
import { useConversation } from '../state/ConversationContext';

/** Real model recognition; the prepared presentation lives on the conversation page. */
export function SignRecognitionScreen() {
  const { t } = useI18n();
  const camera = useCamera();
  const conversation = useConversation();
  const current = useRef(conversation);
  current.current = conversation;
  useEffect(() => () => { current.current.pttCancel(); current.current.cancelSpeech(); }, []);
  return <div className="talk">
    <h1 className="sr-only">{t('nav.sign')}</h1>
    <section className="talk-signer" aria-label={t('ws.signer')}>
      <div className="panel cam-panel">
        <div className="panel-head">
          <h2 className="panel-title"><Icon name="camera" />{t('panel.input')}</h2>
          <span className={`status-dot${camera.status === 'live' ? ' on' : ''}`}>{camera.status === 'live' ? t('panel.live') : t('panel.off')}</span>
        </div>
        <div className="panel-body"><CameraPanel /></div>
      </div>
      <div className="stage"><SignWindowPanel /><SentenceCard /></div>
    </section>
    <section className="talk-chat panel chat-panel" aria-labelledby="sign-chat-heading">
      <div className="panel-head"><h2 className="panel-title" id="sign-chat-heading"><Icon name="chat" />{t('panel.conversation')}</h2></div>
      <Chat speechOnly /><Composer speechOnly />
    </section>
  </div>;
}
