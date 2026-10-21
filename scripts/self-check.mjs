import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 执行真实脚本并读取 JSON 结果，失败时保留错误上下文。 */
async function invoke(script, args) {
  const { stdout } = await exec(process.execPath, [join(skill, 'scripts', script), ...args], { maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/** 预期无效输入必须失败，避免回归为覆盖已有数据。 */
async function mustFail(script, args, message) {
  await assert.rejects(() => invoke(script, args), message);
}

/** 对临时原片计算内容摘要，验证导入前后没有修改。 */
async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** 在独立临时目录验证生成、预检、音轨/旋转、去重与无效输入，不接触浏览器。 */
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'travel-globe-skill-check-'));
  const project = join(directory, 'personal-album');
  const demo = join(directory, 'demo-album');
  const originals = join(directory, 'originals');
  await mkdir(originals);
  try {
    await invoke('create-project.mjs', ['--dest', demo]);
    const demoCatalog = JSON.parse(await readFile(join(demo, 'src/data/travels.json'), 'utf8'));
    assert.equal(demoCatalog.media.length, 23);
    await invoke('create-project.mjs', ['--dest', project, '--empty']);
    const emptyText = await readFile(join(project, 'src/data/travels.json'), 'utf8');
    assert.deepEqual(JSON.parse(emptyText), { regions: [], media: [] });
    await mustFail('create-project.mjs', ['--dest', project], '非空项目必须拒绝覆盖');

    // 测试照片保持小尺寸；同内容不同名称也必须识别为重复。
    const photo = join(originals, 'photo.jpg'), duplicate = join(originals, 'same-content.jpg');
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=120x80', '-frames:v', '1', photo]);
    await copyFile(photo, duplicate);
    // 制造带声音、含 90 度旋转标记的真实短视频，核验导入后方向与音轨。
    const landscape = join(originals, 'landscape.mp4'), portrait = join(originals, 'portrait.mov');
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=1.2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', landscape]);
    await exec('ffmpeg', ['-v', 'error', '-display_rotation', '90', '-i', landscape, '-c', 'copy', portrait]);
    const rotationProbe = await exec('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', portrait]);
    assert(JSON.parse(rotationProbe.stdout).streams.some((stream) => stream.side_data_list?.some((data) => Math.abs(data.rotation) === 90)), '测试原片必须实际带有旋转信息');
    const before = await Promise.all([photo, duplicate, portrait].map(digest));
    const items = [
      { source: photo, regionId: 'CN-YN', city: { id: 'dali', name: '大理' }, type: 'photo', date: '2025-10-01', title: '测试照片', credit: '临时测试素材' },
      { source: portrait, regionId: 'US-CA', type: 'video', date: '2025-10-02', title: '测试视频', credit: '临时测试素材' },
      { source: duplicate, regionId: 'CN-YN', city: { id: 'dali', name: '大理' }, type: 'photo', date: '2025-10-01', title: '重复照片', credit: '临时测试素材' },
    ];
    const plan = join(directory, 'plan.json');
    await writeFile(plan, JSON.stringify({ items }));
    const args = ['--project', project, '--plan', plan];
    const preview = await invoke('import-media.mjs', args);
    assert.equal(preview.planned.length, 2);
    assert.equal(preview.skipped.length, 1);
    assert.equal(await readFile(join(project, 'src/data/travels.json'), 'utf8'), emptyText, '预检不能改写索引');
    const applied = await invoke('import-media.mjs', [...args, '--apply']);
    assert.equal(applied.imported, 2);
    const catalog = JSON.parse(await readFile(join(project, 'src/data/travels.json'), 'utf8'));
    assert.equal(catalog.media.length, 2);
    assert.equal(catalog.regions.length, 2);
    assert.deepEqual(catalog.regions.find((r) => r.id === 'US-CA').cities, []);
    const image = catalog.media.find((m) => m.type === 'photo');
    assert.equal(image.cityId, 'dali');
    assert.equal(image.width, 120);
    assert.equal(image.height, 80);
    const video = catalog.media.find((m) => m.type === 'video');
    assert.equal(video.width, 180);
    assert.equal(video.height, 320);
    assert.equal(video.cityId, undefined);
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(project, 'public', video.src.slice(1))]);
    const streams = JSON.parse(stdout).streams;
    assert(streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'));
    assert(streams.some((stream) => stream.codec_name === 'h264'));
    for (const media of catalog.media) {
      assert((await readFile(join(project, 'public', media.thumbnail.slice(1)))).length > 0);
      assert(!JSON.stringify(media).includes(originals), '公开索引不能包含原片路径');
    }
    const stable = await readFile(join(project, 'src/data/travels.json'), 'utf8');
    const repeated = await invoke('import-media.mjs', [...args, '--apply']);
    assert.equal(repeated.imported, 0);
    assert.equal(repeated.skipped.length, 3);
    assert.equal(await readFile(join(project, 'src/data/travels.json'), 'utf8'), stable);

    // 未知地区和无效日期均应全批拒绝，不能在报错前导入前面的文件。
    const invalid = join(directory, 'invalid.json');
    await writeFile(invalid, JSON.stringify({ items: [items[0], { ...items[1], regionId: 'UNKNOWN' }] }));
    await mustFail('import-media.mjs', ['--project', project, '--plan', invalid, '--apply'], '未知地区必须失败');
    await writeFile(invalid, JSON.stringify({ items: [{ ...items[0], date: '2025-02-30' }] }));
    await mustFail('import-media.mjs', ['--project', project, '--plan', invalid, '--apply'], '不存在的拍摄日期必须失败');
    assert.equal(await readFile(join(project, 'src/data/travels.json'), 'utf8'), stable);
    assert.deepEqual(await Promise.all([photo, duplicate, portrait].map(digest)), before);
    // 插入标准 EXIF Orientation=6，验证手机照片按画面方向输出且尺寸同步。
    const exifPhoto = join(originals, 'exif-photo.jpg');
    const jpeg = await readFile(photo);
    const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex');
    const marker = Buffer.from([0xff, 0xe1, 0, exif.length + 2]);
    await writeFile(exifPhoto, Buffer.concat([jpeg.subarray(0, 2), marker, exif, jpeg.subarray(2)]));
    const exifHash = await digest(exifPhoto);
    await writeFile(invalid, JSON.stringify({ items: [{ ...items[0], source: exifPhoto, title: 'EXIF方向测试' }] }));
    await invoke('import-media.mjs', ['--project', project, '--plan', invalid, '--apply']);
    const exifMedia = JSON.parse(await readFile(join(project, 'src/data/travels.json'), 'utf8')).media.at(-1);
    assert.equal(exifMedia.width, 80);
    assert.equal(exifMedia.height, 120);
    assert.equal(await digest(exifPhoto), exifHash);
    console.log(JSON.stringify({ passed: true, checks: ['demo-generator', 'empty-generator', 'nonempty-target-protection', 'readonly-preview', 'photo-no-upscale', 'photo-exif-orientation', 'portrait-rotation', 'video-audio', 'city-and-no-city', 'independent-thumbnails', 'batch-dedup', 'repeat-import', 'unknown-region-rejection', 'invalid-date-rejection', 'originals-preserved'], directory, project, demo }, null, 2));
  } finally {
    if (!process.argv.includes('--keep')) await rm(directory, { recursive: true, force: true });
  }
}

// 测试失败保留清晰退出码，--keep 允许维护者继续检查生成项目。
main().catch((error) => { console.error(error); process.exitCode = 1; });
