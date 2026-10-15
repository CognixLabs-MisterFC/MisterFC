import Image from 'next/image';

/**
 * Logo de la web comercial: el icono de la app y «MisterFC» en texto (decisión 13 de
 * la spec). No hay fichero de logo; el icono es una copia a 192 px de
 * `apps/native/assets/icon.png`. El nombre es marca: no se traduce.
 */
export function WebLogo({
  className = '',
  tone = 'light',
}: {
  className?: string;
  /** `dark`: sobre fondo azul marino (pie). */
  tone?: 'light' | 'dark';
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src="/web/misterfc-icono.png"
        alt=""
        width={36}
        height={36}
        className="rounded-lg"
        priority
      />
      <span
        className={`text-xl font-bold tracking-tight ${tone === 'dark' ? 'text-white' : 'text-misterfc-navy'}`}
      >
        MisterFC
      </span>
    </span>
  );
}
