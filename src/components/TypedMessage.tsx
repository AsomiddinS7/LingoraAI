import { useState } from 'react';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';

export function TypedMessage() {
  const { t, lang } = useI18n();
  const { state, dispatch } = useConversation();
  const [text, setText] = useState('');
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(state.phase);
  return <details className="typed-message">
    <summary>{t('message.writeInstead')}</summary>
    <form className="stack" onSubmit={(event) => {
      event.preventDefault();
      if (!text.trim() || busy) return;
      dispatch({ type: 'CHOOSE_PHRASE', text: text.trim() });
      setText('');
      event.currentTarget.closest('details')?.removeAttribute('open');
    }}>
      <label htmlFor="signer-message">{t('message.label')}</label>
      <textarea id="signer-message" className="input" rows={2} maxLength={300} value={text} lang={lang} onChange={(e) => setText(e.target.value)} />
      <button className="btn" type="submit" disabled={!text.trim() || busy}>{t('message.review')}</button>
    </form>
  </details>;
}
