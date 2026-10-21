import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshPhongMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import ConicPolygonGeometry from 'three-conic-polygon-geometry';
import type { RegionFeature } from '../types';
import { regionColor } from './world';
import type { LandData } from './land-data';

/** 静态陆地合并为一个带顶点颜色的矢量网格，减少岛屿产生的绘制调用。 */
export function createLandMesh(regions: RegionFeature[], radius: number, altitude: number, visitedCountries: Set<string>) {
  const pieces = [];
  for (const [regionIndex, region] of regions.entries()) {
    const polygons = region.geometry.type === 'Polygon' ? [region.geometry.coordinates] : region.geometry.coordinates;
    const color = new Color(regionColor(region, region.properties.level === 'country' && visitedCountries.has(region.properties.id)));
    for (const coordinates of polygons) {
      const geometry = new ConicPolygonGeometry(coordinates, 0, radius * (1 + altitude), false, true, false, 1);
      const count = geometry.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let index = 0; index < colors.length; index += 3) {
        colors[index] = color.r; colors[index + 1] = color.g; colors[index + 2] = color.b;
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geometry.setAttribute('regionIndex', new Float32BufferAttribute(new Float32Array(count).fill(regionIndex), 1));
      pieces.push(geometry);
    }
  }
  const geometry = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  return new Mesh(geometry, new MeshPhongMaterial({ vertexColors: true, shininess: 0 }));
}

/** 全球陆地直接复用预生成顶点；高亮仍由当前媒体数据计算，不烘焙进静态文件。 */
export function createPreparedLandMesh(data: LandData, regions: RegionFeature[], radius: number, visitedCountries: Set<string>) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  const palette = regions.map((region) => new Color(regionColor(region, visitedCountries.has(region.properties.id))));
  const colors = new Float32Array(data.positions.length);
  for (let index = 0; index < data.regionIndices.length; index++) {
    const color = palette[data.regionIndices[index]];
    colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const mesh = new Mesh(geometry, new MeshPhongMaterial({ vertexColors: true, shininess: 0 }));
  // 预生成坐标使用单位球体，同一资源可直接适配地球的实际半径。
  mesh.scale.setScalar(radius);
  return mesh;
}
