import { useState } from 'react';
import { ImageOff, RotateCw } from 'lucide-react';

interface Props {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  onLoad?: () => void;
}

/** 图片失败时保留卡片尺寸，并允许只重试当前资源。 */
export default function MediaImage({ src, alt, className = '', eager = false, onLoad }: Props) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <span className={`media-image ${className} ${failed ? 'has-error' : ''}`}>
    {failed ? <span className="image-error">
      <ImageOff size={22} aria-hidden="true" /><span>照片暂时走丢了</span>
      <span role="button" tabIndex={0} className="image-retry" onClick={(event) => {
        event.stopPropagation(); setAttempt((value) => value + 1); setFailed(false);
      }} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); setAttempt((value) => value + 1); setFailed(false);
        }
      }}><RotateCw size={12} />重新加载</span>
    </span> : <img src={`${src}${attempt ? `?retry=${attempt}` : ''}`} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onLoad={onLoad} onError={() => setFailed(true)} />}
  </span>;
}
