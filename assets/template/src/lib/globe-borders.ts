import { geoDistance, geoInterpolate } from 'd3-geo';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { MultiLineString } from 'geojson';

type ProjectToGlobe = (lat: number, lng: number, altitude: number) => { x: number; y: number; z: number };

/** 国界合并成一个矢量线层，线宽使用屏幕像素，放大后仍清楚且不会变成粗色块。 */
export function createCountryBorders(borders: MultiLineString, project: ProjectToGlobe, province = false) {
  const positions: number[] = [];
  for (const line of borders.coordinates) {
    for (let index = 1; index < line.length; index++) {
      const start = line[index - 1] as [number, number];
      const end = line[index] as [number, number];
      const interpolate = geoInterpolate(start, end);
      // 按大圆弧补点，长边及跨日期变更线的边界都贴合球面。
      const steps = Math.max(1, Math.ceil(geoDistance(start, end) * 180 / Math.PI));
      let previous = project(start[1], start[0], 0.0024);
      for (let step = 1; step <= steps; step++) {
        const [lng, lat] = interpolate(step / steps);
        const current = project(lat, lng, 0.0024);
        positions.push(previous.x, previous.y, previous.z, current.x, current.y, current.z);
        previous = current;
      }
    }
  }
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({ color: province ? '#8a9272' : '#687451', linewidth: province ? 0.85 : 1.65, worldUnits: false, depthWrite: false });
  const lines = new LineSegments2(geometry, material);
  lines.name = province ? 'travel-province-borders' : 'travel-country-borders';
  return lines;
}
