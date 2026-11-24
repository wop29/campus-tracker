// Plain <img> for the static art in public/art. Fixed width and height so nothing shifts while it loads.
// Pass alt="" for decorative pictures; they are then hidden from screen readers too.
import { cn } from '@/lib/utils';

export function ArtImg({ src, alt, size, priority, className, style }: { src: string; alt: string; size: number; priority?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static transparent art, already sized; no optimizer needed
    <img src={src} alt={alt} aria-hidden={alt === '' || undefined} width={size} height={size} loading={priority ? 'eager' : 'lazy'} decoding="async" draggable={false}
      className={cn('shrink-0 select-none object-contain', className)} style={{ width: size, height: size, ...style }} />
  );
}
