import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo';
import { feature, merge, mesh } from 'topojson-client';
import type { Polygon as TopoPolygon, MultiPolygon as TopoMultiPolygon } from 'topojson-specification';
import type { FeatureCollection, MultiLineString, Polygon, Position } from 'geojson';
import type { RegionFeature, RegionProperties, WorldTopology } from '../types';
import { regionCounts } from '../data/catalog';
import { decodeLandData } from './land-data';
import type { LandData } from './land-data';

interface IndexedRegion {
  feature: RegionFeature;
  bounds: [[number, number], [number, number]];
  area: number;
}

export interface WorldData {
  regions: RegionFeature[];
  countries: RegionFeature[];
  byId: Map<string, RegionFeature>;
  countryById: Map<string, RegionFeature>;
  index: IndexedRegion[];
  countryIndex: IndexedRegion[];
  countryBorders: MultiLineString;
  provinceBordersFor: (countryId: string) => MultiLineString;
}

export interface LoadedWorldData extends WorldData {
  landData: LandData;
}

// 只缓存完整成功的结果，组件重进时复用，失败后仍可正常重试。
let cachedWorld: LoadedWorldData | null = null;

const landColors = ['#c7d9a9', '#e5d6af', '#bcd3af', '#ddd1b3', '#cedbb4'];

/** D3 的球面多边形采用顺时针外环，统一方向防止填充地球的补集。 */
function orientPolygon(coordinates: Position[][]) {
  const polygon: Polygon = { type: 'Polygon', coordinates };
  return geoArea(polygon) > Math.PI * 2
    ? coordinates.map((ring) => [...ring].reverse())
    : coordinates;
}

/** 并行读取拓扑与预生成陆地，同一页面会话内复用解析结果。 */
export async function loadWorld(signal: AbortSignal): Promise<LoadedWorldData> {
  signal.throwIfAborted();
  if (cachedWorld) return cachedWorld;
  const [response, landResponse] = await Promise.all([
    fetch('/data/world.topo.json', { signal }),
    fetch('/data/world-land.bin', { signal }),
  ]);
  if (!response.ok || !landResponse.ok) throw new Error('地图暂时没有加载成功');
  const [topology, landBuffer] = await Promise.all([response.json() as Promise<WorldTopology>, landResponse.arrayBuffer()]);
  const world = parseWorld(topology);
  const landData = decodeLandData(landBuffer);
  if (landData.countryCount !== world.countries.length) throw new Error('地图与几何资源版本不一致');
  cachedWorld = { ...world, landData };
  return cachedWorld;
}

/** 将原始拓扑转换成绘图、镜头与球面拾取共用的只读地区索引。 */
export function parseWorld(topology: WorldTopology): WorldData {
  const collection = feature(topology, topology.objects.regions) as FeatureCollection<RegionFeature['geometry'], RegionFeature['properties']>;
  const regions = collection.features.map((region) => {
    const geometry = region.geometry.type === 'Polygon'
      ? { ...region.geometry, coordinates: orientPolygon(region.geometry.coordinates) }
      : { ...region.geometry, coordinates: region.geometry.coordinates.map(orientPolygon) };
    const result: RegionFeature = { ...region, geometry };
    if (!region.properties.center.every(Number.isFinite)) result.properties.center = geoCentroid(result);
    return result;
  });
  type RegionGeometry = TopoPolygon<RegionProperties> | TopoMultiPolygon<RegionProperties>;
  const countryGroups = new Map<string, RegionGeometry[]>();
  for (const geometry of topology.objects.regions.geometries as RegionGeometry[]) {
    const id = geometry.properties!.countryId;
    if (!countryGroups.has(id)) countryGroups.set(id, []);
    countryGroups.get(id)!.push(geometry);
  }
  // 从同一份省州拓扑合并国家，切换层级时国界不会跳动或错位。
  const countries = [...countryGroups].map(([id, geometries]): RegionFeature => {
    const geometry = merge(topology, geometries);
    geometry.coordinates = geometry.coordinates.map(orientPolygon);
    const largestPolygon = geometry.coordinates.reduce((largest, polygon) =>
      geoArea({ type: 'Polygon', coordinates: polygon }) > geoArea({ type: 'Polygon', coordinates: largest }) ? polygon : largest,
    );
    const properties = geometries[0].properties as RegionProperties;
    return {
      type: 'Feature', geometry,
      properties: { ...properties, id, name: properties.countryName, level: 'country', center: geoCentroid({ type: 'Polygon', coordinates: largestPolygon }) },
    };
  });
  const provinceBorderCache = new Map<string, MultiLineString>();

  /** 只提取目标国家内部的省界，按国家缓存，避免出现周边国家省界。 */
  function provinceBordersFor(countryId: string): MultiLineString {
    const cached = provinceBorderCache.get(countryId);
    if (cached) return cached;
    const geometries = countryGroups.get(countryId);
    const borders = geometries
      ? mesh(topology, { type: 'GeometryCollection', geometries }, (a, b) => a !== b)
      : { type: 'MultiLineString' as const, coordinates: [] };
    provinceBorderCache.set(countryId, borders);
    return borders;
  }
  return {
    regions,
    countries,
    byId: new Map(regions.map((region) => [region.properties.id, region])),
    countryById: new Map(countries.map((country) => [country.properties.id, country])),
    index: regions.map((region) => ({ feature: region, bounds: geoBounds(region), area: geoArea(region) })).sort((a, b) => a.area - b.area),
    countryIndex: countries.map((country) => ({ feature: country, bounds: geoBounds(country), area: geoArea(country) })).sort((a, b) => a.area - b.area),
    countryBorders: mesh(topology, topology.objects.regions, (a, b) => a === b || (a.properties as RegionProperties).countryId !== (b.properties as RegionProperties).countryId),
    provinceBordersFor,
  };
}

/** 先用球面包围盒排除大多数地区，再精确判断；兼容跨越日期变更线的区域。 */
export function findRegion(world: WorldData, lng: number, lat: number) {
  return findInIndex(world.index, lng, lat);
}

/** 省级拾取限定在聚焦国家内，邻国仍通过国家入口选择。 */
export function findFocusedRegion(world: WorldData, countryId: string, lng: number, lat: number) {
  return findInIndex(world.index, lng, lat, countryId);
}

/** 全景模式只拾取国家，鼠标经过省界时不会产生碎块闪动。 */
export function findCountry(world: WorldData, lng: number, lat: number) {
  return findInIndex(world.countryIndex, lng, lat);
}

/** 地图始终使用矢量国家区块，只把聚焦国家替换为它的省州，避免近景贴图模糊。 */
export function globeRegions(world: WorldData, focusedCountryId: string | null) {
  return focusedCountryId
    ? [...world.countries.filter((country) => country.properties.id !== focusedCountryId), ...world.regions.filter((region) => region.properties.countryId === focusedCountryId)]
    : world.countries;
}

/** 国家和省州共用球面包含判断，支持经度跨越 ±180° 的区域。 */
function findInIndex(index: IndexedRegion[], lng: number, lat: number, countryId?: string) {
  for (const entry of index) {
    if (countryId && entry.feature.properties.countryId !== countryId) continue;
    const [[west, south], [east, north]] = entry.bounds;
    const inLongitude = west <= east ? lng >= west && lng <= east : lng >= west || lng <= east;
    if (lat >= south && lat <= north && inLongitude && geoContains(entry.feature, [lng, lat])) return entry.feature;
  }
  return null;
}

/** 无素材地区用柔和国别底色，有素材地区统一点亮为陶土色。 */
export function regionColor(region: RegionFeature, hasCountryMemories = false) {
  return hasCountryMemories || regionCounts.has(region.properties.id) ? '#eeb37d' : landColors[Math.abs(region.properties.color) % landColors.length];
}

/** 在创建地球前检测 WebGL，无法使用时仍可从地区列表浏览相册。 */
export function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
