// Conversation (main), minimal: no page title, no duplicate panels.
// Phone: compact camera + one action row on top, the chat below, the reply bar pinned at the bottom.
// Desktop: camera and the sign flow on the left; the chat and the reply bar on the right.
import { CameraPanel } from '../components/CameraPanel';
import { Chat, Composer } from '../components/Chat';
import { SentenceCard } from '../components/ConversationCards';
import { SignWindowPanel } from '../components/SignWindowPanel';
import { RecognitionStatus } from '../components/RecognitionStatus';
import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useConversation } from '../state/ConversationContext';
import { MovementAudio } from '../components/MovementAudio';
import { Icon } from '../components/Icon';
import { useCamera } from '../state/CameraContext';
import { useSignWindow } from '../state/SignWindowContext';

export function ConversationScreen() {
  const { t, lang } = useI18n();
  const say = (uz: string, en: string, ru: string) => lang === 'uz' ? uz : lang === 'ru' ? ru : en;
  const [mode, setMode] = useState<'recognition' | 'prepared'>('recognition');
  const conv = useConversation();
  const cam = useCamera();
  const signWindow = useSignWindow();
  const modeBusy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING', 'CONFIRM_SENTENCE'].includes(conv.state.phase);
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
          <div className="conversation-modes" role="group" aria-label={say('Ishora rejimi', 'Sign mode', 'Режим жестов')}>
            <button type="button" className="btn" aria-pressed={mode === 'recognition'} disabled={modeBusy}
              onClick={() => setMode('recognition')}>{say('Ishorani aniqlash', 'Sign recognition', 'Распознавание жестов')}</button>
            <button type="button" className="btn" aria-pressed={mode === 'prepared'} disabled={modeBusy}
              onClick={() => { signWindow.cancel(); conv.dispatch({ type: 'CLEAR_SIGNS' }); setMode('prepared'); }}>{say('Tayyor audio', 'Prepared audio', 'Готовая запись')}</button>
          </div>
          {mode === 'prepared' ? <MovementAudio /> : <><SignWindowPanel /><RecognitionStatus /></>}
          <SentenceCard />
        </div>
      </section>
      <section className="talk-chat panel chat-panel" aria-labelledby="chat-h">
        <div className="panel-head">
          <h2 className="panel-title" id="chat-h"><Icon name="chat" />{t('panel.conversation')}</h2>
        </div>
        <Chat speechOnly />
        <Composer speechOnly />
      </section>
    </div>
  );
}
