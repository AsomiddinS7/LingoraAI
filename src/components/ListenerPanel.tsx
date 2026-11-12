// Hearing person side (F5, F6): push-to-talk or typed text, shown large; Simplify on request.
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { SIMPLIFY_MAX_CHARS } from '../api/validate';
import { phraseById } from '../data';
import { useI18n } from '../i18n';
import { getStt } from '../providers';
import { useRuntime } from '../runtime';
import { useConversation } from '../state/ConversationContext';
import { LISTENER_ENTRY } from '../state/machine';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { useErrorText } from './Notices';

let noticeAcceptedThisSession = false;

export function PushToTalk() {
  const { t } = useI18n();
  const conv = useConversation();
  const config = useRuntime((s) => s.config);
  const choice = getStt(config);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [accepted, setAccepted] = useState(noticeAcceptedThisSession);
  const talking = conv.state.phase === 'TRANSCRIBING';
  const canTalk = LISTENER_ENTRY.includes(conv.state.phase);

  if (choice.kind === 'typed')
    return (
      <div className="notice info" role="status">
        <Icon name="info" />
        <p>{t(choice.notice)}</p>
      </div>
    );

  const begin = () => {
    if (!accepted) {
      setNoticeOpen(true);
      return;
    }
    if (!talking && canTalk) void conv.pttStart();
  };
  const end = () => {
    if (talking) void conv.pttStop();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      begin();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      end();
    }
  };

  return (
    <div className="stack">
      {choice.notice && (
        <div className="notice warn" role="note">
          <Icon name="alert" />
          <p>{t(choice.notice)}</p>
        </div>
      )}
      <button
        type="button"
        className="ptt"
        aria-pressed={talking}
        aria-label={`${t('listener.mic')}: ${talking ? t('listener.release') : t('listener.holdToTalk')}`}
        disabled={!canTalk && !talking}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          begin();
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Icon name="mic" />
        {talking ? t('listener.release') : t('listener.holdToTalk')}
      </button>
      <p className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Icon name="lock" />
        {t('listener.notice')}
      </p>
      <div>
        <p className="eyebrow">{t('listener.live')}</p>
        <div className="live-line" aria-live="polite">
          {talking ? conv.state.partial || t('conv.transcribing') : ''}
        </div>
      </div>
      {conv.state.sttIssue && (
        <div className="notice bad" role="alert">
          <Icon name="alert" />
          <p>{t('listener.sttFailed')}</p>
        </div>
      )}
      <Modal open={noticeOpen} onClose={() => setNoticeOpen(false)} title={t('listener.noticeTitle')}>
        <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>{t('listener.notice')}</p>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => {
            noticeAcceptedThisSession = true;
            setAccepted(true);
            setNoticeOpen(false);
          }}
        >
          {t('listener.noticeOk')}
        </button>
      </Modal>
    </div>
  );
}

export function TypedReply() {
  const { t } = useI18n();
  const conv = useConversation();
  const [text, setText] = useState('');
  const can = LISTENER_ENTRY.includes(conv.state.phase);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !can) return;
    conv.sayListener(text);
    setText('');
  };
  return (
    <form className="field" onSubmit={submit}>
      <label htmlFor="typed-reply">{t('listener.typeLabel')}</label>
      <textarea id="typed-reply" className="input" value={text} placeholder={t('listener.typePlaceholder')} onChange={(e) => setText(e.target.value)} rows={2} />
      <button type="submit" className="btn btn-primary" disabled={!text.trim() || !can}>
        {t('listener.send')}
      </button>
    </form>
  );
}

/** The latest reply in large text for the signer, plus Simplify and correction. */
export function LatestReply() {
  const { t, lang } = useI18n();
  const conv = useConversation();
  const { state } = conv;
  const errorText = useErrorText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const latest = [...state.turns].reverse().find((x) => x.speaker === 'listener' && !x.simplifiedFrom);
  const simplified = latest && [...state.turns].reverse().find((x) => x.simplifiedFrom === latest.id);
  const tooLong = !!latest && latest.text.length > SIMPLIFY_MAX_CHARS;
  const simplifying = state.phase === 'SIMPLIFYING';
  const canSimplify = ['LISTENER_TURN', 'IDLE', 'SIGNER_LISTENING'].includes(state.phase);

  if (!latest)
    return (
      <div className="card">
        <p className="eyebrow">{t('listener.latest')}</p>
        <p className="muted">{t('listener.empty')}</p>
      </div>
    );

  return (
    <div className="card" aria-live="polite">
      <p className="eyebrow">{t('listener.latest')}</p>
      {editing ? (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            conv.dispatch({ type: 'EDIT_TURN', id: latest.id, text: draft });
            setEditing(false);
          }}
        >
          <label htmlFor="correct-reply">{t('listener.correct')}</label>
          <textarea id="correct-reply" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="btn-row">
            <button type="submit" className="btn btn-primary">{t('common.save')}</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : (
        <p className="result-text xl listener" lang={lang}>{latest.text}</p>
      )}

      {!editing && (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={tooLong || simplifying || !canSimplify} onClick={() => conv.simplify(latest.id)}>
            {simplifying ? <div className="spinner" aria-hidden="true" /> : <Icon name="sparkle" />}
            {simplifying ? t('conv.simplifying') : t('listener.simplify')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(latest.text);
              setEditing(true);
            }}
          >
            <Icon name="edit" />
            {t('listener.correct')}
          </button>
        </div>
      )}
      {tooLong && <p className="small muted">{t('listener.tooLong', { n: SIMPLIFY_MAX_CHARS })}</p>}

      {state.simplifyError && (
        <div className="notice warn" role="alert" style={{ marginTop: 12 }}>
          <Icon name="alert" />
          <p>{errorText(state.simplifyError)}</p>
        </div>
      )}

      {simplified && (
        <div style={{ marginTop: 14 }}>
          <p className="eyebrow">{t('listener.simplified')}</p>
          <p className="result-text listener" lang={lang}>{simplified.text}</p>
          {state.matches.length > 0 && (
            <>
              <p className="eyebrow">{t('listener.matches')}</p>
              <div className="chips">
                {state.matches.map((id) => (
                  <span className="chip" key={id}>{phraseById(id)?.text[lang] ?? id}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ListenerPanel() {
  const { t } = useI18n();
  return (
    <section className="stack" aria-label={t('listener.title')}>
      <LatestReply />
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('listener.title')}</h2>
        <PushToTalk />
        <TypedReply />
      </div>
    </section>
  );
}
