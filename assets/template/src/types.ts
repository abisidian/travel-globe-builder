import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';

/** 地图区划与相册使用同一稳定 ID 关联，不依赖显示名称。 */
export interface RegionProperties {
  id: string;
  name: string;
  countryId: string;
  countryName: string;
  center: [number, number];
  color: number;
  level: 'province' | 'country';
}

export type RegionFeature = Feature<Polygon | MultiPolygon, RegionProperties>;
export type WorldTopology = Topology<{ regions: GeometryCollection<RegionProperties> }>;
export type MediaType = 'photo' | 'video';

/** 城市只负责相册分类，不增加地图上的行政区层级。 */
export interface City {
  id: string;
  name: string;
}

/** 图片与视频明确分型，视频额外包含封面和时长。 */
export interface MediaItem {
  id: string;
  regionId: string;
  cityId?: string;
  type: MediaType;
  title: string;
  date: string;
  src: string;
  thumbnail: string;
  width: number;
  height: number;
  duration?: number;
  /** 原片内容摘要只用于重复导入识别，不记录原片绝对路径。 */
  sourceHash?: string;
  credit: string;
  creditUrl?: string;
  licenseUrl?: string;
}

export interface TravelRegion {
  id: string;
  name: string;
  country: string;
  englishName: string;
  description: string;
  cover: string;
  period: string;
  cities: City[];
}

export interface MediaCounts {
  photos: number;
  videos: number;
  total: number;
}
