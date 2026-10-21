import { MeshPhongMaterial } from 'three';

/** 海洋使用纯色立体材质；地图填色与边界由矢量层绘制，近景不再放大低分辨率贴图。 */
export function createGlobeMaterial() {
  return new MeshPhongMaterial({ color: '#93c4c4', shininess: 0, specular: '#66846b' });
}
