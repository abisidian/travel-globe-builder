import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial } from 'three';
import { Camera, ChevronLeft, Earth, Film, MousePointer2 } from 'lucide-react';
import { geoArea, geoBounds, geoGraticule } from 'd3-geo';
import { findCountry, findFocusedRegion, globeRegions, regionColor } from '../lib/world';
import { createGlobeMaterial } from '../lib/globe-material';
import { createCountryBorders } from '../lib/globe-borders';
import { createLandMesh, createPreparedLandMesh } from '../lib/globe-land';
import type { LoadedWorldData } from '../lib/world';
import type { MediaCounts, RegionFeature } from '../types';
import { regionCounts, travelRegions } from '../data/catalog';

interface Props {
  world: LoadedWorldData;
  selectedId: string | null;
  resetKey: number;
  zoomRequest: { delta: number; key: number };
  paused: boolean;
  onRegionSelect: (id: string) => void;
  onFailure: () => void;
  onReset: () => void;
  onCountryFocus: () => void;
}

const initialView = { lat: 30, lng: 108, altitude: 1.75 };

/** 国家与当前国家的省州均由矢量几何绘制，悬停时只调整对应区块的高度。 */
export default function TravelGlobe({ world, selectedId, resetKey, zoomRequest, paused, onRegionSelect, onFailure, onReset, onCountryFocus }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 850, height: 740 });
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const [detail, setDetail] = useState(false);
  const [currentCountryId, setCurrentCountryId] = useState<string | null>(null);
  const focusedCountryRef = useRef<string | null>(null);
  const detailRef = useRef(false);
  const [hovered, setHovered] = useState<RegionFeature | null>(null);
  const [trail, setTrail] = useState<RegionFeature[]>([]);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const hoveredRef = useRef<RegionFeature | null>(null);
  const animationFrame = useRef(0);
  const lastReset = useRef(resetKey);
  const pointers = useRef(new Set<number>());
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const lastDrag = useRef(0);
  const capMaterials = useMemo(() => new Map<string, MeshPhongMaterial>(), []);
  const visited = useMemo(() => world.regions.filter((region) => regionCounts.has(region.properties.id)), [world]);
  const countryCounts = useMemo(() => {
    const counts = new Map<string, MediaCounts>();
    for (const region of visited) {
      const country = region.properties.countryId;
      const current = counts.get(country) ?? { photos: 0, videos: 0, total: 0 };
      const next = regionCounts.get(region.properties.id)!;
      counts.set(country, { photos: current.photos + next.photos, videos: current.videos + next.videos, total: current.total + next.total });
    }
    return counts;
  }, [visited]);
  const material = useMemo(createGlobeMaterial, []);
  const graticules = useMemo(() => geoGraticule().step([30, 30])().coordinates, []);
  const showProvinces = detail && currentCountryId !== null;
  const mapRegions = useMemo(() => globeRegions(world, showProvinces ? currentCountryId : null), [world, showProvinces, currentCountryId]);
  const focusedRegions = useMemo(() => showProvinces ? mapRegions.filter((region) => region.properties.countryId === currentCountryId) : [], [mapRegions, showProvinces, currentCountryId]);
  // 动态图层只保留悬停过渡与已选区块，静态填色由合并网格绘制。
  const polygonData = useMemo(() => {
    const selected = selectedId ? mapRegions.find((region) => region.properties.id === selectedId) : undefined;
    return [...new Map([...trail, ...(selected ? [selected] : [])].map((region) => [region.properties.id, region])).values()];
  }, [mapRegions, trail, selectedId]);
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  /** 统一切换聚焦国家，清除上一国家的悬停块与拾取状态。 */
  const setFocusedCountry = useCallback((id: string | null) => {
    if (focusedCountryRef.current === id) return;
    focusedCountryRef.current = id;
    setCurrentCountryId(id);
    hoveredRef.current = null;
    setHovered(null); setTrail([]);
    cancelAnimationFrame(animationFrame.current);
  }, []);

  // 离开的区块保留一个抬升过渡周期，再从动态层移除。
  useEffect(() => {
    const timer = window.setTimeout(() => setTrail(hovered ? [hovered] : []), reduceMotion ? 0 : 230);
    return () => window.clearTimeout(timer);
  }, [hovered, reduceMotion]);

  // 面板改变可用空间时同步画布尺寸，地球不会被抽屉遮住。
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  // 选择地区只改变镜头朝向；收起相册保留当前地球位置。
  useEffect(() => {
    if (!ready || !globe.current) return;
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      setFocusedCountry(null);
      globe.current.pointOfView(initialView, reduceMotion ? 0 : 650);
    } else if (selectedId) {
      const region = world.byId.get(selectedId);
      if (region) {
        setFocusedCountry(region.properties.countryId);
        globe.current.pointOfView({ lng: region.properties.center[0], lat: region.properties.center[1], altitude: 0.7 }, reduceMotion ? 0 : 650);
      }
    }
  }, [selectedId, resetKey, ready, world, reduceMotion, setFocusedCountry]);

  // 可见缩放按钮与滚轮共享相机状态，不改变当前朝向。
  useEffect(() => {
    if (!ready || !globe.current || !zoomRequest.key) return;
    const view = globe.current.pointOfView();
    globe.current.pointOfView({ ...view, altitude: Math.max(0.3, Math.min(3.5, view.altitude + zoomRequest.delta)) }, reduceMotion ? 0 : 220);
  }, [zoomRequest, ready, reduceMotion]);

  // 全屏预览或后台标签页暂停三维渲染，关闭后恢复交互。
  useEffect(() => {
    /** 根据页面和查看器状态同步渲染循环。 */
    function syncAnimation() {
      if (paused || document.hidden) globe.current?.pauseAnimation();
      else globe.current?.resumeAnimation();
    }
    syncAnimation();
    document.addEventListener('visibilitychange', syncAnimation);
    return () => document.removeEventListener('visibilitychange', syncAnimation);
  }, [paused, ready]);

  // 显卡上下文丢失时切换到地区列表，保持相册可访问。
  useEffect(() => {
    if (!ready) return;
    const canvas = globe.current?.renderer().domElement;
    /** 浏览器回收显卡上下文后使用备用入口。 */
    function handleContextLost(event: Event) { event.preventDefault(); onFailure(); }
    canvas?.addEventListener('webglcontextlost', handleContextLost);
    return () => canvas?.removeEventListener('webglcontextlost', handleContextLost);
  }, [ready, onFailure]);

  // 全球陆地和国界只生成一次；所有岛屿合并绘制，不逐岛占用绘制调用。
  useEffect(() => {
    const instance = globe.current;
    if (!ready || !instance) return;
    const land = createPreparedLandMesh(world.landData, world.countries, instance.getGlobeRadius(), new Set(countryCounts.keys()));
    const borders = createCountryBorders(world.countryBorders, (lat, lng, altitude) => instance.getCoords(lat, lng, altitude));
    instance.scene().add(land, borders);
    return () => {
      instance.scene().remove(land, borders);
      land.geometry.dispose(); land.material.dispose();
      borders.geometry.dispose(); borders.material.dispose();
    };
  }, [ready, world, countryCounts]);

  // 聚焦国家覆盖一层省州矢量网格，切换时释放旧网格，邻国维持国家区块。
  useEffect(() => {
    const instance = globe.current;
    if (!ready || !instance || !currentCountryId || !focusedRegions.length) return;
    const land = createLandMesh(focusedRegions, instance.getGlobeRadius(), 0.002, new Set(countryCounts.keys()));
    const borders = createCountryBorders(world.provinceBordersFor(currentCountryId), (lat, lng, altitude) => instance.getCoords(lat, lng, altitude), true);
    instance.scene().add(land, borders);
    return () => {
      instance.scene().remove(land, borders);
      land.geometry.dispose(); land.material.dispose();
      borders.geometry.dispose(); borders.material.dispose();
    };
  }, [ready, world, currentCountryId, focusedRegions, countryCounts]);

  // 卸载时释放自建材质与尚未执行的拾取任务。
  useEffect(() => () => {
    cancelAnimationFrame(animationFrame.current);
    material.dispose();
    for (const entry of capMaterials.values()) entry.dispose();
  }, [material, capMaterials]);

  /** 稳定材质实例，鼠标移动不重复创建 GPU 资源。 */
  const capMaterial = useCallback((object: object) => {
    const region = object as RegionFeature;
    let result = capMaterials.get(region.properties.id);
    if (!result) {
      result = new MeshPhongMaterial({ color: regionColor(region, region.properties.level === 'country' && countryCounts.has(region.properties.id)), shininess: 0 });
      capMaterials.set(region.properties.id, result);
    }
    return result;
  }, [capMaterials, countryCounts]);

  /** 统一省块高度，悬停优先于选中态。 */
  const polygonAltitude = useCallback((object: object) => {
    const id = (object as RegionFeature).properties.id;
    const isCountry = (object as RegionFeature).properties.level === 'country';
    return id === hovered?.properties.id ? (isCountry ? 0.022 : 0.035) : id === selectedId ? 0.018 : 0.0028;
  }, [hovered, selectedId]);

  /** 根据当前缩放层级拾取国家或省州，世界全景不暴露细碎省块。 */
  function pick(clientX: number, clientY: number) {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds || !globe.current || !ready) return null;
    const coords = globe.current.toGlobeCoords(clientX - bounds.left, clientY - bounds.top);
    if (!coords) return null;
    const country = findCountry(world, coords.lng, coords.lat);
    const focusedId = focusedCountryRef.current;
    return detailRef.current && focusedId && country?.properties.id === focusedId
      ? findFocusedRegion(world, focusedId, coords.lng, coords.lat) ?? country
      : country;
  }

  /** 指针位置每帧最多处理一次，省块变化时才更新悬停高度。 */
  function updateHover(clientX: number, clientY: number) {
    cancelAnimationFrame(animationFrame.current);
    animationFrame.current = requestAnimationFrame(() => {
      const region = pick(clientX, clientY);
      const bounds = container.current?.getBoundingClientRect();
      if (bounds) setPointer({ x: clientX - bounds.left, y: clientY - bounds.top });
      if (region?.properties.id !== hoveredRef.current?.properties.id) {
        hoveredRef.current = region;
        setHovered(region);
        if (region) setTrail((previous) => [region, ...previous.filter((entry) => entry.properties.id !== region.properties.id)].slice(0, 3));
      }
    });
  }

  /** 移出或拖拽时清除浮层，拖动结束不会误触相册。 */
  const clearHover = useCallback(() => {
    cancelAnimationFrame(animationFrame.current);
    hoveredRef.current = null; setHovered(null);
  }, []);

  /** 使用双阈值切换国家与省州视图，避免临界缩放处反复闪动。 */
  const handleZoom = useCallback(({ altitude }: { altitude: number }) => {
    clearHover();
    const previous = detailRef.current;
    const next = previous ? altitude < 1.3 : altitude < 1.15;
    if (next !== previous) {
      detailRef.current = next;
      setDetail(next); setTrail([]);
      if (!next) setFocusedCountry(null);
    }
    // 手动滚轮进入细节时确定一次目标国家；之后旋转不自动展开邻国省界。
    if (next && !focusedCountryRef.current) {
      const view = globe.current?.pointOfView();
      const country = view ? findCountry(world, view.lng, view.lat) : null;
      if (country) setFocusedCountry(country.properties.id);
    }
  }, [clearHover, world, setFocusedCountry]);

  /** 点击国家先聚焦其主要陆地，镜头靠近后自然切换为省州区块。 */
  function focusCountry(country: RegionFeature) {
    if (!globe.current) return;
    const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
    const largest = polygons.reduce((a, b) => geoArea({ type: 'Polygon', coordinates: a }) > geoArea({ type: 'Polygon', coordinates: b }) ? a : b);
    const [[west, south], [east, north]] = geoBounds({ type: 'Polygon', coordinates: largest });
    const [lng, lat] = country.properties.center;
    const longitudeSpan = (east >= west ? east - west : 360 - west + east) * Math.cos(lat * Math.PI / 180);
    const altitude = Math.min(0.95, Math.max(0.3, Math.max(longitudeSpan, north - south) / 65));
    clearHover();
    setFocusedCountry(country.properties.id);
    onCountryFocus();
    globe.current.pointOfView({ lat, lng, altitude }, reduceMotion ? 0 : 700);
  }

  /** 实例绑定后配置镜头和手势；同步就绪回调及挂载补偿共用幂等入口。 */
  const handleReady = useCallback(() => {
    const instance = globe.current;
    if (!instance || initialized.current) return;
    const controls = instance.controls();
    const radius = instance.getGlobeRadius();
    controls.autoRotate = false; controls.enablePan = false;
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.65; controls.zoomSpeed = 0.8;
    controls.minDistance = radius * 1.3; controls.maxDistance = radius * 4.5;
    instance.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 2));
    instance.pointOfView(initialView, 0);
    initialized.current = true;
    setReady(true);
  }, []);

  // 纯色地球可能在子组件布局阶段同步就绪，此时 ref 尚未绑定；挂载后补做初始化。
  useEffect(handleReady, [handleReady]);

  const hoverCounts = hovered ? (hovered.properties.level === 'country' ? countryCounts : regionCounts).get(hovered.properties.id) : undefined;
  const hoverTravel = hovered ? travelRegions.find((region) => region.id === hovered.properties.id) : undefined;
  const hoverIsCountry = hovered?.properties.level === 'country';
  const currentCountry = currentCountryId ? world.countryById.get(currentCountryId) : undefined;

  return <div ref={container} className={`globe-canvas ${hoverCounts || hoverIsCountry ? 'can-select' : ''}`}
    onPointerDownCapture={(event) => {
      if ((event.target as Element).closest('.map-level')) return;
      pointers.current.add(event.pointerId);
      if (pointers.current.size === 1) gesture.current = { x: event.clientX, y: event.clientY, moved: false };
      else gesture.current.moved = true;
      clearHover();
    }}
    onPointerMoveCapture={(event) => {
      if ((event.target as Element).closest('.map-level')) { clearHover(); return; }
      if (pointers.current.size) {
        if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 6) gesture.current.moved = true;
        return;
      }
      if (event.pointerType !== 'touch' && performance.now() - lastDrag.current > 180) updateHover(event.clientX, event.clientY);
    }}
    onPointerUpCapture={(event) => {
      if ((event.target as Element).closest('.map-level')) return;
      if (!pointers.current.delete(event.pointerId)) return;
      if (gesture.current.moved) { lastDrag.current = performance.now(); return; }
      if (event.button !== 0 || pointers.current.size > 0) return;
      const region = pick(event.clientX, event.clientY);
      const countryAlbum = region?.properties.level === 'country' && detailRef.current && focusedCountryRef.current === region.properties.id && regionCounts.has(region.properties.id);
      if (region?.properties.level === 'country' && !countryAlbum) focusCountry(region);
      else if (region && regionCounts.has(region.properties.id)) onRegionSelect(region.properties.id);
      else updateHover(event.clientX, event.clientY);
    }}
    onPointerCancel={(event) => { pointers.current.delete(event.pointerId); gesture.current.moved = true; clearHover(); }}
    onLostPointerCapture={(event) => { pointers.current.delete(event.pointerId); }}
    onPointerLeave={clearHover}>
    <Globe ref={globe} width={size.width} height={size.height} backgroundColor="rgba(0,0,0,0)"
      globeMaterial={material} globeCurvatureResolution={1} animateIn={false} showAtmosphere atmosphereColor="#dfdfbd" atmosphereAltitude={0.04}
      enablePointerInteraction={false} showPointerCursor={false} onGlobeReady={handleReady}
      polygonsData={polygonData} polygonCapMaterial={capMaterial} polygonSideColor={() => '#b7956b'} polygonStrokeColor={() => '#667151'}
      polygonAltitude={polygonAltitude} polygonCapCurvatureResolution={1} polygonsTransitionDuration={reduceMotion ? 0 : 200}
      pathsData={graticules} pathPointLat={(point: number[]) => point[1]} pathPointLng={(point: number[]) => point[0]} pathPointAlt={0.0004}
      pathColor={() => '#b2d4cb75'} pathResolution={1} pathDashLength={0.012} pathDashGap={0.018} pathTransitionDuration={0}
      onZoom={handleZoom} />
    <div className="map-level" onPointerDownCapture={(event) => event.stopPropagation()} onPointerUpCapture={(event) => event.stopPropagation()}>
      {showProvinces ? <><button onClick={onReset}><ChevronLeft size={13} />返回世界</button><span className="level-separator" />{currentCountry && <strong className="current-country">{currentCountry.properties.name}</strong>}<span>省 / 州视图</span></> : <><Earth size={13} /><span>国家视图</span><span className="level-hint">点击国家，探索省州</span></>}
    </div>
    {!ready && <div className="globe-loading"><span className="loading-orbit" /><span>正在展开世界地图…</span></div>}
    {hovered && <div className={`region-tooltip ${hoverCounts ? 'has-memories' : ''}`} style={{ left: Math.max(12, Math.min(pointer.x + 18, size.width - 238)), top: Math.max(12, Math.min(pointer.y + 18, size.height - 154)) }}>
      <span className="tooltip-country">{hovered.properties.countryName}</span><strong>{hoverTravel?.name ?? hovered.properties.name}</strong>
      {hoverCounts ? <span className="tooltip-counts"><Camera size={13} />{hoverCounts.photos} 张照片<Film size={13} />{hoverCounts.videos} 段视频</span> : <span className="tooltip-empty">暂无旅行记录 · 未来会抵达</span>}
      {(hoverIsCountry || hoverCounts) && <span className="tooltip-action"><MousePointer2 size={12} />{hoverIsCountry ? '点击，放大探索省 / 州' : '点击，打开这段回忆'}</span>}
    </div>}
  </div>;
}
