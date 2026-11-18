// Guests type their name once per session for the my_name sign (v1 spec 2.2). Memory only.
import { useState } from 'react';
import { NAME_MAX } from '../api/validate';
import { useI18n } from '../i18n';
import { useConversation } from '../state/ConversationContext';

export function NamePrompt() {
  const { t } = useI18n();
  const conv = useConversation();
  const [draft, setDraft] = useState(conv.name);
  return (
    <form
      className="field name-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) conv.setName(draft.trim());
      }}
    >
      <label htmlFor="session-name">{t('name.prompt')}</label>
      <div className="inline-form">
        <input
          id="session-name"
          className="input"
          value={draft}
          maxLength={NAME_MAX}
          autoComplete="given-name"
          placeholder={t('name.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
          {t('name.save')}
        </button>
      </div>
      <p className="small muted">{t('name.note')}</p>
    </form>
  );
}
