import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePanZoom } from './usePanZoom';
import { useDecodedImage } from './useDecodedImage';
import ZoomControls from './ZoomControls';

export default function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const surface = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useDecodedImage(src);
  const { viewport, setZoom, reset, handlers, isDragging } = usePanZoom(surface, surface, 8, image.aspect);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const top = window.scrollY;
    const left = window.scrollX;
    const bodyStyle = document.body.style.cssText;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${top}px`;
    document.body.style.left = `-${left}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.cssText = bodyStyle;
      window.scrollTo({ top, left, behavior: 'instant' });
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className="image-lightbox" aria-label={`图片预览：${alt}`} onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="image-lightbox-panel">
        <header className="image-lightbox-heading">
          <p>{alt}</p>
          <button autoFocus className="image-lightbox-close" aria-label="关闭图片预览" type="button" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div ref={surface} className={`image-lightbox-canvas ${isDragging ? 'is-dragging' : ''}`} {...handlers}
          onDoubleClick={(event) => setZoom(viewport.zoom > 1 ? 1 : 2, event.clientX, event.clientY)}>
          {image.status === 'ready' ? <img className="image-lightbox-image" draggable={false} src={src} alt={alt}
            style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})` }} />
            : <div className="canvas-status" role="status">{image.status === 'error' ? <>图片加载失败<button type="button" onClick={image.retry}>重试</button></> : '正在加载图片…'}</div>}
        </div>
        <footer className="image-lightbox-footer">
          <ZoomControls label="图片" zoom={viewport.zoom} onZoom={setZoom} onReset={reset} />
          <p>滚轮 / 双指缩放 · 拖动查看 · 双击切换缩放</p>
        </footer>
      </section>
    </dialog>, document.body,
  );
}
