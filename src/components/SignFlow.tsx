// Signer side of the conversation: confirm sign -> compose -> confirm sentence -> speak (F2-F4).
import { useState } from 'react';
import { glossFor, signsAsWords } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import { useRuntime } from '../runtime';
import { useCamera } from '../state/CameraContext';
import { useConversation } from '../state/ConversationContext';
import { MAX_SIGNS } from '../state/machine';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { TtsNotice, useErrorText } from './Notices';
import { PhraseList } from './PhrasePicker';
import { confidenceKey } from './StatusChip';

export function SignControls() {
  const { t } = useI18n();
  const { state, dispatch, classifierStatus } = useConversation();
  const cam = useCamera();
  const running = state.phase !== 'IDLE';
  const canStart = ['IDLE', 'LISTENER_TURN', 'ERROR'].includes(state.phase);

  return (
    <div className="btn-row">
      {canStart && (
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={classifierStatus === 'failed' || classifierStatus === 'loading'}
          onClick={() => {
            if (cam.status !== 'live') void cam.start();
            dispatch({ type: 'START' });
          }}
        >
          <Icon name="hand" />
          {state.phase === 'LISTENER_TURN' ? t('conv.myTurn') : t('conv.start')}
        </button>
      )}
      {running && (
        <button type="button" className="btn btn-lg" onClick={() => dispatch({ type: 'STOP' })}>
          <Icon name="stop" />
          {t('conv.stop')}
        </button>
      )}
    </div>
  );
}

function ConfirmSignCard() {
  const { t, lang } = useI18n();
  const { state, dispatch } = useConversation();
  const threshold = useRuntime((s) => s.config.confidenceThreshold);
  const [picking, setPicking] = useState(false);
  const c = state.candidate;
  if (state.phase !== 'CONFIRM_SIGN' || !c) return null;
  const pct = Math.round(c.confidence * 100);

  return (
    <div className="card" role="region" aria-labelledby="sign-detected">
      <p className="eyebrow" id="sign-detected">{t('conv.signDetected')}</p>
      <p className="result-text" lang={lang}>{glossFor(c.label, lang)}</p>
      <p className="muted">{t(confidenceKey(c.confidence, threshold), { pct })}</p>
      {state.buffer.length > 0 && (
        <p className="small muted">{t('conv.signsSoFar', { signs: state.buffer.map((b) => glossFor(b.label, lang)).join(', ') })}</p>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'ACCEPT_SIGN' })} autoFocus>
          <Icon name="check" />
          {t('conv.acceptSign')}
        </button>
        {state.buffer.length + 1 < MAX_SIGNS && (
          <button type="button" className="btn" onClick={() => dispatch({ type: 'ADD_SIGN' })}>
            <Icon name="plus" />
            {t('conv.addSign')}
          </button>
        )}
        <button type="button" className="btn" onClick={() => dispatch({ type: 'DISCARD_SIGN' })}>
          <Icon name="x" />
          {t('conv.discardSign')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setPicking(true)}>
          <Icon name="book" />
          {t('conv.choosePhrase')}
        </button>
      </div>
      <PhrasePickerModal open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

export function PhrasePickerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { dispatch } = useConversation();
  return (
    <Modal open={open} onClose={onClose} title={t('phrases.pickTitle')}>
      <PhraseList
        icon="check"
        onPick={(p) => {
          dispatch({ type: 'CHOOSE_PHRASE', text: p.text[lang] });
          onClose();
        }}
      />
    </Modal>
  );
}

/** ResultCard: composing, proposed sentence (accept/reject), speaking, errors with fallbacks. */
export function ResultCard() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const { state, dispatch } = conv;
  const errorText = useErrorText();
  const lastSigner = [...state.turns].reverse().find((x) => x.speaker === 'signer');

  if (state.phase === 'COMPOSING')
    return (
      <div className="card" role="status" aria-live="polite">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="spinner" aria-hidden="true" />
          <strong>{t('conv.composing')}</strong>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {t('conv.signsSoFar', { signs: state.buffer.map((b) => glossFor(b.label, lang)).join(', ') })}
        </p>
      </div>
    );

  if (state.phase === 'CONFIRM_SENTENCE' && state.proposal)
    return (
      <div className="card" role="region" aria-labelledby="proposed" aria-live="polite">
        <p className="eyebrow" id="proposed">{t('conv.proposed')}</p>
        <p className="result-text" lang={lang}>{state.proposal.text}</p>
        <p className="small muted">
          {t(`conv.source.${state.proposal.source}` as MessageKey)} · {t('conv.proposedHint')}
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-lg" onClick={conv.acceptSentence} autoFocus>
            <Icon name="speaker" />
            {t('conv.acceptSentence')}
          </button>
          <button type="button" className="btn btn-lg" onClick={() => dispatch({ type: 'REJECT_SENTENCE' })}>
            <Icon name="x" />
            {t('conv.rejectSentence')}
          </button>
        </div>
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
            <button type="button" className="btn" onClick={() => dispatch({ type: 'START' })}>
              <Icon name="hand" />
              {t('conv.start')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <TtsNotice />
      {lastSigner && (
        <div className="card">
          <p className="eyebrow">{t('conv.lastSpoken')}</p>
          <p className="result-text" lang={lang}>{lastSigner.text}</p>
        </div>
      )}
      {state.phase === 'LISTENER_TURN' && (
        <div className="notice info" role="status">
          <Icon name="person" />
          <p>{t('conv.listenerTurn')}</p>
        </div>
      )}
    </>
  );
}

/** ActionBar: Read aloud, Choose a phrase. */
export function ActionBar() {
  const { t } = useI18n();
  const { state, dispatch } = useConversation();
  const [picking, setPicking] = useState(false);
  const lastSigner = [...state.turns].reverse().find((x) => x.speaker === 'signer');
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(state.phase);
  return (
    <div className="btn-row">
      <button type="button" className="btn btn-lg" disabled={!lastSigner || busy} onClick={() => lastSigner && dispatch({ type: 'REPEAT', text: lastSigner.text })}>
        <Icon name="speaker" />
        {t('conv.readAgain')}
      </button>
      <button type="button" className="btn btn-lg" disabled={busy} onClick={() => setPicking(true)}>
        <Icon name="book" />
        {t('conv.choosePhrase')}
      </button>
      <PhrasePickerModal open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

export function SignFlow() {
  return (
    <div className="stack">
      <ConfirmSignCard />
      <ResultCard />
    </div>
  );
}
