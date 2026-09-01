/**
 * Marcador "Sin app": la familia de este jugador NO ha entrado en la app, así que
 * NO recibe convocatorias ni avisos. Círculo rojo + texto (no un icono ambiguo).
 *
 * UN SOLO marcador (decisión Jose): antes eran dos ("Invitación pendiente" vs "Sin
 * invitar") y el segundo mentía a quien no puede leer `invitations` — ver
 * `packages/core/src/players/family-link.ts`.
 *
 * Presentacional puro: recibe las cadenas ya traducidas (los call sites usan
 * getTranslations('jugadores')) y lo pinta QUIEN decide que hay que pintarlo (no
 * hay estado que interpretar). Vive en `components/` porque lo usan varias rutas:
 * plantilla y ficha de jugador, detalle de equipo y detalle de convocatoria.
 * NUNCA en las pantallas deportivas (alineación, pase de lista, directo,
 * estadísticas) ni en las de FAMILIA: ahí no aporta y la RLS no da el dato.
 */
export function NoAppBadge({
  label,
  hint,
  showHint = true,
}: {
  label: string;
  hint: string;
  showHint?: boolean;
}) {
  return (
    <span className="mt-0.5 flex flex-col gap-0.5">
      <span
        title={hint}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-600 dark:text-red-400"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
        {label}
      </span>
      {showHint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </span>
  );
}
