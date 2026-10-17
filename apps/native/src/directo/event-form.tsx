import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  CORNER_SIDES,
  FOUL_KINDS,
  PENALTY_OUTCOMES,
  TIMELINE_ADD_TYPES,
  type LineupRosterPlayer,
} from '@misterfc/core';
import { useTranslations } from '@/locale/provider';
import { ActorGrid, rosterChip } from './quick-entry';

/**
 * EL FORMULARIO DE ALTA de un evento del acta, con los DIEZ tipos que se dan de alta
 * a mano. Es la pieza que comparten las dos superficies, igual que en web
 * (`AddEventForm` lo usan el editor de timeline y la entrada rápida):
 *
 *   · un alta SUELTA, desde la hoja de corrección de un evento;
 *   · la carga EN CADENA de un partido entero (pieza siguiente).
 *
 * Por eso NO decide nada que dependa de la superficie: el minuto inicial, si se cierra
 * al enviar y qué se hace con el resultado los pone quien lo monta. Si lo decidiera
 * aquí, la segunda superficie tendría que pelearse con él.
 *
 * LAS REGLAS DE UI SON EL ESPEJO DE `addTimelineEventSchema`, y están escritas aquí
 * solo como «qué campos se muestran». La verdad la tiene el esquema, y la fila la
 * construye `buildTimelineEventRow` en core: si alguna de las dos se desvía, lo que
 * manda es core y el usuario ve un error, no una fila mal hecha.
 *
 *   · falta y córner son SIEMPRE nuestras → no se pregunta el bando;
 *   · la asistencia es siempre propia;
 *   · córner, fuera de juego y tiro propios van por ubicación → sin jugador;
 *   · la sustitución pide los DOS jugadores (sale y entra);
 *   · penalti pide resultado, falta pide tipo, córner pide lado.
 *
 * Los DOCE tipos de la tabla menos dos: el cambio de formación no es un evento con
 * actor y la tanda tiene su propia secuencia. Los dos quedan fuera a propósito, como
 * en web (`TIMELINE_ADD_TYPES`).
 *
 * Cadenas: TODAS existían ya en el catálogo compartido (`partido_directo.*`), que la
 * app importa entero y hasta hoy no usaba. Cero cadenas nuevas.
 */
export type AddEventInput = {
  side: 'own' | 'rival';
  type: string;
  display_minute: number;
  player_id?: string;
  related_player_id?: string;
  rival_dorsal?: number;
  outcome?: string;
  foul_kind?: string;
  corner_side?: string;
};

export function EventForm({
  roster,
  minutoInicial,
  accent,
  disabled,
  onSubmit,
}: {
  roster: LineupRosterPlayer[];
  /** Lo pone la superficie: el minuto del evento que se mira, o el último metido. */
  minutoInicial: number;
  accent: string;
  disabled: boolean;
  onSubmit: (input: AddEventInput) => void;
}) {
  const t = useTranslations('');
  const [type, setType] = useState<string>('goal');
  const [side, setSide] = useState<'own' | 'rival'>('own');
  const [minuto, setMinuto] = useState(String(minutoInicial));
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerInId, setPlayerInId] = useState<string | null>(null);
  const [dorsal, setDorsal] = useState('');
  const [outcome, setOutcome] = useState<string>('scored');
  const [foulKind, setFoulKind] = useState<string>('committed');
  const [cornerSide, setCornerSide] = useState<string>('for');

  const esSub = type === 'substitution';
  const deEquipo = type === 'foul' || type === 'corner';
  const bandoOculto = deEquipo || esSub || type === 'assist';
  const bando: 'own' | 'rival' = bandoOculto ? 'own' : side;
  const porUbicacion = type === 'offside' || type === 'shot' || type === 'corner';
  const pideJugador = bando === 'own' && !porUbicacion;
  const pideDorsal = bando === 'rival';

  const listo =
    (!pideJugador || playerId != null) &&
    (!esSub || (playerId != null && playerInId != null && playerId !== playerInId)) &&
    (!pideDorsal || /^[1-9][0-9]?$/.test(dorsal));

  const enviar = () => {
    const n = Number.parseInt(minuto, 10);
    if (!Number.isInteger(n) || n < 0 || n > 130 || !listo) return;
    onSubmit({
      side: bando,
      type,
      display_minute: n,
      player_id: pideJugador ? (playerId ?? undefined) : undefined,
      related_player_id: esSub ? (playerInId ?? undefined) : undefined,
      rival_dorsal: pideDorsal ? Number.parseInt(dorsal, 10) : undefined,
      outcome: type === 'penalty' ? outcome : undefined,
      foul_kind: type === 'foul' ? foulKind : undefined,
      corner_side: type === 'corner' ? cornerSide : undefined,
    });
    // Lo que NO se resetea es a propósito: tipo, bando y minuto se conservan, que es
    // lo que hace llevadera la carga en cadena (mismo tipo, minuto que avanza).
    setPlayerId(null);
    setPlayerInId(null);
    setDorsal('');
  };

  const chip = (activo: boolean) => ({
    borderWidth: 1.5,
    borderColor: activo ? accent : '#e4e4e7',
    backgroundColor: activo ? `${accent}14` : undefined,
    opacity: disabled ? 0.4 : 1,
  });

  return (
    <View style={{ gap: 12 }}>
      {/* ── Tipo (los diez) ── */}
      <View style={{ gap: 6 }}>
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {t('partido_directo.timeline.field_type')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {TIMELINE_ADD_TYPES.map((ty) => (
            <Pressable
              key={ty}
              disabled={disabled}
              onPress={() => setType(ty)}
              className="rounded-xl px-3 py-2 active:opacity-70"
              style={chip(type === ty)}
            >
              <Text className="text-sm font-medium text-[#0F1B2E]">
                {t(`partido_directo.event.${ty}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── Bando, solo cuando hay elección ── */}
      {bandoOculto ? null : (
        <View style={{ gap: 6 }}>
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {t('partido_directo.timeline.field_side')}
          </Text>
          <View className="flex-row gap-2">
            {(['own', 'rival'] as const).map((s) => (
              <Pressable
                key={s}
                disabled={disabled}
                onPress={() => setSide(s)}
                className="rounded-xl px-3 py-2 active:opacity-70"
                style={chip(bando === s)}
              >
                <Text className="text-sm text-[#0F1B2E]">
                  {t(`partido_directo.timeline.side_${s === 'own' ? 'own' : 'rival'}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* ── Minuto ── */}
      <View style={{ gap: 6 }}>
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {t('partido_directo.timeline.field_minute')}
        </Text>
        <TextInput
          value={minuto}
          onChangeText={setMinuto}
          editable={!disabled}
          keyboardType="number-pad"
          maxLength={3}
          className="w-20 rounded-xl border border-zinc-200 px-3 py-2 text-center text-sm"
          style={{ opacity: disabled ? 0.4 : 1 }}
        />
      </View>

      {/* ── Actor ── */}
      {pideJugador ? (
        <ActorGrid
          title={t(
            esSub
              ? 'partido_directo.timeline.field_player_out'
              : 'partido_directo.timeline.field_player',
          )}
          players={roster
            .map((r) => rosterChip(r, t))
            .map((c) => ({ ...c, label: c.id === playerId ? `✓ ${c.label}` : c.label }))}
          onPick={(id) => setPlayerId(id)}
          accent={accent}
          empty={t('directo_entry.no_field_players')}
          disabled={disabled}
        />
      ) : null}

      {esSub ? (
        <ActorGrid
          title={t('partido_directo.timeline.field_player_in')}
          players={roster
            .filter((r) => r.playerId !== playerId)
            .map((r) => rosterChip(r, t))
            .map((c) => ({ ...c, label: c.id === playerInId ? `✓ ${c.label}` : c.label }))}
          onPick={(id) => setPlayerInId(id)}
          accent={accent}
          empty={t('directo_entry.no_bench')}
          disabled={disabled}
        />
      ) : null}

      {pideDorsal ? (
        <View style={{ gap: 6 }}>
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {t('partido_directo.timeline.field_dorsal')}
          </Text>
          <TextInput
            value={dorsal}
            onChangeText={setDorsal}
            editable={!disabled}
            keyboardType="number-pad"
            maxLength={2}
            className="w-20 rounded-xl border border-zinc-200 px-3 py-2 text-center text-sm"
            style={{ opacity: disabled ? 0.4 : 1 }}
          />
        </View>
      ) : null}

      {/* ── Lo que pide cada tipo ── */}
      {type === 'penalty' ? (
        <Opciones
          titulo={t('partido_directo.timeline.field_outcome')}
          opciones={PENALTY_OUTCOMES.map((o) => ({
            valor: o,
            etiqueta: t(`partido_directo.penalty_outcome.${o}`),
          }))}
          valor={outcome}
          onPick={setOutcome}
          estilo={chip}
          disabled={disabled}
        />
      ) : null}

      {type === 'foul' ? (
        <Opciones
          titulo={t('partido_directo.timeline.field_foul_kind')}
          opciones={FOUL_KINDS.map((k) => ({
            valor: k,
            etiqueta: t(
              k === 'received' ? 'partido_directo.foul_received' : 'partido_directo.foul_committed',
            ),
          }))}
          valor={foulKind}
          onPick={setFoulKind}
          estilo={chip}
          disabled={disabled}
        />
      ) : null}

      {type === 'corner' ? (
        <Opciones
          titulo={t('partido_directo.timeline.field_corner_side')}
          opciones={CORNER_SIDES.map((s) => ({
            valor: s,
            etiqueta: t(
              s === 'against'
                ? 'partido_directo.event.corner_against'
                : 'partido_directo.event.corner_for',
            ),
          }))}
          valor={cornerSide}
          onPick={setCornerSide}
          estilo={chip}
          disabled={disabled}
        />
      ) : null}

      <Pressable
        disabled={disabled || !listo}
        onPress={enviar}
        className="self-start rounded-full px-4 py-2 active:opacity-70"
        style={{ backgroundColor: accent, opacity: disabled || !listo ? 0.4 : 1 }}
      >
        <Text className="text-sm font-semibold text-white">
          {t('partido_directo.timeline.add_submit')}
        </Text>
      </Pressable>
    </View>
  );
}

function Opciones({
  titulo,
  opciones,
  valor,
  onPick,
  estilo,
  disabled,
}: {
  titulo: string;
  opciones: { valor: string; etiqueta: string }[];
  valor: string;
  onPick: (v: string) => void;
  estilo: (activo: boolean) => Record<string, unknown>;
  disabled: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {titulo}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {opciones.map((o) => (
          <Pressable
            key={o.valor}
            disabled={disabled}
            onPress={() => onPick(o.valor)}
            className="rounded-xl px-3 py-2 active:opacity-70"
            style={estilo(valor === o.valor)}
          >
            <Text className="text-sm text-[#0F1B2E]">{o.etiqueta}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
