// Conversation as a chat (pattern from Google Live Transcribe): the transcript IS the screen.
// Signer messages on one side, hearing-person messages on the other, newest reply largest.
// Every message can be shown full screen and flipped for the person across the table
// (pattern from Microsoft Translator's face-to-face mode).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SIMPLIFY_MAX_CHARS } from '../api/validate';
import { phraseBySlug } from '../data';
import { useI18n } from '../i18n';
import { getStt, useLocalSttStatus } from '../providers';
import { useRuntime } from '../runtime';
import { useConversation } from '../state/ConversationContext';
import { LISTENER_ENTRY } from '../state/machine';
import type { Turn } from '../types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { useErrorText } from './Notices';

// ---------------------------------------------------------------- full-screen text
export function BigText({ text, onClose }: { text: string | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    setFlipped(false);
  }, [text]);
  if (!text) return null;
  return (
    <div className="bigtext" role="dialog" aria-modal="true" aria-label={t('conv.showBig')}>
      <p className={`bigtext-text ${flipped ? 'flipped' : ''}`} lang={lang}>{text}</p>
      <div className="bigtext-bar">
        <button type="button" className="btn btn-lg" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}>
          <Icon name="refresh" />
          {t('conv.flip')}
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onClose} autoFocus>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- transcript
export function Chat({ speechOnly = false }: { speechOnly?: boolean } = {}) {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const { state } = conv;
  const localSttStatus = useLocalSttStatus();
  const errorText = useErrorText();
  const simplificationEnabled = useRuntime((s) => s.config.llmProvider !== 'local');
  const endRef = useRef<HTMLDivElement>(null);
  const [big, setBig] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const busy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(state.phase);
  const canSimplify = ['LISTENER_TURN', 'IDLE', 'SIGNER_LISTENING'].includes(state.phase);

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect
  // must return nothing or a cleanup function.
  useEffect(() => {
    // Nothing to reveal yet: scrolling on first render would push the page down on open.
    if (state.turns.length === 0 && !state.partial) return;
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.turns.length, state.partial]);

  const lastListener = [...state.turns].reverse().find((x) => x.speaker === 'listener' && !x.simplifiedFrom)?.id;
  const lastSigner = [...state.turns].reverse().find((x) => x.speaker === 'signer')?.id;
  // The message the signer should read: the simplified version of the newest reply if there is one.
  const readFirst = lastListener ? (state.turns.find((x) => x.simplifiedFrom === lastListener)?.id ?? lastListener) : undefined;

  const bubble = (turn: Turn) => {
    const mine = turn.speaker === 'signer';
    const isLatest = turn.id === readFirst;
    const simplifiedChild = state.turns.find((x) => x.simplifiedFrom === turn.id);
    return (
      <li
        key={turn.id}
        tabIndex={0}
        className={`msg ${mine ? 'msg-signer' : 'msg-listener'} ${turn.simplifiedFrom ? 'msg-simplified' : ''} ${isLatest ? 'msg-latest' : ''} ${isLatest || turn.id === lastListener || turn.id === lastSigner || editing === turn.id ? 'msg-recent' : ''}`}
      >
        <span className="sr-only">{mine ? t('transcript.signer') : turn.simplifiedFrom ? t('transcript.simplified') : t('transcript.listener')}: </span>
        {turn.simplifiedFrom && <span className="msg-tag">{t('transcript.simplified')}</span>}
        {editing === turn.id ? (
          <form
            className="msg-edit"
            onSubmit={(e) => {
              e.preventDefault();
              conv.dispatch({ type: 'EDIT_TURN', id: turn.id, text: draft });
              setEditing(null);
            }}
          >
            <label className="sr-only" htmlFor={`edit-${turn.id}`}>{t('listener.correct')}</label>
            <textarea id={`edit-${turn.id}`} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus lang={lang} />
            <div className="btn-row">
              <button type="submit" className="btn btn-primary">{t('common.save')}</button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        ) : (
          <p className="msg-text" lang={turn.language ?? lang}>{turn.text}</p>
        )}
        {editing !== turn.id && (
          <div className="msg-actions">
            <button type="button" className="chip-btn" onClick={() => setBig(turn.text)}>
              <Icon name="sparkle" />
              {t('conv.showBig')}
            </button>
            {mine && (
              <button type="button" className="chip-btn" disabled={busy} onClick={() => conv.dispatch({ type: 'REPEAT', text: turn.text, language: turn.language })}>
                <Icon name="speaker" />
                {t('conv.readAgain')}
              </button>
            )}
            {simplificationEnabled && !mine && !turn.simplifiedFrom && !simplifiedChild && (
              <button
                type="button"
                className="chip-btn"
                disabled={!canSimplify || turn.text.length > SIMPLIFY_MAX_CHARS}
                onClick={() => conv.simplify(turn.id)}
              >
                {state.phase === 'SIMPLIFYING' && state.simplifyTarget === turn.id ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkle" />}
                {state.phase === 'SIMPLIFYING' && state.simplifyTarget === turn.id ? t('conv.simplifying') : t('listener.simplify')}
              </button>
            )}
            {!mine && !turn.simplifiedFrom && (
              <button
                type="button"
                className="chip-btn"
                onClick={() => {
                  setDraft(turn.text);
                  setEditing(turn.id);
                }}
              >
                <Icon name="edit" />
                {t('listener.correct')}
              </button>
            )}
          </div>
        )}
        {turn.simplifiedFrom && state.matches.length > 0 && turn.id === [...state.turns].reverse().find((x) => x.simplifiedFrom)?.id && (
          <div className="chips" style={{ marginTop: 6 }}>
            {state.matches.map((id) => (
              <span className="chip" key={id}>{phraseBySlug(id)?.texts[lang] ?? id}</span>
            ))}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className={`chat${state.turns.length === 0 && state.phase !== 'TRANSCRIBING' ? ' chat-new' : ''}`} aria-label={t('transcript.title')}>
      {state.turns.length === 0 && state.phase !== 'TRANSCRIBING' ? (speechOnly ? (
        <div className="conversation-welcome">
          <div className="conversation-welcome-icon" aria-hidden="true"><Icon name="mic" /></div>
          <p className="conversation-welcome-title">{lang === 'uz' ? 'Suhbatga tayyormisiz?' : lang === 'ru' ? 'Готовы к разговору?' : 'Ready to talk?'}</p>
          <p>{lang === 'uz' ? 'Mikrofonni yoqing va gapiring. Nutqingiz shu yerda matnga aylanadi.' : lang === 'ru' ? 'Включите микрофон и говорите. Ваша речь появится здесь в виде текста.' : 'Turn on the microphone and speak. Your words will appear here as text.'}</p>
        </div>
      ) : (
        <div className="chat-empty">
          <p className="chat-empty-title">{t('conv.emptyTitle')}</p>
          <p>
            <Icon name="hand" /> {t('conv.empty1')}
          </p>
          <p>
            <Icon name="chat" /> {t('conv.empty2')}
          </p>
        </div>
      )) : (
        <ol className="msgs" aria-live="polite">
          {state.turns.map(bubble)}
          {state.phase === 'TRANSCRIBING' && (
            <li className="msg msg-listener msg-live">
              <p className="msg-text">{state.partial || t(localSttStatus === 'processing' ? 'speech.processing' : 'conv.transcribing')}</p>
            </li>
          )}
        </ol>
      )}
      {state.simplifyError && (
        <div className="notice warn" role="alert">
          <Icon name="alert" />
          <p>{errorText(state.simplifyError)}</p>
        </div>
      )}
      {state.sttIssue && (
        <div className={`notice ${state.sttIssue === 'no_speech' ? 'warn' : 'bad'}`} role="alert">
          <Icon name="alert" />
          <p>{t(state.sttIssue === 'failed' ? 'listener.sttFailed' : `speech.issue.${state.sttIssue}`)}</p>
        </div>
      )}
      <div ref={endRef} className="chat-end" />
      <BigText text={big} onClose={() => setBig(null)} />
    </section>
  );
}

// ---------------------------------------------------------------- reply bar (hearing person)
let noticeAcceptedThisSession = false;

export function Composer({ speechOnly = false }: { speechOnly?: boolean } = {}) {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const config = useRuntime((s) => s.config);
  const stt = getStt(config);
  const localStatus = useLocalSttStatus();
  const [text, setText] = useState('');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [accepted, setAccepted] = useState(noticeAcceptedThisSession);
  const can = LISTENER_ENTRY.includes(conv.state.phase);
  const talking = conv.state.phase === 'TRANSCRIBING';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !can) return;
    conv.sayListener(text);
    setText('');
  };
  const begin = () => {
    if (stt.notice && !accepted) return setNoticeOpen(true);
    if (!talking && can) void conv.pttStart();
  };
  const end = () => talking && void conv.pttStop();

  return (
    <form className={`composer${speechOnly ? ' composer-speech-only' : ''}`} onSubmit={submit}>
      {!speechOnly && <><label className="sr-only" htmlFor="reply">{t('conv.replyLabel')}</label>
      <textarea
        id="reply"
        className="composer-input"
        rows={1}
        lang={lang}
        value={text}
        placeholder={t('conv.replyPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }
        }}
      /></>}
      {stt.kind === 'ptt' && (
        <button
          type="button"
          className={`${speechOnly ? 'btn btn-primary' : 'icon-btn'} mic ${talking ? 'on' : ''}`}
          aria-pressed={talking}
          aria-label={talking ? t('speech.stop') : t('speech.start')}
          title={talking ? t('speech.stop') : t('speech.start')}
          disabled={(!can && !talking) || localStatus === 'processing'}
          onClick={() => talking ? end() : begin()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Icon name="mic" />
          {speechOnly && <span>{talking ? t('speech.stop') : t('speech.start')}</span>}
        </button>
      )}
      {!speechOnly && <button type="submit" className="icon-btn send" disabled={!text.trim() || !can} aria-label={t('conv.send')} title={t('conv.send')}>
        <Icon name="send" />
      </button>}
      <Modal open={noticeOpen} onClose={() => setNoticeOpen(false)} title={t('listener.noticeTitle')}>
        <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>{t('speech.cloud')}</p>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => {
            noticeAcceptedThisSession = true;
            setAccepted(true);
            setNoticeOpen(false);
            if (can && !talking) void conv.pttStart();
          }}
        >
          {t('listener.noticeOk')}
        </button>
      </Modal>
    </form>
  );
}
