import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { Heart, PawPrint } from 'lucide-react';

type PetId = 'cat' | 'dog';
interface Position { x: number; y: number }
interface Playground { width: number; height: number; size: number }
type Positions = Record<PetId, Position>;
interface DragGesture {
  pet: PetId;
  pointerId: number;
  target: HTMLButtonElement;
  offset: Position;
  start: Position;
  moved: boolean;
}

const pets = [
  { id: 'cat', name: '小橘', image: '/illustrations/travel-cat.png', greeting: '喵～带我去找狗狗', reaction: '喵呜～摸摸好开心！' },
  { id: 'dog', name: '小汪', image: '/illustrations/travel-dog.png', greeting: '汪！猫猫在哪儿？', reaction: '汪！今天也喜欢你！' },
] as const;

/** 角色始终留在主画面内，上方给对话气泡留出空间。 */
function keepInPlayground(position: Position, playground: Playground): Position {
  return {
    x: Math.max(8, Math.min(position.x, Math.max(8, playground.width - playground.size - 8))),
    y: Math.max(44, Math.min(position.y, Math.max(44, playground.height - playground.size - 24))),
  };
}

/** 用角色中心距离判断是否能碰面，不把仅沿对角线擦过误判成靠近。 */
function arePetsClose(positions: Positions, size: number) {
  return Math.hypot(positions.cat.x - positions.dog.x, positions.cat.y - positions.dog.y) < size * 1.02;
}

/** 两个旅伴独立拖动、待机和回应抚摸；松手靠近时自动并排蹭蹭。 */
export default function TravelCompanions({ hidden }: { hidden: boolean }) {
  const playground = useRef<HTMLDivElement>(null);
  const dimensions = useRef<Playground>({ width: 0, height: 0, size: 128 });
  const positionRef = useRef<Positions>({ cat: { x: 0, y: 0 }, dog: { x: 0, y: 0 } });
  const gesture = useRef<DragGesture | null>(null);
  const reactionTimer = useRef(0);
  const [layout, setLayout] = useState(dimensions.current);
  const [positions, setPositions] = useState(positionRef.current);
  const [dragging, setDragging] = useState<PetId | null>(null);
  const [excited, setExcited] = useState<PetId | null>(null);
  const close = arePetsClose(positions, layout.size);
  const together = layout.width > 0 && !hidden && !dragging && close;

  /** 同步引用与界面，松手时能读到最后一个指针位置。 */
  function movePets(next: Positions) {
    positionRef.current = next;
    setPositions(next);
  }

  // 布局变化只按比例调整已放置的位置，不把旅伴送回初始地点。
  useEffect(() => {
    const element = playground.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const previous = dimensions.current;
      const size = width < 768 ? 96 : Math.min(160, Math.max(118, width * 0.105));
      const next = { width, height, size };
      const homeY = height * (width < 768 ? 0.84 : 0.82) - size;
      const initial: Positions = {
        cat: { x: width < 768 ? width * 0.2 - size / 2 : width - size * 2.75 - 24, y: homeY },
        dog: { x: width < 768 ? width * 0.8 - size / 2 : width - size - 24, y: homeY },
      };
      const updated = { ...positionRef.current };
      for (const pet of pets) {
        const current = positionRef.current[pet.id];
        updated[pet.id] = keepInPlayground(previous.width
          ? { x: current.x / previous.width * width, y: current.y / previous.height * height }
          : initial[pet.id], next);
      }
      dimensions.current = next;
      setLayout(next);
      movePets(updated);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 打开相册时结束指针捕获；关闭相册仍保留两个旅伴的位置。
  useEffect(() => {
    if (!hidden) return;
    const active = gesture.current;
    gesture.current = null;
    if (active?.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    setDragging(null);
    setExcited(null);
    window.clearTimeout(reactionTimer.current);
  }, [hidden]);

  // 卸载时不保留任何延迟的抚摸状态更新。
  useEffect(() => () => window.clearTimeout(reactionTimer.current), []);

  /** 点击、轻触或键盘激活时，让单个旅伴跳一下并回应。 */
  function greetPet(pet: PetId) {
    window.clearTimeout(reactionTimer.current);
    setExcited(pet);
    reactionTimer.current = window.setTimeout(() => setExcited(null), 1700);
  }

  /** 仅角色按钮捕获拖动，单指触控不会传递给底下的地球。 */
  function startDrag(event: PointerEvent<HTMLButtonElement>, pet: PetId) {
    event.stopPropagation();
    if (event.button !== 0 || gesture.current) return;
    event.preventDefault();
    const bounds = playground.current?.getBoundingClientRect();
    if (!bounds) return;
    const position = positionRef.current[pet];
    gesture.current = {
      pet, pointerId: event.pointerId, target: event.currentTarget,
      offset: { x: event.clientX - bounds.left - position.x, y: event.clientY - bounds.top - position.y },
      start: { ...position }, moved: false,
    };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(pet);
    setExcited(null);
  }

  /** 拖动位置以主画面为坐标系，保持按下时的抓取位置不跳动。 */
  function dragPet(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const bounds = playground.current?.getBoundingClientRect();
    if (!bounds) return;
    const next = keepInPlayground({ x: event.clientX - bounds.left - active.offset.x, y: event.clientY - bounds.top - active.offset.y }, dimensions.current);
    if (Math.hypot(next.x - active.start.x, next.y - active.start.y) > 5) active.moved = true;
    movePets({ ...positionRef.current, [active.pet]: next });
  }

  /** 近距离松手后并排对齐，避免把两个角色完全叠在一起。 */
  function bringPetsTogether() {
    const board = dimensions.current;
    const current = positionRef.current;
    const separation = board.size * 0.72;
    const halfWidth = (board.size + separation) / 2;
    const middle = Math.max(halfWidth + 8, Math.min((current.cat.x + current.dog.x + board.size) / 2, board.width - halfWidth - 8));
    const y = keepInPlayground({ x: 0, y: (current.cat.y + current.dog.y) / 2 }, board).y;
    const catOnLeft = current.cat.x <= current.dog.x;
    const left = middle - halfWidth;
    movePets({
      cat: { x: catOnLeft ? left : left + separation, y },
      dog: { x: catOnLeft ? left + separation : left, y },
    });
  }

  /** 松手、触控取消与捕获丢失共用清理，避免角色停在拖动状态。 */
  function endDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    event.stopPropagation();
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    setDragging(null);
    if (cancelled) return;
    if (arePetsClose(positionRef.current, dimensions.current.size)) bringPetsTogether();
    else if (!active.moved) greetPet(active.pet);
  }

  /** 方向键同样能挪动角色；Escape 撤销当前拖动。 */
  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, pet: PetId) {
    if (event.key === 'Escape' && gesture.current) {
      event.stopPropagation(); event.preventDefault();
      const active = gesture.current;
      gesture.current = null;
      movePets({ ...positionRef.current, [active.pet]: active.start });
      if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
      setDragging(null);
      return;
    }
    const directions: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const direction = directions[event.key];
    if (!direction) return;
    event.stopPropagation(); event.preventDefault();
    const step = event.shiftKey ? 32 : 12;
    const current = positionRef.current[pet];
    movePets({ ...positionRef.current, [pet]: keepInPlayground({ x: current.x + direction.x * step, y: current.y + direction.y * step }, dimensions.current) });
  }

  /** 键盘和辅助技术产生的点击也会回应，拖动后的合成点击只阻止冒泡。 */
  function handleClick(event: MouseEvent<HTMLButtonElement>, pet: PetId) {
    event.stopPropagation();
    if (event.detail === 0) greetPet(pet);
  }

  return <div ref={playground} className={`companion-playground ${hidden ? 'is-hidden' : ''} ${together ? 'are-together' : ''}`} inert={hidden} aria-hidden={hidden}
    style={{ '--pet-size': `${layout.size}px`, visibility: layout.width ? undefined : 'hidden' } as CSSProperties}>
    <span id="companion-instructions" className="visually-hidden">拖动猫狗可以移动位置，放到一起会互动。也可用方向键移动，按住 Shift 加快，按 Enter 或空格抚摸。</span>
    {pets.map((pet) => {
      const position = positions[pet.id];
      const other = positions[pet.id === 'cat' ? 'dog' : 'cat'];
      const toward = position.x <= other.x ? 1 : -1;
      const facing = together && (pet.id === 'cat' ? toward < 0 : toward > 0) ? -1 : 1;
      const speech = dragging === pet.id ? (close ? '松手，让我们碰个头 ♡' : '去找我的好朋友！') : excited === pet.id ? pet.reaction : pet.greeting;
      return <button key={pet.id} type="button" className={`pet-character pet-${pet.id} ${dragging === pet.id ? 'is-dragging' : ''} ${excited === pet.id ? 'is-excited' : ''}`}
        style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)`, '--toward': toward, '--facing': facing,
          '--speech-left': `${Math.max(88, Math.min(position.x + layout.size / 2, layout.width - 88)) - position.x}px` } as CSSProperties}
        aria-label={`${pet.name}，${pet.id === 'cat' ? '猫猫' : '狗狗'}旅行伙伴`} aria-describedby="companion-instructions" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space"
        onPointerDown={(event) => startDrag(event, pet.id)} onPointerMove={dragPet} onPointerUp={(event) => endDrag(event)}
        onPointerCancel={(event) => endDrag(event, true)} onLostPointerCapture={(event) => endDrag(event, true)}
        onKeyDown={(event) => moveWithKeyboard(event, pet.id)} onClick={(event) => handleClick(event, pet.id)} onDragStart={(event) => event.preventDefault()}>
        <span className="pet-shadow" aria-hidden="true" />
        <span className="pet-art"><span className="pet-facing"><img src={pet.image} alt="" width={1254} height={1254} draggable={false} decoding="async" /></span></span>
        {!together && <span className="pet-speech" aria-hidden="true">{speech}</span>}
        <span className="pet-label" aria-hidden="true"><PawPrint size={11} />{pet.name}<span>· 拖动我</span></span>
      </button>;
    })}
    {together && <div className="companion-bond" aria-hidden="true" style={{ left: (positions.cat.x + positions.dog.x + layout.size) / 2, top: Math.max(82, Math.min(positions.cat.y, positions.dog.y) + layout.size * 0.12) }}>
      <span className="companion-dialogue">喵呜～汪！一起出发 ♡</span>
      <Heart className="companion-heart heart-one" size={18} /><Heart className="companion-heart heart-two" size={24} /><Heart className="companion-heart heart-three" size={15} />
    </div>}
    <span className="visually-hidden" role="status" aria-live="polite">{together ? '小橘和小汪碰面了，正在开心地蹭蹭。' : excited ? `${pets.find((pet) => pet.id === excited)?.name}开心地跳了起来。` : ''}</span>
  </div>;
}
