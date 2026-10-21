import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const catalog = JSON.parse(await readFile('src/data/travels.json', 'utf8'));
await mkdir('public/media/thumbs', { recursive: true });

/** 只下载缺失资源，失败时保留可重试的明确错误。 */
async function download(url, target) {
  try { if ((await stat(target)).size > 1000) return; } catch { /* 文件不存在时继续下载。 */ }
  await exec('curl', ['-L', '--fail', '--silent', '--show-error', '--retry', '2', '--max-time', '120', url, '-o', target]);
}

/** 大图和小图独立存储，首屏不会加载原尺寸照片。 */
async function prepare(item) {
  const target = `public${item.src}`;
  const thumbnail = `public${item.thumbnail}`;
  if (item.type === 'photo') {
    await download(item.sourceUrl, target);
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', target, '-vf', 'scale=480:-2', '-q:v', '3', thumbnail]);
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', target]);
    const info = JSON.parse(stdout);
    item.width = info.streams[0].width;
    item.height = info.streams[0].height;
  } else {
    const input = join(tmpdir(), item.sourceUrl.includes('flower') ? 'travel-ball-flower.mp4' : 'travel-ball-waves.webm');
    await download(item.sourceUrl, input);
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(item.sourceStart ?? 0), '-i', input, '-t', '8', '-vf', 'scale=960:-2', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target]);
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', target, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', thumbnail]);
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', target]);
    const info = JSON.parse(stdout);
    item.duration = Math.round(Number(info.format.duration));
    item.width = info.streams[0].width;
    item.height = info.streams[0].height;
  }
  console.log(`已准备 ${item.id}`);
}

// 小批并发避免资源下载挤占本地网络；视频顺序处理以复用源文件。
const photos = catalog.media.filter((item) => item.type === 'photo');
const failures = [];
for (let i = 0; i < photos.length; i += 4) {
  const batch = photos.slice(i, i + 4);
  const results = await Promise.allSettled(batch.map(prepare));
  results.forEach((result, index) => {
    if (result.status === 'rejected') failures.push(`${batch[index].id}: ${result.reason.message}`);
  });
}
for (const item of catalog.media.filter((entry) => entry.type === 'video')) await prepare(item);
await writeFile('src/data/travels.json', `${JSON.stringify(catalog, null, 2)}\n`);
if (failures.length) throw new Error(failures.join('\n'));
