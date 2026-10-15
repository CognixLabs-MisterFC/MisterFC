import Link from 'next/link';

/**
 * Botón «Solicitar una demo» de la web comercial. Verde con texto azul marino: en blanco
 * sobre #10B981 el contraste no llega a 4,5:1 (decisión de W2).
 */
export function DemoButton({
  locale,
  label,
  size = 'md',
}: {
  locale: string;
  label: string;
  size?: 'md' | 'lg';
}) {
  return (
    <Link
      href={`/${locale}/demo`}
      className={`inline-flex items-center justify-center rounded-lg bg-misterfc-green font-semibold text-misterfc-navy hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green-ink ${size === 'lg' ? 'px-6 py-3 text-base' : 'px-5 py-2.5 text-sm'}`}
    >
      {label}
    </Link>
  );
}
