import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mapshaper from 'mapshaper';

const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

/** 优先复用临时目录下载，原始地图不会进入应用产物。 */
async function getSource(kind, filename) {
  const path = join(tmpdir(), `travel-ball-ne-${kind}.geojson`);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    const response = await fetch(`${base}${filename}`, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`地图下载失败：${response.status}`);
    const raw = await response.text();
    const data = JSON.parse(raw);
    await writeFile(path, raw);
    return data;
  }
}

/** 统一地区 ID，缺少 ISO 省级编码时使用 Natural Earth 的稳定编码。 */
function provinceId(properties) {
  return properties.iso_3166_2 && properties.iso_3166_2 !== '-1' && isoCodeCounts.get(properties.iso_3166_2) === 1
    ? properties.iso_3166_2
    : properties.adm1_code;
}

const [states, countries] = await Promise.all([
  getSource('states', 'ne_10m_admin_1_states_provinces.geojson'),
  getSource('countries', 'ne_10m_admin_0_countries.geojson'),
]);
const countriesById = new Map(countries.features.map((item) => [item.properties.ADM0_A3, item.properties]));
const represented = new Set(states.features.map((item) => item.properties.adm0_a3));
const isoCodeCounts = new Map();
const countryFeatureCounts = new Map();
// 个别地区共享旧版 ISO 编码，改用唯一的 Natural Earth 编码防止覆盖。
for (const item of states.features) {
  const code = item.properties.iso_3166_2;
  isoCodeCounts.set(code, (isoCodeCounts.get(code) ?? 0) + 1);
  const country = item.properties.adm0_a3;
  countryFeatureCounts.set(country, (countryFeatureCounts.get(country) ?? 0) + 1);
}

/** 优先以中文显示国家名，无法识别的编码保留原始名称。 */
function displayCountry(id, fallback) {
  const country = countriesById.get(id);
  const iso2 = country?.ISO_A2_EH ?? country?.ISO_A2;
  return iso2 && /^[A-Z]{2}$/.test(iso2) ? countryNames.of(iso2) : fallback;
}

/** 将数据源的地区编码转换为应用的中国省级层次，避免误作独立国家。 */
function chineseProvince(properties) {
  const provinces = {
    TWN: { id: 'CN-TW', name: '台湾省', center: [120.97, 23.7] },
    HKG: { id: 'CN-HK', name: '香港特别行政区', center: [114.16, 22.32] },
    MAC: { id: 'CN-MO', name: '澳门特别行政区', center: [113.55, 22.17] },
  };
  const province = provinces[properties.adm0_a3];
  if (province) return { ...province, countryId: 'CHN', countryName: '中国', color: 4, level: 'province' };
  // 西沙群岛并入海南，地图保持省级最小单位。
  if (properties.adm1_code && properties.iso_3166_2 === 'CN-X01~') {
    return { id: 'CN-HI', name: '海南省', center: [109.78, 19.2], countryId: 'CHN', countryName: '中国', color: 4, level: 'province' };
  }
  return null;
}

const features = states.features.filter((item) => item.geometry).map((item) => {
  const p = item.properties;
  // 单个占位行政区等同整个国家时，直接使用国家作为入口。
  const countryOnly = countryFeatureCounts.get(p.adm0_a3) === 1 && (p.name === p.admin || p.iso_3166_2?.includes('~'));
  const countryName = displayCountry(p.adm0_a3, p.admin);
  return {
    type: 'Feature',
    geometry: item.geometry,
    properties: {
      id: countryOnly ? p.adm0_a3 : provinceId(p), name: countryOnly ? countryName : p.name_zh || p.name || p.adm1_code,
      countryId: p.adm0_a3, countryName,
      center: [Number(p.longitude), Number(p.latitude)],
      color: Number(p.mapcolor9 ?? 0), level: countryOnly ? 'country' : 'province',
      ...chineseProvince(p),
    },
  };
});

// 无省级划分的国家仍可悬停；其国家边界直接作为相册区域。
for (const item of countries.features) {
  const p = item.properties;
  if (!item.geometry || represented.has(p.ADM0_A3)) continue;
  features.push({
    type: 'Feature', geometry: item.geometry,
    properties: {
      id: p.ADM0_A3, name: displayCountry(p.ADM0_A3, p.NAME),
      countryId: p.ADM0_A3, countryName: displayCountry(p.ADM0_A3, p.NAME),
      center: [Number(p.LABEL_X), Number(p.LABEL_Y)],
      color: Number(p.MAPCOLOR9 ?? 0), level: 'country',
    },
  });
}

// 拓扑简化保留共享边与小省州，国界和省界由同一拓扑提取。
const output = await mapshaper.applyCommands(
  '-i regions.geojson -dissolve id copy-fields=name,countryId,countryName,center,color,level -simplify variable percentage="this.area < 100000000 ? 1 : 0.03" keep-shapes -o format=topojson quantization=1000000 regions.json',
  { 'regions.geojson': JSON.stringify({ type: 'FeatureCollection', features }) },
);
await mkdir('public/data', { recursive: true });
await writeFile('public/data/world.topo.json', output['regions.json']);
const regionCount = JSON.parse(output['regions.json']).objects.regions.geometries.length;
console.log(`地图已准备：${regionCount} 个行政区，${(Buffer.byteLength(output['regions.json']) / 1024 / 1024).toFixed(2)} MB`);
