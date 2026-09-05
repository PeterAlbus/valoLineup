import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function ConfirmDialog({ title, children, confirmLabel, cancelLabel = '取消', onCancel, onConfirm, exit = false }: {
  title: string; children: ReactNode; confirmLabel: string; cancelLabel?: string;
  onCancel: () => void; onConfirm: () => void; exit?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // HTML dialogs also work in embedded frames that disallow native modal prompts.
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>('.history-toggle, .editor-enter')?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className={`confirm-dialog ${exit ? 'exit-edit-dialog' : ''}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="confirm-symbol" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 10 17H2L12 3Z" /><path d="M12 9v4m0 3h.01" /></svg></div>
      <p className="eyebrow">{exit ? '结束本次编辑' : '操作确认'}</p>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="confirm-description" id={`${id}-description`}>{children}</div>
      <div className="confirm-actions">
        <button autoFocus className={`confirm-cancel ${exit ? 'exit-edit-continue' : ''}`} type="button" onClick={onCancel}>{cancelLabel}</button>
        <button className={`confirm-accept ${exit ? 'exit-edit-confirm' : ''}`} type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>, document.body,
  );
}
