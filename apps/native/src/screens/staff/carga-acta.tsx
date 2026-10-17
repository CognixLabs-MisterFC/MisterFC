import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  addMatchEventFromClient,
  eventScopedCacheKey,
  getLineupForEventFromClient,
  getMatchDetailFromClient,
  prepareMatchSheetFromClient,
  reconsolidateMatchFromClient,
  userCanRecordMatchFromClient,
  type ClockWriteError,
  type LineupRosterPlayer,
  type MatchDetail,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { EventForm, type AddEventInput } from '@/directo/event-form';
import { editErrorKeyFor } from '@/directo/event-edit-sheet';
import { uuidv4 } from '@/lib/uuid';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { KeyboardScrollView } from '@/ui/keyboard';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * CARGAR EL PARTIDO ENTERO, con el acta delante.
 *
 * El caso real, y es el que manda en todo lo que sigue: un entrenador SOLO con el
 * equipo que no puede apuntar nada durante el partido y lo mete todo de corrido al
 * acabar. Minuto, tipo, jugador, siguiente — sin abrir y cerrar un diálogo por
 * evento. Es la misma superficie que web estrenó en F14H (`QuickEntryClient`), con
 * su misma cabecera: «el entrenador está SOLO con el equipo».
 *
 * TRES COSAS LA DISTINGUEN del alta suelta, y las tres están aquí a propósito:
 *
 *  1. PREPARAR EL ACTA. Un partido que nunca se abrió en el directo no tiene reloj, y
 *     sin periodos no hay minuto al que anclar un evento: el alta moriría con
 *     `no_period`. `prepareMatchSheetFromClient` congela el once de la alineación
 *     oficial, siembra los periodos QUE JUEGA LA CATEGORÍA y deja el partido cerrado.
 *     Sin alineación oficial no hace nada y lo dice: no se inventa un once.
 *
 *  2. EL FORMULARIO NO SE CIERRA. Conserva tipo, bando y minuto entre envíos; el
 *     minuto propuesto es el ÚLTIMO metido, que es como se lee un acta: de arriba
 *     abajo. Eso lo decide esta pantalla, no el formulario — el alta suelta arranca en
 *     el minuto de la fila que se estaba mirando, y el componente es el mismo.
 *
 *  3. UNA SOLA RE-CONSOLIDACIÓN. Cada alta va con `reconsolidate: false`. Con el
 *     partido cerrado, re-materializar stats y marcador en cada evento son N pasadas
 *     completas (releer todo y delete+reinsert) para cargar veinticinco: aquí se hace
 *     UNA al terminar. El botón de salir es el que la dispara, y además se dispara al
 *     abandonar la pantalla — la operación es idempotente, así que repetirla no duele
 *     y olvidarla sí: dejaría el acta con los minutos sin cuadrar.
 *
 * SOLO CON RED, como la corrección: estas altas leen el reloj en el servidor y no se
 * encolan. Cuando el entrenador se sienta a meter el partido está en el vestuario o en
 * casa, no en la banda.
 */
type CargaData = {
  detail: MatchDetail;
  canRecord: boolean;
  roster: LineupRosterPlayer[];
  hasOfficialLineup: boolean;
};

function prepareErrorKey(e: ClockWriteError): string {
  if (e === 'no_official_lineup') return 'partido_directo.quick.needs_official_lineup';
  if (e === 'forbidden') return 'directo_control.err_forbidden';
  return 'directo_edit.errors.generic';
}

export function CargaActaScreen({ eventId }: { eventId: string | null }) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const online = useIsOnline();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading, refresh } = useCached<CargaData | null>(
    eventScopedCacheKey('carga-acta', eventId ?? 'none'),
    async (sb) => {
      if (!eventId || !clubId) return null;
      const detail = await getMatchDetailFromClient(sb, clubId, eventId);
      if (!detail) return null;
      const canRecord = await userCanRecordMatchFromClient(sb, eventId);
      const lineup = await getLineupForEventFromClient(sb, { clubId, eventId });
      return {
        detail,
        canRecord,
        roster: lineup?.roster ?? [],
        hasOfficialLineup: !!lineup?.isOfficial,
      };
    },
  );

  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [metidos, setMetidos] = useState(0);

  // Lo que queda por consolidar, en un ref para que la salida lo vea sin re-suscribir
  // el efecto en cada alta (y sin dispararlo al desmontar sin haber metido nada).
  const pendientes = useRef(0);

  const consolidar = async () => {
    if (!eventId || pendientes.current === 0) return;
    pendientes.current = 0;
    await reconsolidateMatchFromClient(supabase, eventId);
    invalidateAfterWrite('matchState');
  };

  // RED DE ABAJO de la re-consolidación única: si el entrenador sale por donde sea
  // —atrás del sistema, otra pestaña— se consolida igual. Idempotente, así que
  // coincidir con el botón no hace daño; olvidarlo sí.
  useEffect(() => {
    return () => {
      void consolidar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (loading && !data) return <LoadingScreen />;
  const detail = data?.detail ?? null;
  if (!eventId || !detail) {
    return <EmptyState message={t('directo_control.unavailable')} />;
  }

  const canRecord = !!data?.canRecord;
  const roster = data?.roster ?? [];
  const eventos = detail.events;
  const necesitaPreparar = detail.status === 'not_started' || detail.periods.length === 0;
  const puedeEscribir = canRecord && online && !busy;

  // El minuto que propone: el ÚLTIMO metido. Así se lee un acta, de arriba abajo.
  const ultimoMinuto = eventos.length
    ? Math.max(...eventos.map((e) => e.displayMinute ?? Math.floor(e.clockSeconds / 60)))
    : 0;

  const preparar = async () => {
    setBusy(true);
    setErrorKey(null);
    const r = await prepareMatchSheetFromClient(supabase, { event_id: eventId });
    setBusy(false);
    if (!r.ok) {
      setErrorKey(prepareErrorKey(r.error));
      return;
    }
    invalidateAfterWrite('matchState');
    await refresh();
  };

  const añadir = async (input: AddEventInput) => {
    setBusy(true);
    setErrorKey(null);
    const r = await addMatchEventFromClient(
      supabase,
      { ...input, event_id: eventId, id: uuidv4() },
      // La clave de la cadena: nada de re-consolidar por evento.
      { reconsolidate: false },
    );
    setBusy(false);
    if (!r.ok) {
      setErrorKey(editErrorKeyFor(r.error));
      return;
    }
    pendientes.current += 1;
    setMetidos((n) => n + 1);
    await refresh();
  };

  const salir = async () => {
    setBusy(true);
    await consolidar();
    setBusy(false);
    router.replace({ pathname: '/staff/directo', params: { eventId } });
  };

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <KeyboardScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('partido_directo.quick.title')}</ScreenTitle>

        {!canRecord ? <Banner text={t('directo_control.no_permission')} /> : null}
        {canRecord && !online ? <Banner text={t('directo_edit.offline')} /> : null}
        {errorKey ? (
          <View className="rounded-xl bg-red-50 px-4 py-2">
            <Text className="text-center text-xs text-red-600">{t(errorKey)}</Text>
          </View>
        ) : null}

        {necesitaPreparar ? (
          <View className="rounded-2xl border border-zinc-200 p-4" style={{ gap: 10 }}>
            <Text className="text-sm font-semibold text-[#0F1B2E]">
              {t('partido_directo.quick.prepare_title')}
            </Text>
            <Text className="text-xs text-zinc-500">
              {t('partido_directo.quick.prepare_explain')}
            </Text>
            {data?.hasOfficialLineup === false ? (
              <Banner text={t('partido_directo.quick.needs_official_lineup')} />
            ) : (
              <Pressable
                disabled={!puedeEscribir}
                onPress={() => void preparar()}
                className="self-start rounded-full px-4 py-2 active:opacity-70"
                style={{ backgroundColor: accent, opacity: puedeEscribir ? 1 : 0.4 }}
              >
                <Text className="text-sm font-semibold text-white">
                  {t('partido_directo.quick.prepare_cta')}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View className="rounded-2xl border border-zinc-200 p-4" style={{ gap: 12 }}>
              <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t('partido_directo.quick.add_title')}
              </Text>
              <Text className="text-xs text-zinc-400">{t('partido_directo.quick.chain_hint')}</Text>
              <EventForm
                key={metidos}
                roster={roster}
                minutoInicial={ultimoMinuto}
                accent={accent}
                disabled={!puedeEscribir}
                onSubmit={(input) => void añadir(input)}
              />
            </View>

            {/* El acta a la vista: lo ya metido, en orden, como se lee. */}
            <View className="rounded-2xl border border-zinc-200 p-4">
              <Text className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {`${t('partido_directo.timeline.title')} ${t('partido_directo.timeline.count', { n: String(eventos.length) })}`}
              </Text>
              {eventos.length === 0 ? (
                <Text className="py-4 text-center text-sm text-zinc-400">
                  {t('partido_directo.timeline.empty')}
                </Text>
              ) : (
                [...eventos]
                  .sort((a, b) => a.clockSeconds - b.clockSeconds)
                  .map((e) => (
                    <View
                      key={e.id}
                      className="flex-row items-center gap-3 border-b border-zinc-100 py-2"
                    >
                      <Text className="w-8 text-right text-sm text-zinc-400 tabular-nums">
                        {`${e.displayMinute ?? Math.floor(e.clockSeconds / 60)}'`}
                      </Text>
                      <Text className="text-sm font-medium text-[#0F1B2E]">
                        {t(`directo.event.${e.type}`)}
                      </Text>
                      <Text className="flex-1 text-sm text-zinc-500" numberOfLines={1}>
                        {e.side === 'rival' ? `${t('directo.event.rival')} ${e.label}` : e.label}
                      </Text>
                    </View>
                  ))
              )}
            </View>

            <Pressable
              onPress={() => void salir()}
              disabled={busy}
              className="self-start rounded-full border px-4 py-2 active:opacity-70"
              style={{ borderColor: accent, opacity: busy ? 0.4 : 1 }}
            >
              <Text className="text-sm font-semibold" style={{ color: accent }}>
                {t('partido_directo.quick.back_to_live')}
              </Text>
            </Pressable>
          </>
        )}
      </KeyboardScrollView>
    </View>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View className="rounded-xl bg-amber-50 px-4 py-2">
      <Text className="text-center text-xs text-amber-700">{text}</Text>
    </View>
  );
}
