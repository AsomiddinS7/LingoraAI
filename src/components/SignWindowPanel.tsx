// The core v1 interaction: Sign now -> countdown ring -> recording ring -> processing -> result.
import { useState } from 'react';
import { platformApiEnabled } from '../config';
import { glossFor } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import { useRuntime } from '../runtime';
import { useCamera } from '../state/CameraContext';
import { useConversation } from '../state/ConversationContext';
import { useSignWindow } from '../state/SignWindowContext';
import { confidenceWord } from '../state/signWindow';
import { MAX_SIGNS } from '../state/machine';
import { Icon } from './Icon';
import { NamePrompt } from './NamePrompt';
import { PhrasePickerModal } from './ConversationCards';

export function recognitionHint(reason?: string): MessageKey {
  if (reason === 'no_hands' || reason === 'insufficient_tracking') return 'motion.hintTracking';
  if (reason === 'no_compatible_templates') return 'motion.hintBody';
  if (reason === 'insufficient_motion') return 'motion.hintMotion';
  if (reason === 'ambiguous') return 'motion.hintAmbiguous';
  return 'motion.notRecognized';
}

/** Progress ring (visual only). With reduced motion it is a static ring plus the text label. */
export function Ring({ value, label }: { value: number; label: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="ring-track" />
        <circle cx="60" cy="60" r={r} className="ring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))} />
      </svg>
      <span className="ring-label">{label}</span>
    </div>
  );
}

export function ConfidenceText({ c }: { c: number }) {
  const { t } = useI18n();
  const threshold = useRuntime((s) => s.config.confidenceThreshold);
  const sureAt = useRuntime((s) => s.config.signWindow.sureAt);
  const recognizer = useRuntime((s) => s.config.recognizer);
  if (recognizer === 'motion') return <span className="conf">{t('motion.similarity', { n: Math.round(c * 100) })}</span>;
  const w = confidenceWord(c, threshold, sureAt);
  return (
    <span className={`conf conf-${w}`}>
      {t(`conf.${w}` as MessageKey)} · {Math.round(c * 100)}%
    </span>
  );
}

export function SignWindowPanel() {
  const { t, lang } = useI18n();
  const sw = useSignWindow();
  const conv = useConversation();
  const cam = useCamera();
  const [picking, setPicking] = useState(false);
  const [report, setReport] = useState<'ok' | 'failed' | null>(null);
  const { win } = sw;
  const recognizer = useRuntime((s) => s.config.recognizer);
  const busyConv = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING', 'CONFIRM_SENTENCE'].includes(conv.state.phase);
  const buffer = conv.state.buffer;

  const signsSoFar = buffer.length > 0 && (
    <div className="signs-so-far">
      <span>{t('conv.signsSoFar', { signs: buffer.map((b) => glossFor(b.label, lang)).join(' · ') })}</span>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={busyConv} onClick={() => conv.dispatch({ type: 'COMPOSE_BUFFER' })}>
          {t('win.compose')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => conv.dispatch({ type: 'CLEAR_SIGNS' })}>
          {t('win.clearSigns')}
        </button>
      </div>
    </div>
  );

  if (win.phase === 'loading')
    return (
      <div className="notice info" role="status">
        <div className="spinner" aria-hidden="true" />
        <p>{t('win.loading')}</p>
      </div>
    );

  if (win.phase === 'unavailable')
    return (
      <div className="notice warn" role="alert">
        <Icon name="alert" />
        <div>
          <strong>{t('win.unavailable.title')}</strong>
          <p>{win.error?.includes('No active model') || win.error?.includes('NOT_FOUND') ? t('win.noModel') : t('win.unavailable.body')}</p>
          <p className="small">{t('win.unavailable.body')}</p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={sw.reload}>
              <Icon name="refresh" />
              {t('win.retryLoad')}
            </button>
            <button type="button" className="btn" onClick={() => setPicking(true)}>
              <Icon name="book" />
              {t('win.choosePhrase')}
            </button>
          </div>
          <PhrasePickerModal open={picking} onClose={() => setPicking(false)} />
        </div>
      </div>
    );

  if (win.phase === 'countdown' || win.phase === 'recording' || win.phase === 'processing') {
    const label = win.phase === 'countdown' ? t('win.countdown') : win.phase === 'recording' ? t('win.recording') : t('win.processing');
    const value = win.phase === 'processing' ? 1 : win.totalMs ? win.ms / win.totalMs : 0;
    return (
      <div className={`window-live phase-${win.phase}`} aria-live="polite">
        {win.phase === 'processing' ? (
          <div className="ring-wrap">
            <div className="spinner big" aria-hidden="true" />
            <span className="ring-label">{label}</span>
          </div>
        ) : (
          <Ring value={value} label={label} />
        )}
        {win.phase === 'recording' && recognizer === 'motion' && <button type="button" className="btn btn-primary btn-lg" onClick={sw.finish}>{t('motion.finish')}</button>}
        <button type="button" className="btn btn-lg" onClick={sw.cancel}>
          <Icon name="x" />
          {t('win.cancel')}
        </button>
      </div>
    );
  }

  if (win.phase === 'result' && win.result) {
    const r = win.result;
    const sendWrong = async () => setReport(await conv.sendFeedback('wrong_sign', [win.selected ?? r.label].filter((x) => x !== 'none')));
    if (win.outcome === 'not_recognized')
      return (
        <div className="card result-card" role="alert">
          <p className="result-text">{t('win.notRecognized')}</p>
          {recognizer === 'motion' ? <p className="muted">{t(recognitionHint(r.reason))}</p>
            : (r.reason === 'no_hands' || r.reason === 'insufficient_tracking') && <p className="muted">{t('win.noHands')}</p>}
          {r.reason === 'ambiguous' && r.alternatives.length > 0 && <div className="stack">
            <p>{t('motion.suggestions')}</p>
            <div className="btn-row">{r.alternatives.map((a) => <button key={a.label} type="button" className="btn" onClick={() => sw.select(a.label)}>{glossFor(a.label, lang)}</button>)}</div>
          </div>}
          {r.label !== 'none' && (
            <p className="muted">
              {glossFor(r.label, lang)} · <ConfidenceText c={r.confidence} />
            </p>
          )}
          <div className="btn-row">
            <button type="button" className="btn btn-primary btn-lg" onClick={sw.tryAgain} autoFocus>
              <Icon name="refresh" />
              {t('win.tryAgain')}
            </button>
            <button type="button" className="btn btn-lg" onClick={() => setPicking(true)}>
              <Icon name="book" />
              {t('win.choosePhrase')}
            </button>
          </div>
          <PhrasePickerModal open={picking} onClose={() => setPicking(false)} />
        </div>
      );

    const options = [...(r.label === 'none' ? [] : [{ label: r.label, confidence: r.confidence }]), ...r.alternatives].slice(0, 3);
    const selectedConf = options.find((o) => o.label === win.selected)?.confidence ?? r.confidence;
    const needsName = win.selected === 'my_name' && !conv.name.trim();
    return (
      <div className="card result-card" role="region" aria-labelledby="win-result" aria-live="polite">
        <p className="eyebrow" id="win-result">{t('win.result')}</p>
        {r.label === 'none' && <p>{t('motion.userSelected')}</p>}
        <p className="result-text xl" lang={lang}>{glossFor(win.selected ?? r.label, lang)}</p>
        <p>
          <ConfidenceText c={selectedConf} />
        </p>
        {win.picking && (
          <fieldset className="alts">
            <legend className="eyebrow">{t('win.alternatives')}</legend>
            {options.map((o) => (
              <button
                key={o.label}
                type="button"
                className={`alt ${o.label === win.selected ? 'on' : ''}`}
                aria-pressed={o.label === win.selected}
                onClick={() => sw.select(o.label)}
              >
                <span lang={lang}>{glossFor(o.label, lang)}</span>
                <ConfidenceText c={o.confidence} />
              </button>
            ))}
          </fieldset>
        )}
        {needsName && <NamePrompt />}
        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-lg" disabled={busyConv || needsName} onClick={() => sw.confirm(true)} autoFocus>
            <Icon name="check" />
            {t('win.confirm')}
          </button>
          {buffer.length + 1 < MAX_SIGNS && (
            <button type="button" className="btn btn-lg" disabled={busyConv || needsName} onClick={() => sw.confirm(false)}>
              <Icon name="plus" />
              {t('win.confirmAdd')}
            </button>
          )}
          {!win.picking && options.length > 1 && (
            <button type="button" className="btn btn-lg" onClick={sw.pickAnother}>
              {t('win.pickAnother')}
            </button>
          )}
          <button type="button" className="btn btn-lg btn-quiet" onClick={sw.tryAgain}>
            <Icon name="refresh" />
            {t('win.tryAgain')}
          </button>
        </div>
        {platformApiEnabled && <div className="feedback-row">
          {report === null ? (
            <button type="button" className="link-btn" onClick={() => void sendWrong()}>
              {t('win.wrongSign')}
            </button>
          ) : (
            <span role="status" className="small muted">{report === 'ok' ? t('win.reported') : t('win.reportFailed')}</span>
          )}
        </div>}
      </div>
    );
  }

  // idle or error
  const errorKey: MessageKey | null =
    win.phase === 'error'
      ? win.error === 'no_templates'
        ? 'motion.noExamples'
        : win.error === 'not_trained'
        ? 'win.notTrained'
        : win.error === 'timeout'
          ? 'win.timeout'
          : 'win.errorGeneric'
      : null;
  return (
    <div className="stack">
      {errorKey && (
        <div className="notice bad" role="alert">
          <Icon name="alert" />
          <p>{t(errorKey)}</p>
        </div>
      )}
      {signsSoFar}
      <div className="action-row">
        <button
          type="button"
          className="btn btn-primary sign-now"
          disabled={cam.status !== 'live' || busyConv}
          onClick={sw.start}
          aria-describedby={cam.status !== 'live' ? 'sign-now-hint' : undefined}
        >
          <Icon name="hand" />
          {t('win.signNow')}
        </button>
        <button type="button" className="btn btn-lg phrases-btn" disabled={busyConv} onClick={() => setPicking(true)}>
          <Icon name="book" />
          {t('nav.phrasebook')}
        </button>
      </div>
      {cam.status !== 'live' && (
        <p id="sign-now-hint" className="small muted">{t('win.cameraFirst')}</p>
      )}
      <PhrasePickerModal open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}
