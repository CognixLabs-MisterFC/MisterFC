import { getTranslations } from 'next-intl/server';

/**
 * Baja de miembros (4c) — banner informativo del dead-end de /onboarding para un usuario
 * que quedó SIN club por una baja. Análogo al `RemovedBanner` nativo (misma clave
 * `membership_removed`). Web solo tiene la variante genérica (no hay onboarding de
 * seguidor). NUNCA muestra la razón: la RPC ni la devuelve.
 */
type RemovedItem = {
  club_id: string;
  club_name: string;
  left_at: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha de baja como DD/MM/AAAA (determinista, igual que en la app). */
function formatLeftAt(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export async function RemovedMembershipBanner({ items }: { items: RemovedItem[] }) {
  const t = await getTranslations('membership_removed');

  return (
    <div className="flex w-full flex-col gap-3">
      {items.map((m) => (
        <div
          key={m.club_id}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left"
        >
          <p className="text-sm font-semibold text-amber-900">
            {t('title', { club: m.club_name })}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {t('body', { club: m.club_name, date: formatLeftAt(m.left_at) })}
          </p>
        </div>
      ))}
    </div>
  );
}
