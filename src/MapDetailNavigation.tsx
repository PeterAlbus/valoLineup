import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  mapRef: RefObject<HTMLDivElement | null>;
  detailRef: RefObject<HTMLElement | null>;
};

const scrollBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

export default function MapDetailNavigation({ mapRef, detailRef }: Props) {
  const [mapAboveViewport, setMapAboveViewport] = useState(false);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new IntersectionObserver(([entry]) => {
      setMapAboveViewport(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
    observer.observe(map);
    return () => observer.disconnect();
  }, [mapRef]);

  function showDetails() {
    const detail = detailRef.current;
    if (!detail) return;
    const toolbar = detail.closest('.workspace')?.querySelector<HTMLElement>('.workspace-toolbar');
    const offset = toolbar && getComputedStyle(toolbar).position === 'sticky' ? toolbar.getBoundingClientRect().height : 0;
    detail.focus({ preventScroll: true });
    window.scrollTo({ top: window.scrollY + detail.getBoundingClientRect().top - offset - 12, behavior: scrollBehavior() });
  }

  return <>
    <button className="map-detail-jump" ref={detailsButtonRef} type="button" aria-controls="lineup-detail" data-zoom-controls
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); showDetails(); }}>
      查看详情<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 4v16m-6-6 6 6 6-6" /></svg>
    </button>
    {mapAboveViewport ? createPortal(<button className="page-back-top" type="button" aria-label="回到顶端" title="回到顶端"
      onClick={() => { detailsButtonRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: scrollBehavior() }); }}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14M12 20V8m-6 6 6-6 6 6" /></svg>
    </button>, document.body) : null}
  </>;
}
