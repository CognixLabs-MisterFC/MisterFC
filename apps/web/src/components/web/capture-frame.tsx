import Image from 'next/image';
import { CaptureZoom, type CaptureZoomLabels } from './capture-zoom';
import { CAPTURES, type CaptureId } from './captures';

/**
 * Una captura dentro de su marco de dispositivo (spec §9.4): portátil o móvil.
 *
 * Las capturas web con versión a 390×844 (`mobile`) se enseñan, en pantallas pequeñas,
 * en un marco de móvil con esa versión: la de escritorio dentro de un portátil de 300 px
 * no se lee. `adaptive={false}` lo apaga (el hero, que ya pone un móvil al lado).
 *
 * `sizes` es lo que ocupa el marco en la página; con él `next/image` sirve el tamaño
 * justo en vez del original. Al hacer clic se amplía (`CaptureZoom`) con el fichero
 * original de la versión que se está viendo.
 */
export function CaptureFrame({
  device,
  id,
  name,
  zoom,
  className = '',
  sizes,
  priority = false,
  adaptive = true,
}: {
  device: 'laptop' | 'phone';
  id: CaptureId;
  name: string;
  zoom: CaptureZoomLabels;
  className?: string;
  sizes?: string;
  priority?: boolean;
  adaptive?: boolean;
}) {
  const cap = CAPTURES[id];

  const fill = (src: string, fit: 'cover' | 'contain', s: string) => (
    <Image
      src={src}
      alt={name}
      fill
      sizes={s}
      priority={priority}
      className={fit === 'cover' ? 'object-cover object-top' : 'object-contain'}
    />
  );

  const phone = (
    file: { src: string; width: number; height: number; fit: 'cover' | 'contain' },
    extra: string,
    s: string,
  ) => (
    <CaptureZoom
      src={file.src}
      width={file.width}
      height={file.height}
      name={name}
      labels={zoom}
      className={extra}
    >
      <div className="aspect-[9/19.5] overflow-hidden rounded-[2rem] border-[6px] border-misterfc-navy bg-misterfc-navy shadow-xl">
        <div className="relative h-full w-full overflow-hidden rounded-[1.5rem] bg-white">
          {fill(file.src, file.fit, s)}
        </div>
      </div>
    </CaptureZoom>
  );

  if (device === 'phone') return phone(cap, className, sizes ?? '200px');

  const laptop = (
    <CaptureZoom
      src={cap.src}
      width={cap.width}
      height={cap.height}
      name={name}
      labels={zoom}
      iconClassName="bottom-6 right-3"
    >
      <div className="overflow-hidden rounded-t-xl border-[6px] border-b-0 border-misterfc-navy bg-misterfc-navy shadow-xl">
        <div className="relative aspect-[16/10] overflow-hidden rounded-t-md bg-white">
          {fill(cap.src, cap.fit, sizes ?? '(min-width: 1024px) 560px, 90vw')}
        </div>
      </div>
      <div className="mx-auto h-3 w-[108%] -translate-x-[3.7%] rounded-b-xl bg-zinc-300" />
    </CaptureZoom>
  );

  if (!adaptive || !cap.mobile) return <div className={className}>{laptop}</div>;

  return (
    <div className={className}>
      <div className="sm:hidden">
        {phone(cap.mobile, 'mx-auto w-[40%] min-w-[7rem] max-w-[11rem]', '180px')}
      </div>
      <div className="hidden sm:block">{laptop}</div>
    </div>
  );
}
