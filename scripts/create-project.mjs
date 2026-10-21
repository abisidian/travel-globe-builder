import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 读取少量明确参数，不隐式覆盖项目或安装全局依赖。 */
function parseArgs(args) {
  const result = { empty: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--empty') result.empty = true;
    else if (['--dest', '--name'].includes(args[i]) && args[i + 1]) result[args[i++].slice(2)] = args[i];
    else throw new Error(`未知或缺少值的参数：${args[i]}`);
  }
  if (!result.dest) throw new Error('用法：node create-project.mjs --dest <新项目目录> [--name travel-album] [--empty]');
  return result;
}

/** 从随 Skill 携带的模板生成项目，拒绝非空目录与模板内部路径。 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const destination = resolve(options.dest);
  if (destination === skill || destination.startsWith(`${skill}${sep}`)) throw new Error('目标目录不能位于 Skill 内部');
  const name = options.name ?? basename(destination);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('项目名称需为小写字母、数字或连字符；中文目录请指定 --name');
  let existing;
  try { existing = await readdir(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing?.length) throw new Error('目标目录非空，已停止，未覆盖任何文件');
  await mkdir(destination, { recursive: true });
  await cp(resolve(skill, 'assets/template'), destination, { recursive: true, force: false, errorOnExist: true });
  // 项目名与锁文件同步，首次 npm ci 不需要重新解析版本。
  for (const file of ['package.json', 'package-lock.json']) {
    const path = resolve(destination, file);
    const data = JSON.parse(await readFile(path, 'utf8'));
    data.name = name;
    if (data.packages?.['']) data.packages[''].name = name;
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  if (options.empty) {
    await writeFile(resolve(destination, 'src/data/travels.json'), '{"regions": [], "media": []}\n');
    // 仅清理刚刚复制进新目录的示例媒体，地图、字体及插画仍随项目保留。
    await rm(resolve(destination, 'public/media'), { recursive: true });
    await mkdir(resolve(destination, 'public/media'), { recursive: true });
  }
  console.log(JSON.stringify({ project: destination, name, mode: options.empty ? 'empty' : 'demo', next: ['npm ci', 'npm run dev'], checks: ['npm run typecheck', 'npm run check:data', 'npm run build'] }, null, 2));
}

// 命令失败时明确退出，避免把部分复制误报为项目已完成。
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
