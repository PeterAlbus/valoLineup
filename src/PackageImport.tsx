export default function PackageImport({ disabled, editing, onImport, compact = false }: {
  disabled: boolean; editing: boolean; onImport: (file: File) => void; compact?: boolean;
}) {
  return <label className={`package-import ${disabled ? 'is-disabled' : ''}`} title={editing ? '请保存并退出编辑后再导入更新包' : '导入他人分享的编辑包，资料保存在当前浏览器'}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" /></svg>
    {compact ? '导入更新包' : '导入更新包 ZIP'}
    <input aria-label="导入更新包 ZIP" type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) onImport(file);
    }} />
  </label>;
}
