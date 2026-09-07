import { packageStats, type Manifest, type Uploader } from './package-model.mjs';
import { formatBytes } from './image-compression';
import PackageImport from './PackageImport';

export type HistoryEntry = { id: string; packageId: string; revision: number; appliedAt: string; author: { name: string }; mapIds: string[]; lineupIds: string[]; added: number; updated: number; deleted?: number };
export function UploaderLabel({ uploader, onOpen }: { uploader: Uploader; onOpen: (uid: string) => void }) {
  return uploader.bilibiliUid ? <button className="uploader-link" onClick={() => onOpen(uploader.bilibiliUid!)} type="button">{uploader.name} ↗</button>
    : <span title="这位作者暂未提供可访问的 B站主页">{uploader.name}{uploader.source === 'local' ? '（未认证）' : ''}</span>;
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
      <p>你保存的修改会优先显示。再次编辑和保存，会更新这份资料。</p>
      <div className="history-actions"><button className="action-primary" disabled={busy} onClick={onExport} type="button">下载编辑包</button><button className="action-danger" disabled={busy || editing || !manual} onClick={onClearManual} type="button">删除本地编辑</button></div>
    </section> : null}
    <section className="history-section">
      <h2>已导入的更新包</h2>
      <p>同一点位出现在多个更新包时，使用列表中靠后的内容；你保存的修改优先显示。导入只影响当前浏览器。</p>
      <PackageImport disabled={busy || editing} editing={editing} onImport={onImport} />
      {editing ? <p>请保存并退出编辑后再管理更新包。</p> : null}
      {!packages.length ? <p className="history-empty">还没有导入更新包。</p> : null}
      <ol className="package-list">{packages.map((manifest, index) => {
        const stats = packageStats(manifest);
        return <li className="history-card" key={manifest.packageId} data-package-id={manifest.packageId}>
          <h3>{index + 1}. {manifest.author.name} · {stats.maps} 个地图 / {stats.lineups} 个点位</h3>
          <p>{date(manifest.updatedAt)} · 新增 {stats.added} / 修改 {stats.updated} / 删除 {stats.deleted}</p>
          <p>图片 {formatBytes(manifest.uploadedAssets.reduce((sum, asset) => sum + asset.size, 0))} / 128 MB</p>
          <small>第 {manifest.revision} 次更新</small>
          <div className="history-actions"><button aria-label={`上移第 ${index + 1} 个更新包`} disabled={busy || editing || index === 0} onClick={() => onMove(index, -1)} type="button">↑ 上移</button><button aria-label={`下移第 ${index + 1} 个更新包`} disabled={busy || editing || index === packages.length - 1} onClick={() => onMove(index, 1)} type="button">↓ 下移</button><button className="action-danger" disabled={busy || editing} onClick={() => onRemove(index)} type="button">删除更新包</button></div>
        </li>;
      })}</ol>
    </section>
    <section className="history-section"><h2>内置资料更新</h2>
      <p>这里记录已收录到内置资料的点位更新。作者名称由资料提供者填写。</p>
      {!entries.length ? <p className="history-empty">还没有内置资料更新记录。</p> : null}
      {[...entries].reverse().map((entry) => <article className="history-card" key={entry.id}>
        <h3>{entry.author.name} · {entry.mapIds.length} 个地图 / {entry.lineupIds.length} 个点位</h3>
        <p>{date(entry.appliedAt)} · 新增 {entry.added} / 修改 {entry.updated} / 删除 {entry.deleted ?? 0}</p>
        <p>{entry.mapIds.map((id) => maps.find((map) => map.id === id)?.name ?? id).join('、')}</p>
        <small>第 {entry.revision} 次更新</small>
      </article>)}
    </section>
  </section>;
}
