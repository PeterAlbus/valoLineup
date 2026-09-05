import ConfirmDialog from './ConfirmDialog';

export default function ExitEditDialog({ dirty, onCancel, onConfirm }: {
  dirty: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <ConfirmDialog exit title="确认退出编辑？" confirmLabel={dirty ? '放弃未保存变更并退出' : '确认退出'} cancelLabel="继续编辑" onCancel={onCancel} onConfirm={onConfirm}>
    <p>{dirty ? '当前未保存的变更将被放弃，不会自动保存。' : '当前没有未保存的变更。'}</p>
    <p>此前已保存的本地编辑和更新包会保留。</p>
  </ConfirmDialog>;
}
