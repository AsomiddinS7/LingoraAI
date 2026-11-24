// Sentence flow after a sign is confirmed: composing -> proposed sentence (Speak / Edit / Reject)
// -> speaking. Nothing is spoken before the signer confirms (v1 spec 8, step 6).
import { useState } from 'react';
import { platformApiEnabled } from '../config';
import { glossFor, signsAsWords } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import { useConversation } from '../state/ConversationContext';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { TtsNotice, useErrorText } from './Notices';
import { PhraseList } from './PhrasePicker';

export function PhrasePickerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { dispatch } = useConversation();
  return (
    <Modal open={open} onClose={onClose} title={t('phrases.pickTitle')}>
      <PhraseList
        icon="check"
        onPick={(p) => {
          dispatch({ type: 'CHOOSE_PHRASE', text: p.texts[lang] });
          onClose();
        }}
      />
    </Modal>
  );
}

export function SentenceCard() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const { state, dispatch } = conv;
  const errorText = useErrorText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [report, setReport] = useState<'ok' | 'failed' | null>(null);

  if (state.phase === 'COMPOSING')
    return (
      <div className="card" role="status" aria-live="polite">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="spinner" aria-hidden="true" />
          <strong>{t('conv.composing')}</strong>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {t('conv.signsSoFar', { signs: state.buffer.map((b) => glossFor(b.label, lang)).join(' · ') })}
        </p>
      </div>
    );

  if (state.phase === 'CONFIRM_SENTENCE' && state.proposal)
    return (
      <div className="card" role="region" aria-labelledby="proposed" aria-live="polite">
        <p className="eyebrow" id="proposed">{t('conv.proposed')}</p>
        {editing ? (
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({ type: 'EDIT_PROPOSAL', text: draft });
              setEditing(false);
            }}
          >
            <label htmlFor="edit-sentence" className="sr-only">{t('sentence.edit')}</label>
            <textarea id="edit-sentence" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} lang={lang} autoFocus />
            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>{t('sentence.save')}</button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            </div>
          </form>
        ) : (
          <p className="result-text" lang={state.proposal.language ?? lang}>{state.proposal.text}</p>
        )}
        <p className="small muted">
          {t(`conv.source.${state.proposal.source}` as MessageKey)} · {t('conv.proposedHint')}
        </p>
        {!editing && (
          <div className="btn-row">
            <button type="button" className="btn btn-primary btn-lg" onClick={conv.acceptSentence} autoFocus>
              <Icon name="speaker" />
              {t('sentence.speak')}
            </button>
            <button
              type="button"
              className="btn btn-lg"
              onClick={() => {
                setDraft(state.proposal!.text);
                setEditing(true);
              }}
            >
              <Icon name="edit" />
              {t('sentence.edit')}
            </button>
            <button type="button" className="btn btn-lg btn-quiet" onClick={() => dispatch({ type: 'REJECT_SENTENCE' })}>
              <Icon name="x" />
              {t('conv.rejectSentence')}
            </button>
          </div>
        )}
        {platformApiEnabled && state.proposal.source === 'model' && (
          <div className="feedback-row">
            {report === null ? (
              <button type="button" className="link-btn" onClick={async () => setReport(await conv.sendFeedback('wrong_translation', state.buffer.map((b) => b.label)))}>
                {t('sentence.wrongTranslation')}
              </button>
            ) : (
              <span role="status" className="small muted">{report === 'ok' ? t('win.reported') : t('win.reportFailed')}</span>
            )}
          </div>
        )}
      </div>
    );

  if (state.phase === 'SPEAKING' && state.speaking)
    return (
      <div className="card" role="status" aria-live="polite">
        <p className="eyebrow">{t('conv.speaking')}</p>
        <p className="result-text" lang={lang}>{state.speaking}</p>
        <button type="button" className="btn" onClick={conv.cancelSpeech}>
          <Icon name="stop" />
          {t('conv.stopSpeaking')}
        </button>
      </div>
    );

  if (state.phase === 'ERROR' && state.error) {
    const refused = state.error.kind === 'refused';
    return (
      <div className={`notice ${refused ? 'warn' : 'bad'}`} role="alert">
        <Icon name={refused ? 'person' : 'alert'} />
        <div style={{ flex: 1 }}>
          <strong>{refused ? t('refusal.title') : t('error.title')}</strong>
          <p>{errorText(state.error)}</p>
          {!refused && <p className="small">{t('error.fallbackHint')}</p>}
          <div className="btn-row" style={{ marginTop: 10 }}>
            {!refused && state.buffer.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'USE_WORDS', text: signsAsWords(state.buffer.map((b) => b.label), lang) })}>
                {t('error.useWords')}
              </button>
            )}
            {!refused && state.error.kind === 'api' && state.error.code !== 'CAP_REACHED' && (
              <button type="button" className="btn" onClick={() => dispatch({ type: 'RETRY' })}>
                <Icon name="refresh" />
                {t('common.retry')}
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => dispatch({ type: 'CLEAR_SIGNS' })}>
              {t('win.clearSigns')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <TtsNotice />;
}
