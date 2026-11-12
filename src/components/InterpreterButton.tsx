import { useState } from 'react';
import { useI18n } from '../i18n';
import { getTts } from '../providers';
import { runtime } from '../runtime';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** F8: always visible. Shows a large message for the hearing person and can read it aloud. */
export function InterpreterButton({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [speakFailed, setSpeakFailed] = useState(false);
  const message = `${t('interpreter.title')}. ${t('interpreter.body')}`;

  return (
    <>
      <button type="button" className="btn interp-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="person" />
        <span className={compact ? 'interp-label' : undefined}>{t('interpreter.button')}</span>
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setSpeakFailed(false);
        }}
        title={t('interpreter.button')}
      >
        <div className="stack">
          <p className="interp-text" lang={lang}>{t('interpreter.title')}</p>
          <p style={{ fontSize: '1.3rem' }}>{t('interpreter.body')}</p>
          <p className="muted">{t('interpreter.contact')}</p>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => {
              setSpeakFailed(false);
              getTts(runtime.get().config)
                .provider.speak(message, lang)
                .catch(() => setSpeakFailed(true));
            }}
          >
            <Icon name="speaker" />
            {t('interpreter.readAloud')}
          </button>
          {speakFailed && (
            <div className="notice warn" role="alert">
              <Icon name="alert" />
              <p>{t('tts.failed')}</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
