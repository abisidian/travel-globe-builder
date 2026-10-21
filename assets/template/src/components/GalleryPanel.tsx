import { useRef, useEffect } from 'react';
import { ArrowUpRight, Camera, ChevronLeft, Film, MapPin, Play, X } from 'lucide-react';
import type { MediaItem, MediaType, TravelRegion } from '../types';
import { countMedia, formatDuration, regionMedia } from '../data/catalog';
import MediaImage from './MediaImage';

interface Props {
  region: TravelRegion;
  cityId: string;
  type: MediaType;
  items: MediaItem[];
  onCityChange: (city: string) => void;
  onTypeChange: (type: MediaType) => void;
  onOpenMedia: (item: MediaItem) => void;
  onClose: () => void;
}

/** 相册面板保持挂载，全屏预览关闭后自然保留滚动与筛选状态。 */
export default function GalleryPanel({ region, cityId, type, items, onCityChange, onTypeChange, onOpenMedia, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const allItems = regionMedia.get(region.id) ?? [];
  const cityItems = cityId === 'all' ? allItems : allItems.filter((item) => item.cityId === cityId);
  const counts = countMedia(cityItems);
  const allCounts = countMedia(allItems);
  const hasCurrentType = type === 'photo' ? allCounts.photos > 0 : allCounts.videos > 0;
  const alternateType: MediaType = type === 'photo' ? 'video' : 'photo';

  /** 空分类先返回该省全部素材；整个省没有当前类型时，切到有内容的类型。 */
  function showAvailableMedia() {
    onCityChange('all');
    if (!hasCurrentType) onTypeChange(alternateType);
  }

  // 地区或筛选改变才回到顶部；预览开关不触发该逻辑。
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [region.id, cityId, type]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [region.id]);

  return <aside className="gallery-panel" aria-label={`${region.name}旅行相册`}>
    <div className="panel-handle" aria-hidden="true" />
    <div className="panel-topline"><span><MapPin size={13} />{region.country} / {region.name}</span><button className="icon-button" onClick={onClose} aria-label="收起相册"><X size={19} /></button></div>
    <header className="gallery-heading">
      <span className="eyebrow">{region.englishName}</span>
      <h2 ref={heading} tabIndex={-1}>{region.name}<span className="heading-dot">.</span></h2>
      <p>{region.description}</p>
      <span className="trip-date">{region.period}</span>
    </header>
    {region.cities.length > 0 && <div className="city-filters" aria-label="按城市筛选">
      <button className={cityId === 'all' ? 'active' : ''} aria-pressed={cityId === 'all'} onClick={() => onCityChange('all')}>全部</button>
      {region.cities.map((city) => <button key={city.id} className={cityId === city.id ? 'active' : ''} aria-pressed={cityId === city.id} onClick={() => onCityChange(city.id)}>{city.name}</button>)}
    </div>}
    <div className="media-tabs" role="tablist" aria-label="素材类型">
      <button role="tab" id="photos-tab" aria-selected={type === 'photo'} aria-controls="gallery-content" className={type === 'photo' ? 'active' : ''} onClick={() => onTypeChange('photo')}><Camera size={16} />照片<span>{counts.photos}</span></button>
      <button role="tab" id="videos-tab" aria-selected={type === 'video'} aria-controls="gallery-content" className={type === 'video' ? 'active' : ''} onClick={() => onTypeChange('video')}><Film size={16} />视频<span>{counts.videos}</span></button>
      <span className="tab-decoration">COLLECTED MOMENTS</span>
    </div>
    <div ref={scroller} id="gallery-content" className="gallery-scroll" role="tabpanel" aria-labelledby={type === 'photo' ? 'photos-tab' : 'videos-tab'}>
      {items.length > 0 ? <div className={`media-grid ${type === 'video' ? 'video-grid' : ''}`}>
        {items.map((item, index) => <button key={item.id} className={`media-card ${index % 5 === 2 ? 'tall' : ''}`} onClick={() => onOpenMedia(item)} aria-label={`${type === 'photo' ? '查看照片' : '播放视频'}：${item.title}`}>
          <span className="media-card-visual">
            <MediaImage src={item.thumbnail} alt={item.title} />
            {item.type === 'video' ? <><span className="video-play"><Play size={20} fill="currentColor" /></span><span className="duration">{formatDuration(item.duration)}</span></> : <span className="card-open"><ArrowUpRight size={17} /></span>}
          </span>
          <span className="media-caption"><span>{item.title}</span><span>{String(index + 1).padStart(2, '0')}</span></span>
        </button>)}
      </div> : <div className="gallery-empty">
        {type === 'photo' ? <Camera size={30} strokeWidth={1.2} /> : <Film size={30} strokeWidth={1.2} />}
        <h3>这一页，留给下一次旅行</h3><p>这里还没有{type === 'photo' ? '照片' : '视频'}，换个城市或类型看看。</p>
        <button onClick={showAvailableMedia}>{hasCurrentType ? `查看${region.name}全部${type === 'photo' ? '照片' : '视频'}` : `查看${alternateType === 'photo' ? '照片' : '视频'}`}<ArrowUpRight size={14} /></button>
      </div>}
      <div className="gallery-end"><span />每一帧，都是来过的证明<span /></div>
    </div>
    <button className="back-to-globe" onClick={onClose}><ChevronLeft size={15} />继续转转地球</button>
  </aside>;
}
