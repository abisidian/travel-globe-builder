import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronLeft, ChevronRight, Film, Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { MediaItem, TravelRegion } from '../types';
import MediaImage from './MediaImage';

interface Props {
  items: MediaItem[];
  index: number;
  region: TravelRegion;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** 全屏查看器独立挂在 body，下方相册保持原状态与滚动位置。 */
export default function MediaViewer({ items, index, region, onIndexChange, onClose }: Props) {
  const item = items[index];
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const activeThumbnail = useRef<HTMLButtonElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoAttempt, setVideoAttempt] = useState(0);
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const fit = Math.min(viewportSize.width / item.width, viewportSize.height / item.height);
  const maxPanX = Math.max(0, (item.width * fit * zoom - viewportSize.width) / 2);
  const maxPanY = Math.max(0, (item.height * fit * zoom - viewportSize.height) / 2);

  /** 所有切换入口先暂停当前视频，失败重试后的播放器也遵循同一规则。 */
  const changeItem = useCallback((next: number) => {
    if (next < 0 || next >= items.length) return;
    video.current?.pause(); onIndexChange(next);
  }, [items.length, onIndexChange]);

  /** 关闭按钮与 Escape 共用显式暂停操作。 */
  const closeViewer = useCallback(() => { video.current?.pause(); onClose(); }, [onClose]);

  // 进入预览后锁定背景滚动，退出时将键盘焦点还给原素材卡片。
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const background = document.getElementById('root');
    const previousInert = background?.inert ?? false;
    document.body.style.overflow = 'hidden';
    if (background) background.inert = true;
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (background) background.inert = previousInert;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  // 缓存实际展示区域，窗口旋转或尺寸变化后重新计算照片的拖动边界。
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    /** 同步可见区域尺寸，避免拖动时反复读取布局。 */
    function updateSize() {
      const bounds = element!.getBoundingClientRect();
      setViewportSize((previous) => previous.width === bounds.width && previous.height === bounds.height
        ? previous : { width: bounds.width, height: bounds.height });
    }
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 缩小照片时同时收紧平移范围，防止旧偏移把照片留在画面外。
  useLayoutEffect(() => {
    setPan((previous) => {
      const x = Math.max(-maxPanX, Math.min(maxPanX, previous.x));
      const y = Math.max(-maxPanY, Math.min(maxPanY, previous.y));
      return x === previous.x && y === previous.y ? previous : { x, y };
    });
  }, [maxPanX, maxPanY]);

  // 每一张素材拥有独立缩放和播放状态，切换时显式暂停旧视频。
  useLayoutEffect(() => {
    setZoom(1); setPan({ x: 0, y: 0 }); setVideoFailed(false); setVideoAttempt(0); drag.current = null;
    const element = video.current;
    return () => { element?.pause(); };
  }, [item.id]);

  // 切换后让当前缩略图保持可见，同时尊重系统的减少动态效果设置。
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeThumbnail.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reducedMotion ? 'instant' : 'smooth' });
  }, [item.id]);

  // 查看器内循环焦点；视频获得焦点时保留原生左右键快进操作。
  useEffect(() => {
    /** 处理关闭、切换和模态焦点循环。 */
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeViewer(); }
      if (!(event.target instanceof HTMLVideoElement) && !(event.target instanceof HTMLInputElement)) {
        if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); changeItem(index - 1); }
        if (event.key === 'ArrowRight' && index < items.length - 1) { event.preventDefault(); changeItem(index + 1); }
      }
      if (event.key === 'Tab') {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], video, [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0);
        const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [index, items.length, closeViewer, changeItem]);

  // 非被动滚轮监听避免缩放照片时同时触发浏览器滚动。
  useEffect(() => {
    const element = viewport.current;
    if (!element || item.type !== 'photo') return;
    /** 以小步长缩放照片，缩回原图时清除平移量。 */
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      setZoom((value) => Math.min(3, Math.max(1, value - event.deltaY * 0.002)));
    }
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [item.id, item.type]);

  /** 按钮缩放与滚轮采用相同范围，避免缩小后遗留偏移。 */
  function changeZoom(amount: number) {
    setZoom((value) => Math.min(3, Math.max(1, Math.round((value + amount) * 10) / 10)));
    setPan({ x: 0, y: 0 });
  }

  return createPortal(<div className="media-viewer" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="viewer-title">
    <header className="viewer-header"><div className="viewer-heading">
      <span className="viewer-type">{item.type === 'photo' ? <Camera size={16} /> : <Film size={16} />}{region.country} / {region.name}</span>
      <h2 id="viewer-title">{item.title}</h2>
    </div><div className="viewer-actions"><span className="viewer-counter">{String(index + 1).padStart(2, '0')}<span> / {String(items.length).padStart(2, '0')}</span></span><button ref={closeButton} className="viewer-icon" onClick={closeViewer} aria-label="关闭全屏预览"><X size={23} /></button></div></header>
    <div className="viewer-stage">
      <button className="viewer-arrow previous" onClick={() => changeItem(index - 1)} disabled={index === 0} aria-label="上一张素材"><ChevronLeft size={27} /></button>
      <div className={`viewer-viewport ${zoom > 1 ? 'is-zoomed' : ''}`} ref={viewport}
        onDoubleClick={() => { if (item.type === 'photo') { setZoom(zoom > 1 ? 1 : 2); setPan({ x: 0, y: 0 }); } }}
        onPointerDown={(event) => {
          if (zoom <= 1 || item.type !== 'photo' || event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y };
        }}
        onPointerMove={(event) => {
          if (!drag.current || event.pointerId !== drag.current.pointerId) return;
          setPan({ x: Math.max(-maxPanX, Math.min(maxPanX, drag.current.startX + event.clientX - drag.current.x)), y: Math.max(-maxPanY, Math.min(maxPanY, drag.current.startY + event.clientY - drag.current.y)) });
        }} onPointerUp={(event) => { if (event.pointerId === drag.current?.pointerId) drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {item.type === 'photo' ? <div className="preview-image" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><MediaImage key={item.id} src={item.src} alt={item.title} eager /></div>
          : videoFailed ? <div className="video-error"><Film size={32} /><p>视频没有加载成功</p><button onClick={() => { setVideoFailed(false); setVideoAttempt((value) => value + 1); }}>重新加载</button></div>
          : <video ref={video} key={`${item.id}-${videoAttempt}`} controls playsInline preload="metadata" poster={item.thumbnail} src={`${item.src}${videoAttempt ? `?retry=${videoAttempt}` : ''}`} onError={() => setVideoFailed(true)} aria-label={item.title} />}
      </div>
      <button className="viewer-arrow next" onClick={() => changeItem(index + 1)} disabled={index === items.length - 1} aria-label="下一张素材"><ChevronRight size={27} /></button>
    </div>
    <footer className="viewer-footer"><div className="viewer-metadata"><span>{region.cities.find((city) => city.id === item.cityId)?.name ?? region.name}</span><span>{item.creditUrl ? <a href={item.creditUrl} target="_blank" rel="noreferrer">{item.credit}</a> : item.credit}{item.licenseUrl && <> · <a href={item.licenseUrl} target="_blank" rel="noreferrer">授权</a></>}</span></div>
      {item.type === 'photo' && <div className="zoom-controls"><button className="viewer-icon" onClick={() => changeZoom(-0.25)} disabled={zoom <= 1} aria-label="缩小照片"><Minus size={17} /></button><span>{Math.round(zoom * 100)}%</span><button className="viewer-icon" onClick={() => changeZoom(0.25)} disabled={zoom >= 3} aria-label="放大照片"><Plus size={17} /></button><button className="viewer-icon" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="恢复原始比例"><RotateCcw size={15} /></button></div>}
      <span className="viewer-hint">← → 切换<span>ESC 关闭</span></span>
    </footer>
    <div className="viewer-filmstrip" aria-label="当前相册缩略图">{items.map((entry, entryIndex) => <button key={entry.id} ref={entryIndex === index ? activeThumbnail : undefined} aria-label={`查看${entry.title}`} aria-current={entryIndex === index ? 'true' : undefined} className={entryIndex === index ? 'active' : ''} onClick={() => changeItem(entryIndex)}><img src={entry.thumbnail} alt="" loading="lazy" />{entry.type === 'video' && <Film size={12} />}</button>)}</div>
  </div>, document.body);
}
