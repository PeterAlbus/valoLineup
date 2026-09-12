import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const guideKey = `valo-lineup:guide:${location.pathname}`;
const desktopUrl = 'https://www.bilibili.com/toy/valo-lineup/index.html';

function GuideDialog({ mobile, onClose }: { mobile: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    try { localStorage.setItem(guideKey, 'seen'); }
    catch { /* 浏览器禁用存储时无法保留访问记录。 */ }
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      document.querySelector<HTMLButtonElement>('.guide-trigger')?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className="usage-guide" aria-label="使用说明"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <div className="guide-actions">
        <button autoFocus className="guide-close" type="button" aria-label="关闭使用引导" onClick={onClose}>×</button>
      </div>
      <div className="guide-body">
        {mobile ? <p className="guide-desktop-note">建议通过 PC 端访问本页，PC 端支持个人点位编辑。可长按复制以下网址，在电脑浏览器中打开。<span className="guide-desktop-url">{desktopUrl}</span></p> : null}
        <p>本页面是基于 B 站 Toy 的 Lineup 点位集合，目前仍在开发中，主要用于查阅教学视频中的站位、瞄点和技能效果。</p>
        <ol className="guide-steps">
          <li><span aria-hidden="true">01</span><div><h3>点位查看</h3><p>{mobile
            ? '选择地图，通过下拉框选择英雄，再按阵营筛选。点击地图标记查看点位资料。地图支持双指缩放，图片可点击放大。'
            : '选择地图、英雄和阵营后，点击地图标记查看点位资料。地图支持滚轮缩放，图片可点击放大。'}</p></div></li>
          {!mobile ? <li><span aria-hidden="true">02</span><div><h3>点位编辑</h3><p>添加点位时，点击“编辑点位”和“新增点位”，在地图上选择落点，再填写名称和说明，并添加截图。点击“确认新增”后可切换到其他点位继续编辑，完成后点击“保存编辑”。</p></div></li> : null}
          <li><span aria-hidden="true">{mobile ? '02' : '03'}</span><div><h3>数据保存与更新包</h3>
            <p>本地编辑和导入的数据保存在当前设备的浏览器中，不会自动同步到其他设备。清理浏览器数据前，需要自行备份更新包。</p>
            <p>{mobile
              ? '手机端支持导入和查看更新包。将 PC 端下载的编辑包传到手机后，可通过页面顶部的“导入更新包”打开。'
              : '编辑后的点位可通过“下载编辑包”导出。更新包可在不同设备和玩家之间分享，通过“导入更新包”加载其中的点位。'}</p>
          </div></li>
          <li><span aria-hidden="true">{mobile ? '03' : '04'}</span><div><h3>点位收录</h3><p>目前内置点位数量有限。如需将自己整理的点位收录到默认内容中，可将更新包发送给作者。</p></div></li>
        </ol>
      </div>
      <footer className="guide-footer"><span>顶部 ? 可再次打开使用说明</span><button type="button" className="guide-done" onClick={onClose}>关闭</button></footer>
    </dialog>, document.body,
  );
}

export default function UsageGuide({ mobile }: { mobile: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(guideKey) !== 'seen'; }
    catch { return true; }
  });
  function close() {
    setOpen(false);
  }
  return <>
    <button ref={trigger} className="guide-trigger" type="button" title="使用指南" aria-label="打开使用指南" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 0 1 4.5.6c0 1.8-2.3 1.8-2.3 3.4m0 3h.01" /></svg>
    </button>
    {open ? <GuideDialog mobile={mobile} onClose={close} /> : null}
  </>;
}
