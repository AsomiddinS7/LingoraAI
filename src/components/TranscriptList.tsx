import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';

/** Signer sentences, listener text and simplified text. All text rendered escaped (React text nodes). */
export function TranscriptList() {
  const { t, lang } = useI18n();
  const { state } = useConversation();
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [state.turns.length]);

  if (state.turns.length === 0) return <p className="muted">{t('transcript.empty')}</p>;

  return (
    <ol className="transcript" aria-live="polite">
      {state.turns.map((turn) => (
        <li key={turn.id} className={`turn ${turn.speaker} ${turn.simplifiedFrom ? 'simplified' : ''}`}>
          <div className="who">
            <span>{turn.speaker === 'signer' ? t('transcript.signer') : t('transcript.listener')}</span>
            {turn.simplifiedFrom && <span className="chip">{t('transcript.simplified')}</span>}
            <time dateTime={new Date(turn.at).toISOString()}>
              {new Date(turn.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
            </time>
          </div>
          <div className="text" lang={lang}>{turn.text}</div>
        </li>
      ))}
      <li ref={endRef} aria-hidden="true" style={{ listStyle: 'none' }} />
    </ol>
  );
}
