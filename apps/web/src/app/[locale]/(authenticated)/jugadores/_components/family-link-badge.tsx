import { Clock, UserX } from 'lucide-react';
import type { FamilyLinkStatus } from '@misterfc/core';

/**
 * Slice A — Marcador de jugador SIN familia vinculada. Dos estados visibles:
 *  - `invited`   → "Invitación pendiente" (correo enviado, familia sin entrar).
 *  - `uninvited` → "Sin invitar" (nunca se le mandó).
 * `linked` no pinta nada. Los dos marcados significan lo mismo por debajo: NO
 * recibe convocatorias ni avisos (por eso el `hint`, para que no sea ambiguo).
 *
 * Presentacional puro: recibe las cadenas ya traducidas (los call sites usan
 * getTranslations('jugadores')). El MAPEO estado→etiqueta vive aquí una sola vez.
 */
export function FamilyLinkBadge({
  status,
  labels,
  showHint = true,
}: {
  status: FamilyLinkStatus;
  labels: { invited: string; uninvited: string; hint: string };
  showHint?: boolean;
}) {
  if (status === 'linked') return null;
  const isInvited = status === 'invited';
  const Icon = isInvited ? Clock : UserX;
  const label = isInvited ? labels.invited : labels.uninvited;
  return (
    <span className="mt-0.5 flex flex-col gap-0.5">
      <span
        title={labels.hint}
        className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400"
      >
        <Icon className="size-3" aria-hidden />
        {label}
      </span>
      {showHint && (
        <span className="text-[10px] text-muted-foreground">{labels.hint}</span>
      )}
    </span>
  );
}
