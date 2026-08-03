import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  applyDrop,
  coachFormationToFormation,
  eventScopedCacheKey,
  exceedsStarters,
  formatPlayerNameNatural,
  formationsForFormat,
  getFormation,
  getLineupForEventFromClient,
  setLineupFormationFromClient,
  upsertLineupPositionFromClient,
  type DropTarget,
  type Formation,
  type LineupView,
  type PositionAssignment,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { LineupBoard, type DropTargetLite } from '@/ui/lineup-field';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/**
 * O2-8b — Alineación del partido (staff) con DRAG. Lee la alineación (core
 * `getLineupForEventFromClient`, read-only) y permite editarla arrastrando: colocar en
 * un slot / swap / mandar al banquillo. El estado es OPTIMISTA con `applyDrop` (core) y
 * se REVIERTE si el guardado falla; cada drop persiste incremental con
 * `upsertLineupPositionFromClient` (write RLS directa, sin route handler — editar no
 * dispara fan-out). WRITE-GUARD: sin red o sin permiso, el drag va deshabilitado (no se
 * arrastra y se avisa) — nunca se deja mover algo que no se guarda. GATE server-side
 * (`canManage`/RLS): un rechazo llega como `forbidden` y se maneja con gracia. Caché
 * event-scoped (`alineacion::${eventId}`), lectura offline como el resto.
 */

const ROLE_TO_SHORT: Record<string, string> = {
  GK: 'goalkeeper',
  DF: 'defender',
  MF: 'midfielder',
  FW: 'forward',
};

export function AlineacionScreen({ eventId }: { eventId: string | null }) {
  const { activeClub, theme } = useApp();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<LineupView | null>(
    eventScopedCacheKey('alineacion', eventId ?? 'none'),
    async (sb) => {
      if (!eventId || !clubId) return null;
      return getLineupForEventFromClient(sb, { clubId, eventId });
    },
  );

  // Estado local editable (semilla desde lo GUARDADO; se resiembra en cada fetch).
  const [positions, setPositions] = useState<PositionAssignment[]>([]);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<{ code: string | null; bench: boolean }>({
    code: null,
    bench: false,
  });
  const [busyFormation, setBusyFormation] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Semilla de estado desde lo GUARDADO: se REsemilla en cada fetch nuevo (identidad
  // de `data` cambia) — patrón "ajustar estado al cambiar una prop" de React, sin
  // setState-en-efecto (regla del React Compiler). Durante el drag no hay fetch, así
  // que el estado optimista se conserva; tras refrescar (cambio de formación) se
  // resemilla a lo guardado.
  const [seeded, setSeeded] = useState<LineupView | null>(null);
  if (data !== seeded) {
    setSeeded(data);
    setPositions(data?.positions ?? []);
    setErrorKey(null);
  }

  const lineupId = data?.lineupId ?? null;
  const format = data?.event.format ?? null;
  const canManage = !!data?.canManage;
  // WRITE-GUARD + GATE (cliente): editar exige permiso, red y una alineación existente.
  const editable = canManage && online && lineupId != null && !busyFormation;

  const formation: Formation | undefined = data?.formationCode
    ? (getFormation(data.formationCode) ??
      (data.coachFormation ? coachFormationToFormation(data.coachFormation) : undefined))
    : undefined;

  // Persiste los jugadores CAMBIADOS por un drop (orden = desplazado→banquillo primero,
  // luego el nuevo titular; core lo devuelve así para no chocar con el tope). Réplica
  // del `persist` de la web: revierte al estado previo ante cualquier error.
  const persist = useCallback(
    async (next: PositionAssignment[], changed: string[], prev: PositionAssignment[]) => {
      if (!lineupId) return;
      setErrorKey(null);
      setSavingIds(new Set(changed));
      for (const pid of changed) {
        const a = next.find((x) => x.playerId === pid);
        if (!a) continue;
        const r = await upsertLineupPositionFromClient(supabase, {
          lineup_id: lineupId,
          player_id: pid,
          location: a.location,
          position_code: a.positionCode,
          x_pct: a.xPct,
          y_pct: a.yPct,
        });
        if (!r.ok) {
          setPositions(prev); // revierte: la UI no muestra un movimiento no guardado
          setSavingIds(new Set());
          setErrorKey(
            r.error === 'too_many_starters'
              ? 'alineacion.field_full'
              : r.error === 'forbidden'
                ? 'alineacion.forbidden'
                : 'alineacion.save_error',
          );
          return;
        }
      }
      setSavingIds(new Set());
    },
    [lineupId],
  );

  const onDrop = useCallback(
    (playerId: string, target: DropTargetLite) => {
      if (!editable) return;
      const prev = positions;
      const { next, changed } = applyDrop(prev, { playerId, target: target as DropTarget }, formation);
      if (changed.length === 0) return;
      // Pre-chequeo del tope (como la web): no dejamos un optimista que el server
      // rechazaría por exceso de titulares.
      if (
        target.kind === 'field' &&
        format &&
        exceedsStarters(next.filter((p) => p.location === 'field').length, format)
      ) {
        setErrorKey('alineacion.field_full');
        return;
      }
      setPositions(next);
      void persist(next, changed, prev);
    },
    [editable, positions, formation, format, persist],
  );

  // Cambiar formación (escritura, write-guard): réplica de la web (Fix #8) — fija la
  // formación y VACÍA el campo (todos al banquillo) para que el coach coloque a mano.
  const onChangeFormation = useCallback(
    async (code: string) => {
      if (!editable || !lineupId || busyFormation) return;
      if (code === data?.formationCode) return;
      setBusyFormation(true);
      setErrorKey(null);
      const rf = await setLineupFormationFromClient(supabase, {
        lineup_id: lineupId,
        formation_code: code,
      });
      if (!rf.ok) {
        setBusyFormation(false);
        setErrorKey(rf.error === 'forbidden' ? 'alineacion.forbidden' : 'alineacion.save_error');
        return;
      }
      // Vacía el campo: cada titular actual → banquillo (net = campo vacío + code nuevo).
      for (const p of positions.filter((x) => x.location === 'field')) {
        const r = await upsertLineupPositionFromClient(supabase, {
          lineup_id: lineupId,
          player_id: p.playerId,
          location: 'bench',
        });
        if (!r.ok) {
          setBusyFormation(false);
          setErrorKey(r.error === 'forbidden' ? 'alineacion.forbidden' : 'alineacion.save_error');
          refresh();
          return;
        }
      }
      setBusyFormation(false);
      refresh(); // refleja lo GUARDADO
    },
    [editable, lineupId, busyFormation, data, positions, refresh],
  );

  if (!eventId) return <EmptyState message={t('alineacion.pick_match')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('alineacion.unavailable')} />;

  const rosterById = new Map(data.roster.map((r) => [r.playerId, r]));
  const labelOf = (pid: string): string => {
    const r = rosterById.get(pid);
    return r
      ? formatPlayerNameNatural(r.firstName, r.lastName) || pid.slice(0, 4)
      : pid.slice(0, 4);
  };
  const dorsalOf = (pid: string): number | null => rosterById.get(pid)?.dorsal ?? null;
  const slotLabelOf = (_code: string, role: string): string =>
    t(`alineacion.pos_short.${ROLE_TO_SHORT[role] ?? 'midfielder'}`);

  const formationLabel =
    (data.formationCode && getFormation(data.formationCode)?.label) ??
    data.coachFormation?.name ??
    data.formationCode ??
    '—';

  const catalog = format ? formationsForFormat(format) : [];
  const e = data.event;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('alineacion.title')}</ScreenTitle>

        {/* Cabecera del partido + formación. */}
        <View className="rounded-2xl border border-zinc-200 p-4">
          <View className="flex-row items-center gap-2">
            <View className="h-4 w-4 rounded-full" style={{ backgroundColor: e.teamColor }} />
            <Text className="flex-1 text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
              {e.title}
              {e.opponentName ? ` · ${e.opponentName}` : ''}
            </Text>
          </View>
          <Text className="mt-1 text-xs text-zinc-400" numberOfLines={1}>
            {[new Date(e.startsAt).toLocaleString(), e.teamName, e.categoryName]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View className="mt-2 flex-row items-center gap-2">
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: accent }}>
              <Text className="text-[11px] font-semibold text-white">{formationLabel}</Text>
            </View>
            {data.lineupName ? (
              <Text className="text-xs text-zinc-500" numberOfLines={1}>
                {data.lineupName}
                {data.isOfficial ? ` · ${t('alineacion.official')}` : ''}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Aviso de gate/write-guard. */}
        {lineupId != null && !canManage ? (
          <Banner text={t('alineacion.no_permission')} />
        ) : lineupId != null && !online ? (
          <Banner text={t('alineacion.offline_write')} />
        ) : null}
        {errorKey ? (
          <View className="rounded-xl bg-red-50 px-4 py-2">
            <Text className="text-center text-xs text-red-600">{t(errorKey)}</Text>
          </View>
        ) : null}

        {data.lineupId == null ? (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm text-zinc-500">{t('alineacion.none_yet')}</Text>
          </View>
        ) : (
          <>
            {/* Selector de formación (escritura; deshabilitado sin permiso/red). */}
            {catalog.length > 0 ? (
              <View>
                <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  {t('alineacion.formation')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingRight: 8 }}
                >
                  {catalog.map((f) => {
                    const on = f.code === data.formationCode;
                    return (
                      <Pressable
                        key={f.code}
                        disabled={!editable || on}
                        onPress={() => onChangeFormation(f.code)}
                        className="rounded-full px-3 py-1.5 active:opacity-70"
                        style={{
                          backgroundColor: on ? accent : undefined,
                          borderWidth: on ? 0 : 1,
                          borderColor: '#e4e4e7',
                          opacity: !editable && !on ? 0.5 : 1,
                        }}
                      >
                        <Text
                          className={
                            on ? 'text-xs font-semibold text-white' : 'text-xs text-zinc-600'
                          }
                        >
                          {f.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {/* Tablero: campo + banquillo, con drag. */}
            <LineupBoard
              formation={formation}
              positions={positions}
              labelOf={labelOf}
              dorsalOf={dorsalOf}
              slotLabelOf={slotLabelOf}
              editable={editable}
              savingIds={savingIds}
              chipColor={accent}
              benchTitle={t('alineacion.bench')}
              benchEmptyText={t('alineacion.bench_empty')}
              onDrop={onDrop}
              hoverCode={hover.code}
              hoverBench={hover.bench}
              onHoverChange={setHover}
            />

            <Text className="text-center text-[11px] text-zinc-400">
              {editable ? t('alineacion.edit_hint') : t('alineacion.readonly_hint')}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View className="rounded-xl bg-zinc-100 px-4 py-2">
      <Text className="text-center text-xs text-zinc-500">{text}</Text>
    </View>
  );
}
