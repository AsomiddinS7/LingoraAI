import { glossFor } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import { useRuntime } from '../runtime';
import { useConversation } from '../state/ConversationContext';
import { Icon } from './Icon';

/** Confidence band as text, never color alone (F2). */
export function confidenceKey(confidence: number, threshold: number): MessageKey {
  if (confidence < threshold) return 'status.low';
  if (confidence >= 0.9) return 'status.high';
  return 'status.medium';
}

export function StatusChip() {
  const { t, lang } = useI18n();
  const { state } = useConversation();
  const threshold = useRuntime((s) => s.config.confidenceThreshold);

  let tone = '';
  let icon: 'hand' | 'alert' | 'check' | 'info' = 'info';
  let text = t('status.idle');
  let pct: number | null = null;

  if (state.phase === 'SIGNER_LISTENING') {
    if (state.notRecognized) {
      tone = 'warn';
      icon = 'alert';
      text = t('status.notRecognized');
      if (state.last && state.last.label !== 'none') {
        pct = state.last.confidence;
        text += `. ${t('status.low', { pct: Math.round(pct * 100) })}`;
      }
    } else {
      icon = 'hand';
      text = t('status.listening');
    }
  } else if (state.phase === 'CONFIRM_SIGN' && state.candidate) {
    const c = state.candidate.confidence;
    tone = c >= 0.9 ? 'ok' : 'warn';
    icon = c >= 0.9 ? 'check' : 'alert';
    pct = c;
    text = `${glossFor(state.candidate.label, lang)} — ${t(confidenceKey(c, threshold), { pct: Math.round(c * 100) })}`;
  } else if (state.phase !== 'IDLE') {
    return null;
  }

  return (
    <div className={`status-chip ${tone}`} role="status" aria-live="polite" aria-label={t('status.label')}>
      <Icon name={icon} />
      <div style={{ flex: 1 }}>
        <div>{text}</div>
        {pct !== null && (
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
