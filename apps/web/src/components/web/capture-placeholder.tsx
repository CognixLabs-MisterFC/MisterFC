/**
 * Hueco con marco para una captura que aún no existe (spec §9.4, «igual que en NIDO»).
 * Lleva el marco del dispositivo para que la maqueta ya tenga su forma; cuando llegue la
 * captura se sustituye el interior por la imagen.
 *
 * `id` es el código de la lista de capturas (C1, M1…): sale en pequeño para saber qué
 * captura va en cada sitio.
 */
export function CapturePlaceholder({
  device,
  id,
  name,
  pendingLabel,
  className = '',
}: {
  device: 'laptop' | 'phone';
  id: string;
  name: string;
  pendingLabel: string;
  className?: string;
}) {
  const inner = (
    <div
      role="img"
      aria-label={`${pendingLabel}: ${name}`}
      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-zinc-50 p-3 text-center"
    >
      <span
        className={`font-semibold uppercase tracking-wide text-zinc-400 ${device === 'phone' ? 'text-[9px]' : 'text-xs'}`}
      >
        {pendingLabel}
      </span>
      <span
        className={`font-medium text-zinc-600 ${device === 'phone' ? 'text-[11px] leading-tight' : 'text-sm'}`}
      >
        {name}
      </span>
      <span className="text-[10px] text-zinc-400">{id}</span>
    </div>
  );

  if (device === 'phone') {
    return (
      <div
        className={`aspect-[9/19.5] overflow-hidden rounded-[2rem] border-[6px] border-misterfc-navy bg-misterfc-navy shadow-xl ${className}`}
      >
        <div className="h-full w-full overflow-hidden rounded-[1.5rem]">{inner}</div>
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-t-xl border-[6px] border-b-0 border-misterfc-navy bg-misterfc-navy shadow-xl">
        <div className="aspect-[16/10] overflow-hidden rounded-t-md">{inner}</div>
      </div>
      <div className="mx-auto h-3 w-[108%] -translate-x-[3.7%] rounded-b-xl bg-zinc-300" />
    </div>
  );
}
