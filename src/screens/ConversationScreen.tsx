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

export function ConversationScreen() {
  const { t } = useI18n();
  const conv = useConversation();
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
        <CameraPanel />
        <div className="stage">
          <SignWindowPanel />
          <SentenceCard />
          <TypedMessage />
          <RecognitionStatus />
          <a className="link-btn" href={href('presentation')}>{t('presentation.open')}</a>
        </div>
      </section>
      <section className="talk-chat" aria-label={t('transcript.title')}>
        <Chat />
        <Composer />
      </section>
    </div>
  );
}
