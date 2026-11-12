import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/** Native <dialog>: focus trap, Esc to close and inert background come from the browser. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      {open && (
        <>
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              <Icon name="x" />
              <span className="sr-only">{t('common.close')}</span>
            </button>
          </div>
          <div className="modal-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
