/** 全球陆地的静态矢量数据；国家序号用于运行时根据相册计算高亮颜色。 */
export interface LandData {
  positions: Float32Array;
  normals: Float32Array;
  regionIndices: Float32Array;
  indices: Uint32Array;
  countryCount: number;
}

const magic = 0x54424c31;

/** 读取连续二进制数组，省去浏览器中的球面三角剖分和大量临时对象。 */
export function decodeLandData(buffer: ArrayBuffer): LandData {
  const header = new Uint32Array(buffer, 0, 4);
  const [, vertices, indices, countryCount] = header;
  if (header[0] !== magic || buffer.byteLength !== 16 + vertices * 28 + indices * 4) throw new Error('地图几何资源无效');
  return {
    positions: new Float32Array(buffer, 16, vertices * 3),
    normals: new Float32Array(buffer, 16 + vertices * 12, vertices * 3),
    regionIndices: new Float32Array(buffer, 16 + vertices * 24, vertices),
    indices: new Uint32Array(buffer, 16 + vertices * 28, indices),
    countryCount,
  };
}

/** 预处理时将顶点、法线、国家序号和索引写成紧凑静态资源。 */
export function encodeLandData(data: LandData): ArrayBuffer {
  const vertices = data.positions.length / 3;
  const buffer = new ArrayBuffer(16 + vertices * 28 + data.indices.length * 4);
  new Uint32Array(buffer, 0, 4).set([magic, vertices, data.indices.length, data.countryCount]);
  new Float32Array(buffer, 16, vertices * 3).set(data.positions);
  new Float32Array(buffer, 16 + vertices * 12, vertices * 3).set(data.normals);
  new Float32Array(buffer, 16 + vertices * 24, vertices).set(data.regionIndices);
  new Uint32Array(buffer, 16 + vertices * 28, data.indices.length).set(data.indices);
  return buffer;
}
