import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ExitEditDialog({ dirty, onCancel, onConfirm }: {
  dirty: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Unlike window.confirm(), HTML dialogs work inside frames without allow-modals.
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>('.editor-enter')?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className="exit-edit-dialog" aria-labelledby="exit-edit-title" aria-describedby="exit-edit-description"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2 id="exit-edit-title">确认退出编辑？</h2>
      <div id="exit-edit-description">
        <p>{dirty ? '当前未保存的变更将被放弃，不会自动保存。' : '当前没有未保存的变更。'}</p>
        <p>此前已保存的本地编辑和更新包会保留。</p>
      </div>
      <div className="exit-edit-actions">
        <button autoFocus className="exit-edit-continue" type="button" onClick={onCancel}>继续编辑</button>
        <button className="exit-edit-confirm" type="button" onClick={onConfirm}>{dirty ? '放弃未保存变更并退出' : '确认退出'}</button>
      </div>
    </dialog>, document.body,
  );
}
