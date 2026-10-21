import data from './travels.json';
import type { MediaCounts, MediaItem, MediaType, TravelRegion } from '../types';

export const travelRegions: TravelRegion[] = data.regions;
export const mediaItems: MediaItem[] = data.media as MediaItem[];

/** 地球、面板和统计共用一次聚合结果，避免高亮与数量不一致。 */
export function countMedia(items: MediaItem[]): MediaCounts {
  const photos = items.filter((item) => item.type === 'photo').length;
  return { photos, videos: items.length - photos, total: items.length };
}

export const regionMedia = new Map(travelRegions.map((region) => [
  region.id, mediaItems.filter((item) => item.regionId === region.id),
]));
export const regionCounts = new Map([...regionMedia].map(([id, items]) => [id, countMedia(items)]));
export const totalCounts = countMedia(mediaItems);

/** 城市标签与类型页签共同决定预览的切换范围。 */
export function filterMedia(regionId: string, cityId: string, type: MediaType) {
  return (regionMedia.get(regionId) ?? []).filter((item) =>
    item.type === type && (cityId === 'all' || item.cityId === cityId),
  );
}

/** 用同一格式呈现视频时长和播放器预览索引。 */
export function formatDuration(seconds = 0) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.round(seconds % 60).toString().padStart(2, '0')}`;
}
