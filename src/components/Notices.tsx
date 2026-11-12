import { useI18n, type MessageKey } from '../i18n';
import { getTts } from '../providers';
import { useRuntime } from '../runtime';
import type { ConvError } from '../state/machine';
import { useConversation } from '../state/ConversationContext';
import { Icon } from './Icon';

export function useErrorText() {
  const { t } = useI18n();
  return (err: ConvError): string =>
    err.kind === 'refused'
      ? t(`refusal.${err.reason}` as MessageKey)
      : t(`error.${err.code}` as MessageKey, { s: err.retryAfterS ?? 10 });
}

/** Read-aloud problems: no voice for the language, unsupported, failed (brief section 5). */
export function TtsNotice() {
  const { t, lang } = useI18n();
  const { state } = useConversation();
  const config = useRuntime((s) => s.config);
  const providerNotice = getTts(config).notice;
  const langName = t(`lang.${lang}` as MessageKey);
  return (
    <>
      {providerNotice && (
        <div className="notice warn" role="status">
          <Icon name="info" />
          <p>{t(providerNotice)}</p>
        </div>
      )}
      {state.ttsIssue && (
        <div className="notice warn" role="alert">
          <Icon name="speaker" />
          <p>
            {state.ttsIssue === 'no_voice'
              ? t('tts.noVoice', { lang: langName })
              : state.ttsIssue === 'unsupported'
                ? t('tts.unsupported')
                : t('tts.failed')}
          </p>
        </div>
      )}
    </>
  );
}

export function OfflineBanner() {
  const { t } = useI18n();
  const offline = useRuntime((s) => !s.online || s.demo.simOffline);
  if (!offline) return null;
  return (
    <div className="banner banner-warn" role="status">
      <Icon name="wifiOff" />
      <span>{t('offline.banner')}</span>
    </div>
  );
}
