import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, Compass, Earth, MapPin, Minus, MousePointer2, PawPrint, Plus, RotateCcw, RotateCw, Sparkles } from 'lucide-react';
import type { MediaItem, MediaType } from './types';
import { filterMedia, regionCounts, totalCounts, travelRegions } from './data/catalog';
import { loadWorld, supportsWebGL } from './lib/world';
import type { LoadedWorldData } from './lib/world';
import GalleryPanel from './components/GalleryPanel';
import TravelList from './components/TravelList';
import MediaImage from './components/MediaImage';
import MediaViewer from './components/MediaViewer';
import { TravelDoodles } from './components/TravelIllustrations';
import TravelCompanions from './components/TravelCompanions';

// 地球是首页核心内容，与地图请求同时加载，避免等数据完成后才下载三维模块。
const globeModule = import('./components/TravelGlobe');
const TravelGlobe = lazy(() => globeModule);

/** 三维渲染错误独立降级，界面和相册仍继续工作。 */
class GlobeBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  /** 标记渲染失败，避免反复初始化显卡。 */
  static getDerivedStateFromError() { return { failed: true }; }
  /** 将异常交还应用，切换到可访问的地区列表。 */
  componentDidCatch() { this.props.onFailure(); }
  /** 正常呈现地球，异常时由上层显示备用界面。 */
  render() { return this.state.failed ? null : this.props.children; }
}

/** 应用只保留地区、城市、类型与预览索引四类浏览状态。 */
export default function App() {
  const [world, setWorld] = useState<LoadedWorldData | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [globeFailed, setGlobeFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [cityId, setCityId] = useState('all');
  const [mediaType, setMediaType] = useState<MediaType>('photo');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [zoomRequest, setZoomRequest] = useState({ delta: 0, key: 0 });
  const footprintsButton = useRef<HTMLButtonElement>(null);
  const webglSupported = useMemo(supportsWebGL, []);
  const fallback = !webglSupported || globeFailed;
  const selectedRegion = travelRegions.find((region) => region.id === selectedId);
  const visibleItems = useMemo(() => selectedId ? filterMedia(selectedId, cityId, mediaType) : [], [selectedId, cityId, mediaType]);
  const previewIndex = previewId ? visibleItems.findIndex((item) => item.id === previewId) : -1;
  const panelOpen = !!selectedRegion || showList || fallback;
  const countries = new Set(travelRegions.map((region) => region.country)).size;
  // 首张明信片跟随实际素材，空相册不渲染入口。
  const featuredRegion = travelRegions.find((region) => (regionCounts.get(region.id)?.total ?? 0) > 0);

  // 地图失败可独立重试；相册示例数据和图片不依赖地图请求。
  useEffect(() => {
    const controller = new AbortController();
    setMapError(false);
    loadWorld(AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]))
      .then(setWorld)
      .catch(() => { if (!controller.signal.aborted) setMapError(true); });
    return () => controller.abort();
  }, [mapAttempt]);

  /** 地球、明信片和足迹列表共用同一个打开入口。 */
  const selectRegion = useCallback((id: string) => {
    if (!regionCounts.has(id)) return;
    setSelectedId(id); setShowList(false); setCityId('all');
    setMediaType((regionCounts.get(id)?.photos ?? 0) > 0 ? 'photo' : 'video');
    setPreviewId(null);
  }, []);

  /** 关闭面板时保留镜头，将焦点交还足迹按钮。 */
  const closePanel = useCallback(() => {
    setSelectedId(null); setShowList(false);
    footprintsButton.current?.focus({ preventScroll: true });
  }, []);
  const closePreview = useCallback(() => setPreviewId(null), []);
  const handleGlobeFailure = useCallback(() => setGlobeFailed(true), []);
  /** 探索另一个国家时收起原相册，再从该国省州重新选择。 */
  const exploreCountry = useCallback(() => { setSelectedId(null); setShowList(false); }, []);

  // 全屏查看器自行处理 Escape；其他时候 Escape 收起当前面板。
  useEffect(() => {
    /** 保持返回操作可通过键盘完成。 */
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !previewId && panelOpen && !fallback) closePanel();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [previewId, panelOpen, fallback, closePanel]);

  /** 重置视角同时回到地球主页，清除相册选择。 */
  function resetGlobe() { closePanel(); setResetKey((value) => value + 1); }
  /** 缩放按钮为滚轮和双指操作提供可见替代入口。 */
  function zoomGlobe(delta: number) { setZoomRequest((value) => ({ delta, key: value.key + 1 })); }
  /** 全屏预览仅遍历当前城市、当前类型下的素材。 */
  function openMedia(item: MediaItem) { setPreviewId(item.id); }

  return <div className={`app-shell ${panelOpen ? 'panel-is-open' : ''}`}>
    <a href="#explore" className="skip-link">跳转到旅行地球</a>
    <header className="site-header">
      <button className="brand" onClick={resetGlobe} aria-label="漫游记，返回初始地球"><span className="brand-mark"><Earth size={25} strokeWidth={1.3} /></span><span className="brand-text"><strong>漫游记<span>。</span></strong><span>A LITTLE TRAVEL JOURNAL</span></span></button>
      <nav className="main-nav" aria-label="主导航"><button className={!panelOpen ? 'active' : ''} onClick={closePanel}><span className="nav-dot" />探索地球</button><button ref={footprintsButton} className={showList ? 'active' : ''} onClick={() => { setSelectedId(null); setShowList(!showList); }}><PawPrint size={15} />我的足迹<span className="nav-count">{travelRegions.length}</span></button></nav>
      <span className="header-note"><PawPrint size={15} />生活在别处，回忆在这里</span>
    </header>

    <main id="explore" className="explore-main">
      <section className="intro" aria-label="旅行地球简介" aria-hidden={panelOpen} inert={panelOpen}>
        <div className="intro-eyebrow"><PawPrint size={16} /><span>带着好奇心，去看世界</span></div>
        <h1>把回忆，<br />留在<span className="title-earth">地球</span>上<span className="title-period">。</span></h1>
        <p className="intro-description">那些走过的路、看过的风景，<br />转一转，就又想起来了。</p>
        <div className="explore-prompt"><span className="prompt-icon"><MousePointer2 size={16} /></span><span>转动地球，打开一段回忆</span><ArrowDownRight size={22} strokeWidth={1.2} /></div>
        <div className="overview-stats">
          <div><strong>{String(countries).padStart(2, '0')}</strong><span>个国家</span></div><span className="stat-divider" /><div><strong>{String(travelRegions.length).padStart(2, '0')}</strong><span>个省 / 州</span></div><span className="stat-divider" /><div><strong>{String(totalCounts.total).padStart(2, '0')}</strong><span>帧回忆</span></div>
        </div>
        {featuredRegion && <button className="postcard" onClick={() => selectRegion(featuredRegion.id)} aria-label={`打开${featuredRegion.name}的旅行回忆`}>
          <span className="postcard-tape" /><MediaImage src={featuredRegion.cover} alt={`${featuredRegion.name}旅行风景`} eager />
          <span className="postcard-caption"><span><MapPin size={12} />{featuredRegion.name}<span className="postcard-date">{featuredRegion.period}</span></span><ArrowUpRight size={17} /></span>
          <span className="postcard-stamp"><PawPrint size={16} />快乐<br />收集中</span>
        </button>}
      </section>

      <section className="world-stage" aria-label="可拖拽旋转的旅行地球">
        <div className="world-orbit" aria-hidden="true" /><div className="globe-shadow" aria-hidden="true" />
        <TravelDoodles />
        <div className="world-corner"><PawPrint size={25} strokeWidth={1.5} /><span>今天也要<br />好好看世界</span></div>
        <span className="latitude-note" aria-hidden="true">每一段路，都有小惊喜</span>
        {world && !fallback ? <GlobeBoundary onFailure={handleGlobeFailure}><Suspense fallback={<div className="globe-loading"><span className="loading-orbit" />正在点亮旅行地球…</div>}><TravelGlobe world={world} selectedId={selectedId} resetKey={resetKey} zoomRequest={zoomRequest} paused={previewIndex >= 0} onRegionSelect={selectRegion} onFailure={handleGlobeFailure} onReset={resetGlobe} onCountryFocus={exploreCountry} /></Suspense></GlobeBoundary>
          : !fallback && <div className="globe-loading">{mapError ? <><Earth size={38} strokeWidth={1} /><strong>地图还在路上</strong><span>没能加载地图，可以重试或先浏览旅行足迹。</span><div><button className="text-button" onClick={() => setMapAttempt((value) => value + 1)}><RotateCw size={14} />重新加载</button><button className="text-button" onClick={() => setShowList(true)}>浏览旅行足迹<ArrowUpRight size={14} /></button></div></> : <><span className="loading-orbit" /><span>正在展开世界地图…</span></>}</div>}
        {!fallback && <div className="globe-controls"><button onClick={() => zoomGlobe(-0.25)} aria-label="放大地球" disabled={!world}><Plus size={18} /></button><button onClick={() => zoomGlobe(0.25)} aria-label="缩小地球" disabled={!world}><Minus size={18} /></button><span /><button onClick={resetGlobe} aria-label="重置地球视角" disabled={!world}><RotateCcw size={16} /></button></div>}
        <div className="globe-legend"><span><i className="visited-dot" />有回忆的地方</span><span><i className="unvisited-dot" />待探索的世界</span></div>
        <div className="world-instruction"><MousePointer2 size={13} /><span className="desktop-instruction">拖拽旋转 · 滚轮缩放 · 逐级探索回忆</span><span className="mobile-instruction">单指旋转 · 双指缩放 · 探索旅行回忆</span></div>
      </section>

      <TravelCompanions hidden={panelOpen} />

      {selectedRegion ? <GalleryPanel region={selectedRegion} cityId={cityId} type={mediaType} items={visibleItems} onCityChange={setCityId} onTypeChange={setMediaType} onOpenMedia={openMedia} onClose={closePanel} />
        : (showList || fallback) && <TravelList onSelect={selectRegion} onClose={closePanel} fallback={fallback} />}
      {!panelOpen && <div className="memory-note"><Sparkles size={15} strokeWidth={1.4} /><span>世界很大，我们慢慢走。</span></div>}
    </main>

    <footer className="site-footer"><span className="footer-tagline"><Compass size={14} />收集风景，也收集自己。</span><span className="demo-label"><Check size={12} />本地旅行相册</span><details className="source-credits"><summary>素材与地图来源<ArrowUpRight size={11} /></summary><div><a href="https://unsplash.com" target="_blank" rel="noreferrer">Unsplash · 示例照片</a><a href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video" target="_blank" rel="noreferrer">MDN · CC0 示例视频</a><a href="https://commons.wikimedia.org/wiki/File:Waves_of_the_sea_(Video).webm" target="_blank" rel="noreferrer">Amada44 · 海浪视频 · CC BY-SA 4.0</a><a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth · 行政区边界</a><span>示例风景用于演示，不代表实际拍摄地点。</span></div></details></footer>
    {selectedRegion && previewIndex >= 0 && <MediaViewer region={selectedRegion} items={visibleItems} index={previewIndex} onIndexChange={(index) => setPreviewId(visibleItems[index]?.id ?? null)} onClose={closePreview} />}
  </div>;
}
