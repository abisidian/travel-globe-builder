import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const catalog = JSON.parse(await readFile('src/data/travels.json', 'utf8'));
const topology = JSON.parse(await readFile('public/data/world.topo.json', 'utf8'));

// 编译实际纯数据模块到临时目录，错误堆栈保持简洁，不接触浏览器 UI。
const temporaryModule = join(tmpdir(), 'travel-ball-world-check.mjs');
await build({ stdin: { contents: "export * from './src/lib/world'; export { decodeLandData } from './src/lib/land-data';", resolveDir: process.cwd() }, bundle: true, outfile: temporaryModule, platform: 'node', format: 'esm' });
const { parseWorld, findRegion, findFocusedRegion, findCountry, globeRegions, decodeLandData } = await import(pathToFileURL(temporaryModule).href);
const world = parseWorld(topology);
const landFile = await readFile('public/data/world-land.bin');
const land = decodeLandData(landFile.buffer.slice(landFile.byteOffset, landFile.byteOffset + landFile.byteLength));
const vertexCount = land.positions.length / 3;
assert.equal(land.countryCount, world.countries.length, '预生成陆地必须与国家数据一致');
assert(land.positions.every(Number.isFinite) && land.normals.every(Number.isFinite), '预生成顶点和法线必须有效');
assert(land.regionIndices.every((index) => Number.isInteger(index) && index >= 0 && index < world.countries.length), '顶点国家归属必须有效');
assert(land.indices.every((index) => index < vertexCount), '陆地索引不能超出顶点范围');
assert(vertexCount < land.indices.length, '陆地应复用共享顶点，避免为每个三角形重复存储');
const regionIds = world.regions.map((region) => region.properties.id);
assert.equal(new Set(regionIds).size, regionIds.length, '地图地区 ID 必须唯一');
assert.equal(new Set(catalog.media.map((item) => item.id)).size, catalog.media.length, '素材 ID 必须唯一');

for (const region of catalog.regions) {
  assert(world.byId.has(region.id), `相册地区不存在于地图：${region.id}`);
  assert.equal(new Set(region.cities.map((city) => city.id)).size, region.cities.length, '城市分类 ID 必须唯一');
  assert(catalog.media.some((item) => item.regionId === region.id), `高亮地区缺少素材：${region.id}`);
  assert((await stat(`public${region.cover}`)).size > 0, `地区封面不存在：${region.id}`);
}

for (const item of catalog.media) {
  const region = catalog.regions.find((entry) => entry.id === item.regionId);
  assert(region, `素材所属地区无效：${item.id}`);
  assert(!item.cityId || region.cities.some((city) => city.id === item.cityId), `素材所属城市无效：${item.id}`);
  assert(['photo', 'video'].includes(item.type), `素材类型无效：${item.id}`);
  assert(item.src !== item.thumbnail, '缩略图必须与原始资源分离');
  assert((await stat(`public${item.src}`)).size > 0, `素材文件缺失：${item.id}`);
  assert((await stat(`public${item.thumbnail}`)).size > 0, `缩略图文件缺失：${item.id}`);
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', `public${item.src}`]);
  const info = JSON.parse(stdout);
  assert.equal(item.width, info.streams[0].width, `素材宽度不一致：${item.id}`);
  assert.equal(item.height, info.streams[0].height, `素材高度不一致：${item.id}`);
  if (item.type === 'video') {
    assert.equal(info.streams[0].codec_name, 'h264', '视频应使用兼容浏览器的 H.264 编码');
    assert(Math.abs(Number(info.format.duration) - item.duration) <= 1, `视频时长不一致：${item.id}`);
  }
}

// 使用真实城市坐标验证省级拾取，并覆盖海洋、日期变更线及无省级小国。
const locations = [
  [102.83, 24.88, 'CN-YN'], [104.06, 30.67, 'CN-SC'], [120.16, 30.25, 'CN-ZJ'],
  [141.35, 43.06, 'JP-01'], [11.33, 43.32, 'IT-SI'], [-121.49, 38.58, 'US-CA'],
  [-46.63, -23.55, 'BR-SP'], [7.425, 43.738, 'MCO'], [0, 0, null], [-140, 0, null],
  [121.5654, 25.033, 'CN-TW'], [120.21, 22.999, 'CN-TW'],
  [114.18, 22.32, 'CN-HK'], [113.5439, 22.1987, 'CN-MO'],
];
for (const [lng, lat, expected] of locations) {
  assert.equal(findRegion(world, lng, lat)?.properties.id ?? null, expected, `坐标拾取错误：${lng}, ${lat}`);
  const expectedCountry = expected ? world.byId.get(expected)?.properties.countryId : null;
  assert.equal(findCountry(world, lng, lat)?.properties.id ?? null, expectedCountry, `国家层级拾取错误：${lng}, ${lat}`);
}
assert.equal(findRegion(world, -175, 67)?.properties.id, 'RU-CHU', '跨日期变更线的陆地应该可以拾取');
assert(!world.countryById.has('TWN'), '台湾应归入中国，不能作为独立国家分组');
assert.equal(world.byId.get('CN-TW')?.properties.countryId, 'CHN', '台湾省应归属中国');
assert(!world.countryById.has('HKG') && !world.countryById.has('MAC'), '香港和澳门应归入中国');
assert.equal(world.regions.filter((region) => region.properties.countryId === 'CHN').length, 34, '中国应按 34 个省级行政区展示');
assert(!world.regions.some((region) => region.properties.id.startsWith('TW-')), '台湾省不应继续细分为县市区块');
const chinaProvinceBorders = world.provinceBordersFor('CHN');
assert(world.countryBorders.coordinates.length > 0 && chinaProvinceBorders.coordinates.length > 0, '国界和聚焦国家省界均需存在');
assert(chinaProvinceBorders.coordinates.flat().every(([lng, lat]) => lng > 70 && lng < 140 && lat > 0 && lat < 60), '中国省界中不能混入其他国家省界');
assert.strictEqual(world.provinceBordersFor('CHN'), chinaProvinceBorders, '同一国家省界应复用缓存');
assert.equal(findFocusedRegion(world, 'CHN', 104.06, 30.67)?.properties.id, 'CN-SC', '聚焦中国时可拾取四川');
assert.equal(findFocusedRegion(world, 'CHN', 141.35, 43.06), null, '聚焦中国时不能拾取日本省州');
assert.equal(findFocusedRegion(world, 'CHN', -121.49, 38.58), null, '聚焦中国时不能拾取美国省州');
assert.equal(findFocusedRegion(world, 'JPN', 141.35, 43.06)?.properties.id, 'JP-01', '切换聚焦日本后可拾取北海道');

// 矢量渲染数据必须覆盖无素材陆地，并且只展开当前国家，避免回退成局部栅格贴图。
const globeOverview = globeRegions(world, null);
assert.equal(globeOverview.length, world.countries.length, '全景应包含所有国家的矢量区块');
assert(globeOverview.every((region) => region.properties.level === 'country'), '全景不能提前展开省州');
for (const countryId of ['CHN', 'JPN', 'USA']) {
  const detail = globeRegions(world, countryId);
  const provinces = detail.filter((region) => region.properties.level !== 'country');
  assert.equal(provinces.length, world.regions.filter((region) => region.properties.countryId === countryId).length, '聚焦国家的所有省州均需提供矢量几何');
  assert(provinces.every((region) => region.properties.countryId === countryId), '不能混入其他国家的省级几何');
  assert(!detail.some((region) => region.properties.level === 'country' && region.properties.id === countryId), '国家填色不能覆盖它的省州');
  assert(detail.some((region) => region.properties.level === 'country' && region.properties.id !== countryId), '邻国仍需保留国家区块');
}

console.log(`数据检查通过：${world.countries.length} 个国家地区、${world.regions.length} 个行政区、${catalog.regions.length} 个相册、${catalog.media.length} 份有效素材；预生成陆地、国家、省级拾取与海洋排除正常。`);
