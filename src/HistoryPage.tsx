import { packageStats, type Manifest, type Uploader } from './package-model.mjs';
import { formatBytes } from './image-compression';

export type HistoryEntry = { id: string; packageId: string; revision: number; appliedAt: string; author: { name: string }; mapIds: string[]; lineupIds: string[]; added: number; updated: number; deleted?: number };
export function UploaderLabel({ uploader, onOpen }: { uploader: Uploader; onOpen: (uid: string) => void }) {
  return uploader.bilibiliUid ? <button className="uploader-link" onClick={() => onOpen(uploader.bilibiliUid!)} type="button">{uploader.name} ↗</button>
    : <span title="Toy SDK 不提供 B站 UID，无法跳转主页">{uploader.name}{uploader.source === 'local' ? '（未认证）' : ''}</span>;
}
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export default function HistoryPage({ packages, manual, dirty, entries, maps, busy, editing, onImport, onMove, onRemove, onExport, onClearManual }: {
  packages: Manifest[]; manual: Manifest | null; dirty: boolean; entries: HistoryEntry[]; maps: { id: string; name: string }[];
  busy: boolean; editing: boolean; onImport: (file: File) => void; onMove: (index: number, offset: number) => void;
  onRemove: (index: number) => void; onExport: () => void; onClearManual: () => void;
}) {
  return <section className="history-page" aria-label="更新历史">
    {manual || dirty ? <section className="history-card local-edit-card">
      <h2>本地有编辑{dirty ? ' · 有未保存变更' : ''}</h2>
      <p>{manual ? `${manual.author.name} · ${date(manual.updatedAt)} · ${packageStats(manual).maps} 个地图 / ${packageStats(manual).lineups} 个点位` : '当前草稿尚未保存'}</p>
      <p>手动编辑始终最后应用。继续编辑会更新同一个编辑包。</p>
      <div className="history-actions"><button disabled={busy} onClick={onExport} type="button">下载编辑包</button><button disabled={busy || editing} onClick={onClearManual} type="button">删除本地编辑</button></div>
    </section> : null}
    <section className="history-section">
      <h2>浏览器更新包</h2>
      <p>从上到下依次应用，靠后的包覆盖相同 ID 的点位，最后叠加手动编辑。数据只保存在当前浏览器，不会上传仓库。</p>
      <label className={`package-import ${busy || editing ? 'is-disabled' : ''}`}>导入更新包 ZIP<input aria-label="导入更新包 ZIP" type="file" accept=".zip,application/zip" disabled={busy || editing} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) onImport(file); }} /></label>
      {editing ? <p>请保存并退出编辑后再管理更新包。</p> : null}
      {!packages.length ? <p className="history-empty">尚未应用浏览器更新包。</p> : null}
      <ol className="package-list">{packages.map((manifest, index) => {
        const stats = packageStats(manifest);
        return <li className="history-card" key={manifest.packageId} data-package-id={manifest.packageId}>
          <h3>{index + 1}. {manifest.author.name} · {stats.maps} 个地图 / {stats.lineups} 个点位</h3>
          <p>{date(manifest.updatedAt)} · 新增 {stats.added} / 修改 {stats.updated} / 删除 {stats.deleted}</p>
          <p>图片 {formatBytes(manifest.uploadedAssets.reduce((sum, asset) => sum + asset.size, 0))} / 128.00 MiB</p>
          <small>{manifest.packageId} · r{manifest.revision}</small>
          <div className="history-actions"><button aria-label={`上移第 ${index + 1} 个更新包`} disabled={busy || editing || index === 0} onClick={() => onMove(index, -1)} type="button">↑ 上移</button><button aria-label={`下移第 ${index + 1} 个更新包`} disabled={busy || editing || index === packages.length - 1} onClick={() => onMove(index, 1)} type="button">↓ 下移</button><button disabled={busy || editing} onClick={() => onRemove(index)} type="button">删除更新包</button></div>
        </li>;
      })}</ol>
    </section>
    <section className="history-section"><h2>仓库更新历史</h2>
      <p>由开发者永久应用到仓库的记录；仅统计该次实际应用成功的变更。包内更新人是提供者声明的资料，并非签名认证。</p>
      {!entries.length ? <p className="history-empty">历史功能启用后，还没有新的仓库更新记录。</p> : null}
      {[...entries].reverse().map((entry) => <article className="history-card" key={entry.id}>
        <h3>{entry.author.name} · {entry.mapIds.length} 个地图 / {entry.lineupIds.length} 个点位</h3>
        <p>{date(entry.appliedAt)} · 新增 {entry.added} / 修改 {entry.updated} / 删除 {entry.deleted ?? 0}</p>
        <p>{entry.mapIds.map((id) => maps.find((map) => map.id === id)?.name ?? id).join('、')}</p>
        <small>{entry.packageId} · r{entry.revision}</small>
      </article>)}
    </section>
  </section>;
}
