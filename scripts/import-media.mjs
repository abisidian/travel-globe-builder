import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, stat, lstat, mkdir, copyFile, writeFile, rename, unlink, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, extname, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const photoExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.avif', '.bmp']);

/** 解析明确的项目与导入计划，默认仅预检，只有 --apply 才写入。 */
function argumentsOf(args) {
  const result = { apply: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') result.apply = true;
    else if (['--project', '--plan'].includes(args[i]) && args[i + 1]) result[args[i++].slice(2)] = args[i];
    else throw new Error(`未知或缺少值的参数：${args[i]}`);
  }
  if (!result.project || !result.plan) throw new Error('用法：node import-media.mjs --project <项目> --plan <计划.json> [--apply]');
  return result;
}

/** 流式计算原片摘要，既支持大视频，也不把电脑路径写进公开索引。 */
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** 读取真实媒体流、旋转与时长，不用扩展名猜测视频编码。 */
async function probe(path) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { maxBuffer: 4 * 1024 * 1024 });
  const info = JSON.parse(stdout);
  const video = info.streams?.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  if (!video?.width || !video?.height) throw new Error(`未找到可用画面：${path}`);
  return { video, duration: Number(info.format?.duration ?? video.duration), hasAudio: info.streams.some((stream) => stream.codec_type === 'audio') };
}

/** 生成安全的目录片段，拒绝路径穿越和不受控的城市 ID。 */
function safeId(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) throw new Error(`${label} 不是有效 ID`);
  return value;
}

/** 每一层都拒绝符号链接，避免展示文件意外写到项目目录之外。 */
async function ensureSafePath(project, relativePath) {
  let path = project;
  for (const part of relativePath.split('/')) {
    path = join(path, part);
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`拒绝向符号链接写入：${path}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}

/** 校验日期必须真实且明确；未知日期应留给 AI 与用户确认。 */
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`拍摄日期无效或未知：${value ?? '缺失'}`);
  return value;
}

/** 先完成全批次只读校验，任一错误都不会提前改写项目。 */
async function preflight(project, plan, catalog) {
  if (!Array.isArray(plan.items) || !plan.items.length) throw new Error('计划需要非空 items 数组');
  const topology = JSON.parse(await readFile(join(project, 'public/data/world.topo.json'), 'utf8'));
  const geography = new Map(topology.objects.regions.geometries.map((item) => [item.properties.id, item.properties]));
  const hashes = new Map();
  for (const media of catalog.media) {
    if (!media.src.startsWith('/media/') || media.src.split('/').includes('..')) throw new Error(`现有素材路径无效：${media.id}`);
    const source = join(project, 'public', media.src.slice(1));
    if (!(await stat(source)).isFile()) throw new Error(`现有展示文件缺失：${media.id}`);
    hashes.set(media.sourceHash ?? await hashFile(source), media.id);
  }
  const ready = [], skipped = [];
  for (const item of plan.items) {
    if (!isAbsolute(item.source ?? '')) throw new Error('source 必须是原片绝对路径');
    if (!(await stat(item.source)).isFile()) throw new Error(`原片不是普通文件：${item.source}`);
    if (!['photo', 'video'].includes(item.type)) throw new Error(`素材类型必须为 photo 或 video：${item.source}`);
    if ((item.type === 'photo') !== photoExtensions.has(extname(item.source).toLowerCase())) throw new Error(`类型与已支持的原片扩展名不一致：${item.source}`);
    const regionId = safeId(item.regionId, 'regionId');
    const region = geography.get(regionId);
    if (!region) throw new Error(`地图中不存在地区：${regionId}`);
    safeId(region.countryId, 'countryId');
    validDate(item.date);
    if (typeof item.title !== 'string' || !item.title.trim()) throw new Error(`缺少素材标题：${item.source}`);
    if (typeof item.credit !== 'string' || !item.credit.trim()) throw new Error(`缺少素材署名：${item.source}`);
    if (item.city) {
      safeId(item.city.id, 'city.id');
      if (typeof item.city.name !== 'string' || !item.city.name.trim()) throw new Error('city.name 不能为空');
      const existing = catalog.regions.find((entry) => entry.id === regionId)?.cities.find((city) => city.id === item.city.id);
      if (existing && existing.name !== item.city.name) throw new Error(`同一城市 ID 对应不同名称：${item.city.id}`);
      const pending = ready.find((entry) => entry.regionId === regionId && entry.city?.id === item.city.id);
      if (pending && pending.city.name !== item.city.name) throw new Error(`计划内城市名称冲突：${item.city.id}`);
    }
    const sourceHash = await hashFile(item.source);
    if (hashes.has(sourceHash)) { skipped.push({ source: item.source, reason: 'exact-duplicate', existingId: hashes.get(sourceHash) }); continue; }
    const info = await probe(item.source);
    if (item.type === 'video' && !(info.duration > 0)) throw new Error(`视频时长无效：${item.source}`);
    const id = `import-${sourceHash.slice(0, 16)}`;
    if (catalog.media.some((media) => media.id === id)) throw new Error(`媒体 ID 已被其他素材占用：${id}`);
    const base = `/media/albums/${region.countryId}/${regionId}/${item.city?.id ?? '_region'}/${item.type === 'photo' ? 'photos' : 'videos'}`;
    const src = `${base}/${id}.${item.type === 'photo' ? 'jpg' : 'mp4'}`;
    const thumbnail = `/media/thumbs/${regionId}/${item.city?.id ?? '_region'}/${id}.jpg`;
    for (const url of [src, thumbnail]) {
      const target = await ensureSafePath(project, `public${url}`);
      try { await lstat(target); throw new Error(`目标文件已存在，拒绝覆盖：${url}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    hashes.set(sourceHash, id);
    ready.push({ ...item, id, regionId, region, sourceHash, src, thumbnail, info });
  }
  return { ready, skipped };
}

/** 转换展示副本，自动处理旋转，保留视频长度和第一条音轨。 */
async function convert(item, temporaryDirectory) {
  if (await hashFile(item.source) !== item.sourceHash) throw new Error(`预检后原片发生变化：${item.source}`);
  const output = join(temporaryDirectory, `${item.id}${extname(item.src)}`);
  const thumbnail = join(temporaryDirectory, `${item.id}-thumb.jpg`);
  const scale = (size, even = false) => `scale=w='min(${size},iw)':h='min(${size},ih)':force_original_aspect_ratio=decrease${even ? ':force_divisible_by=2' : ''}`;
  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', item.source];
  if (item.type === 'photo') {
    await exec('ffmpeg', [...common, '-map', '0:v:0', '-frames:v', '1', '-vf', scale(2400), '-map_metadata', '-1', '-c:v', 'mjpeg', '-q:v', '2', output]);
  } else {
    await exec('ffmpeg', [...common, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', scale(1920, true), '-map_metadata', '-1', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output]);
  }
  const result = await probe(output);
  if (item.type === 'video') {
    if (item.info.hasAudio && !result.hasAudio) throw new Error(`视频音轨丢失：${item.source}`);
    if (Math.abs(result.duration - item.info.duration) > 0.5) throw new Error(`视频时长发生异常变化：${item.source}`);
  }
  const seek = item.type === 'video' ? ['-ss', String(Math.min(1, result.duration / 2))] : [];
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...seek, '-i', output, '-frames:v', '1', '-vf', scale(480), '-q:v', '3', thumbnail]);
  return { output, thumbnail, result };
}

/** 根据新增素材更新目录与统计来源，不触碰无关相册。 */
function register(catalog, item, result) {
  let region = catalog.regions.find((entry) => entry.id === item.regionId);
  if (!region) {
    region = { id: item.regionId, name: item.region.name, country: item.region.countryName, englishName: `${item.regionId}, ${item.region.countryId}`, description: `${item.region.name}旅行`, period: '', cover: item.thumbnail, cities: [] };
    catalog.regions.push(region);
  }
  if (item.city && !region.cities.some((city) => city.id === item.city.id)) region.cities.push(item.city);
  catalog.media.push({ id: item.id, regionId: item.regionId, ...(item.city ? { cityId: item.city.id } : {}), type: item.type, title: item.title, date: item.date, src: item.src, thumbnail: item.thumbnail, width: result.video.width, height: result.video.height, ...(item.type === 'video' ? { duration: Math.round(result.duration) } : {}), credit: item.credit, ...(item.creditUrl ? { creditUrl: item.creditUrl } : {}), ...(item.licenseUrl ? { licenseUrl: item.licenseUrl } : {}), sourceHash: item.sourceHash });
  const dates = catalog.media.filter((media) => media.regionId === region.id).map((media) => media.date).sort();
  region.period = dates[0] === dates.at(-1) ? dates[0].replaceAll('-', '.') : `${dates[0].replaceAll('-', '.')} — ${dates.at(-1).replaceAll('-', '.')}`;
}

/** 先完成整批转换，复制成功后最后原子替换索引；失败回收本次新建的展示文件。 */
async function main() {
  const options = argumentsOf(process.argv.slice(2));
  const project = resolve(options.project);
  const catalogPath = await ensureSafePath(project, 'src/data/travels.json');
  const original = await readFile(catalogPath, 'utf8');
  const catalog = JSON.parse(original);
  const plan = JSON.parse(await readFile(resolve(options.plan), 'utf8'));
  const { ready, skipped } = await preflight(project, plan, catalog);
  if (!options.apply || !ready.length) {
    console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', imported: 0, planned: ready.map(({ source, regionId, city, type, src, thumbnail }) => ({ source, regionId, city, type, src, thumbnail })), skipped }, null, 2));
    return;
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'travel-globe-import-'));
  const created = [];
  const temporaryCatalog = `${catalogPath}.${process.pid}.tmp`;
  try {
    const outputs = [];
    for (const item of ready) outputs.push(await convert(item, temporaryDirectory));
    if (await readFile(catalogPath, 'utf8') !== original) throw new Error('索引被其他程序修改，停止本次导入');
    for (let i = 0; i < ready.length; i++) {
      const item = ready[i], output = outputs[i];
      for (const [file, url] of [[output.output, item.src], [output.thumbnail, item.thumbnail]]) {
        const target = await ensureSafePath(project, `public${url}`);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(file, target, constants.COPYFILE_EXCL);
        created.push(target);
      }
      register(catalog, item, output.result);
    }
    if (await readFile(catalogPath, 'utf8') !== original) throw new Error('索引被其他程序修改，停止本次导入');
    await writeFile(temporaryCatalog, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    await rename(temporaryCatalog, catalogPath);
    console.log(JSON.stringify({ mode: 'apply', imported: ready.length, ids: ready.map((item) => item.id), skipped }, null, 2));
  } catch (error) {
    for (const path of created) await unlink(path).catch(() => {});
    await unlink(temporaryCatalog).catch(() => {});
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

// 失败保留原片，退出码供 AI 判断，不能把失败项当作已导入。
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
