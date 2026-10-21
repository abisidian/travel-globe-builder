import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryModule = join(tmpdir(), 'travel-ball-prepare-land.mjs');
try {
  // 复用应用中的同一份拓扑与球面几何算法，避免预处理和运行时边界不一致。
  await build({
    stdin: { contents: "export { parseWorld } from './src/lib/world'; export { createLandMesh } from './src/lib/globe-land'; export { encodeLandData } from './src/lib/land-data';", resolveDir: process.cwd() },
    bundle: true, outfile: temporaryModule, platform: 'node', format: 'esm',
  });
  // 几何库通过 window 查找可选的 Three 实例；离线生成不需要 DOM 或 WebGL。
  globalThis.window = {};
  const { parseWorld, createLandMesh, encodeLandData } = await import(pathToFileURL(temporaryModule).href);
  const topology = JSON.parse(await readFile('public/data/world.topo.json', 'utf8'));
  const world = parseWorld(topology);
  const mesh = createLandMesh(world.countries, 1, 0.001, new Set());
  const geometry = mesh.geometry;
  const buffer = encodeLandData({
    positions: geometry.getAttribute('position').array,
    normals: geometry.getAttribute('normal').array,
    regionIndices: geometry.getAttribute('regionIndex').array,
    indices: Uint32Array.from(geometry.index.array),
    countryCount: world.countries.length,
  });
  await writeFile('public/data/world-land.bin', Buffer.from(buffer));
  console.log(`全球陆地几何已准备：${world.countries.length} 个国家地区、${geometry.getAttribute('position').count} 个共享顶点，${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
  geometry.dispose(); mesh.material.dispose();
} finally {
  await rm(temporaryModule, { force: true });
}
