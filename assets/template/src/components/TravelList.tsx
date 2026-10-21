import { ArrowUpRight, Camera, Film, MapPin, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { regionCounts, travelRegions } from '../data/catalog';
import MediaImage from './MediaImage';

interface Props { onSelect: (id: string) => void; onClose: () => void; fallback?: boolean }

/** 地区列表也是地球的键盘与无 WebGL 访问入口。 */
export default function TravelList({ onSelect, onClose, fallback = false }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <aside className={`travel-list gallery-panel ${fallback ? 'fallback-list' : ''}`} aria-label="我的旅行足迹">
    <div className="panel-handle" aria-hidden="true" />
    <div className="panel-topline"><span><MapPin size={13} />收集在路上的时光</span>{!fallback && <button className="icon-button" onClick={onClose} aria-label="收起旅行足迹"><X size={19} /></button>}</div>
    <header className="gallery-heading"><span className="eyebrow">PLACES I'VE BEEN</span><h2 ref={heading} tabIndex={-1}>我的足迹<span className="heading-dot">.</span></h2><p>{fallback ? '当前设备无法显示地球，依然可以从这里出发。' : '世界上的一些地方，已经成为回忆。'}</p></header>
    <div className="travel-list-scroll">
      {travelRegions.map((region, index) => {
        const counts = regionCounts.get(region.id)!;
        return <button className="destination-row" key={region.id} onClick={() => onSelect(region.id)}>
          <span className="destination-number">{String(index + 1).padStart(2, '0')}</span>
          <MediaImage src={region.cover} alt={`${region.name}旅行封面`} />
          <span className="destination-copy"><span className="destination-country">{region.country}</span><strong>{region.name}</strong><span className="destination-count"><Camera size={11} />{counts.photos}<Film size={11} />{counts.videos}</span></span><ArrowUpRight size={18} />
        </button>;
      })}
      <p className="list-note">更多地方，等着慢慢抵达。</p>
    </div>
  </aside>;
}
