import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { PENALTY_OUTCOMES, type LineupRosterPlayer, type QuickEntryInput } from '@misterfc/core';
import { useTranslations } from '@/locale/provider';

/**
 * O2-9b — ENTRADA RÁPIDA de eventos del directo (staff). Réplica del flujo web
 * "elegir tipo + jugador/lado + confirma", optimizada para "regístralo YA" (está
 * pasando AHORA) con el MÍNIMO de toques:
 *
 *   · Gol propio / Amarilla / Roja → tocar TIPO, tocar JUGADOR   → 2 toques.
 *   · Cambio                        → tocar «Cambio», SALE, ENTRA → 3 toques.
 *   · Gol rival                     → tocar «Gol rival», dorsal, registrar.
 *   · En propia                     → tocar «En propia», tocar JUGADOR → 2 toques.
 *   · Penalti                       → tocar «Penalti», JUGADOR, RESULTADO → 3.
 *
 * El AUTOGOL está aquí, y no solo en el alta manual, porque pasa EN VIVO: si hubiera
 * que esperar al final para apuntarlo, el entrenador volvería a la salida de hoy —un
 * gol del rival con un dorsal inventado—, que es la mentira que esto quita. La fila
 * es un gol del RIVAL (eso decide el marcador) con autor NUESTRO.
 *
 * El último toque CONFIRMA (no hay botón extra en los de un actor): el evento se
 * registra al instante (optimista + cola). No decide red ni gate: eso lo llevan el
 * hook de cola (offline) y la RLS (al subir). Aquí solo se ELIGE qué pasó.
 *
 * DOS PISOS, y el de abajo es un solo chip. Arriba está lo que se resuelve en dos
 * o tres toques y pasa mientras miras el campo; el resto de los diez tipos del
 * acta —falta, córner, asistencia, fuera de juego, tiro— vive detrás de «Añadir
 * evento», que abre el formulario completo en el minuto del reloj. El motivo es de
 * tamaño: medido sobre estos mismos chips, en un móvil de 360 los seis de arriba
 * ya ocupan tres filas, y meter los cinco restantes —que son los nombres más
 * largos del catálogo— serían seis filas de paleta antes de elegir jugador.
 *
 * El PENALTI sube al primer piso aunque cueste tres toques: cambia el marcador y
 * hay que apuntarlo en el momento, igual que un gol.
 *
 * QUIÉN SALE EN CADA LISTA NO SE DECIDE AQUÍ, y antes sí: esta pantalla recibía los
 * titulares de la alineación oficial y restaba para sacar el banquillo. Después del
 * primer cambio eso ya era falso —el que acababa de salir seguía ofreciéndose para
 * salir, el que entró no se podía sacar, y la reentrada no la miraba nadie—, y un
 * cambio apuntado sobre quien no era reparte mal los minutos de todo el equipo.
 * Ahora las dos listas llegan hechas desde `deriveSquad` (core), que conoce las
 * sustituciones, las expulsiones, las ausencias y el régimen de la categoría.
 */
type Mode = null | 'goal' | 'yellow_card' | 'red_card' | 'sub' | 'rival' | 'own_goal' | 'penalty';

/** Un jugador tal y como se pinta en un chip: con lo justo para tocarlo. */
export type ActorChip = { id: string; label: string; dorsal: number | null };

export function QuickEntry({
  enCampo,
  puedenEntrar,
  accent,
  disabled,
  onRegister,
  onMore,
}: {
  /** Quién está en el campo AHORA (ocupantes de los huecos), ya resuelto por core. */
  enCampo: ActorChip[];
  /** Quién puede ENTRAR ahora: suplentes sin estrenar y, si el régimen lo permite,
   *  los que ya salieron. Los expulsados y los ausentes no están en ninguna lista. */
  puedenEntrar: ActorChip[];
  accent: string;
  disabled: boolean;
  onRegister: (input: QuickEntryInput) => void;
  /** Abre el SEGUNDO PISO: el formulario con los diez tipos, en el minuto actual. */
  onMore: () => void;
}) {
  const t = useTranslations('');
  const [mode, setMode] = useState<Mode>(null);
  const [subOut, setSubOut] = useState<string | null>(null);
  const [dorsal, setDorsal] = useState('');
  // Penalti: primero el jugador, después el resultado. Se guarda el jugador aquí
  // porque el registro no ocurre hasta el segundo toque.
  const [penaltyPlayer, setPenaltyPlayer] = useState<string | null>(null);

  const reset = () => {
    setMode(null);
    setSubOut(null);
    setDorsal('');
    setPenaltyPlayer(null);
  };

  const pickPlayer = (playerId: string) => {
    if (mode === 'goal') onRegister({ kind: 'player_goal', playerId });
    else if (mode === 'own_goal') onRegister({ kind: 'own_goal', playerId });
    else if (mode === 'yellow_card' || mode === 'red_card')
      onRegister({ kind: 'card', card: mode, playerId });
    else if (mode === 'penalty') {
      // El penalti NO se registra aquí: falta el resultado, y sin él la fila no se
      // puede contar ni como gol ni como fallo. Se guarda el autor y se pregunta.
      setPenaltyPlayer(playerId);
      return;
    }
    reset();
  };

  const pickSub = (playerId: string) => {
    if (!subOut) {
      setSubOut(playerId); // 1º el que SALE
      return;
    }
    if (playerId !== subOut) {
      onRegister({ kind: 'substitution', playerOutId: subOut, playerInId: playerId });
    }
    reset();
  };

  const registerRival = () => {
    const n = Number.parseInt(dorsal, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 99) {
      onRegister({ kind: 'rival_goal', dorsal: n });
      reset();
    }
  };

  const TYPES: { key: Mode; label: string; tone?: 'y' | 'r' }[] = [
    { key: 'goal', label: t('directo_entry.type_goal') },
    { key: 'yellow_card', label: t('directo_entry.type_yellow'), tone: 'y' },
    { key: 'red_card', label: t('directo_entry.type_red'), tone: 'r' },
    { key: 'sub', label: t('directo_entry.type_sub') },
    { key: 'rival', label: t('directo_entry.type_rival') },
    // `partido_directo.own_goal`: la ÚNICA cadena nueva de la pieza, en el catálogo
    // compartido, porque la usan también el formulario de alta y la web.
    { key: 'own_goal', label: t('partido_directo.own_goal') },
    // `partido_directo.event.penalty` ya existía en el catálogo (lo usan el acta y
    // la web); no se inventa una cadena nueva para decir lo mismo.
    { key: 'penalty', label: t('partido_directo.event.penalty') },
  ];

  return (
    <View className="rounded-2xl border border-zinc-200 p-4" style={{ gap: 10 }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('directo_entry.title')}
        </Text>
        {mode ? (
          <Pressable onPress={reset} className="px-2 py-1 active:opacity-60">
            <Text className="text-xs text-zinc-500">{t('directo_entry.cancel')}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Paso 1 — TIPO. */}
      <View className="flex-row flex-wrap gap-2">
        {TYPES.map((ty) => {
          const active = mode === ty.key;
          const dot = ty.tone === 'y' ? '#f59e0b' : ty.tone === 'r' ? '#dc2626' : accent;
          return (
            <Pressable
              key={ty.key}
              disabled={disabled}
              onPress={() => {
                setSubOut(null);
                setDorsal('');
                setMode(active ? null : ty.key);
              }}
              className="flex-row items-center gap-1.5 rounded-xl px-3 py-2 active:opacity-70"
              style={{
                borderWidth: 1.5,
                borderColor: active ? dot : '#e4e4e7',
                backgroundColor: active ? `${dot}14` : undefined,
                opacity: disabled ? 0.4 : 1,
              }}
            >
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
              <Text className="text-sm font-medium text-[#0F1B2E]">{ty.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Paso 2 — ACTOR. */}
      {mode === 'penalty' && penaltyPlayer == null ? (
        <ActorGrid
          title={t('directo_entry.pick_player')}
          players={enCampo}
          onPick={pickPlayer}
          accent={accent}
          empty={t('directo_entry.no_field_players')}
        />
      ) : null}

      {/* Paso 3 del PENALTI — el resultado, que es lo que decide el marcador. */}
      {mode === 'penalty' && penaltyPlayer != null ? (
        <View style={{ gap: 6 }}>
          <Text className="text-xs text-zinc-400">
            {t('partido_directo.timeline.field_outcome')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {PENALTY_OUTCOMES.map((o) => (
              <Pressable
                key={o}
                onPress={() => {
                  onRegister({ kind: 'penalty', playerId: penaltyPlayer, outcome: o });
                  reset();
                }}
                className="rounded-xl border border-zinc-200 px-3 py-2 active:opacity-70"
                style={{ borderLeftWidth: 3, borderLeftColor: accent }}
              >
                <Text className="text-sm text-[#0F1B2E]">
                  {t(`partido_directo.penalty_outcome.${o}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {mode === 'goal' || mode === 'own_goal' || mode === 'yellow_card' || mode === 'red_card' ? (
        <ActorGrid
          title={t('directo_entry.pick_player')}
          players={enCampo}
          onPick={pickPlayer}
          accent={accent}
          empty={t('directo_entry.no_field_players')}
        />
      ) : null}

      {mode === 'sub' ? (
        <ActorGrid
          title={subOut ? t('directo_entry.pick_in') : t('directo_entry.pick_out')}
          players={(subOut ? puedenEntrar : enCampo).filter((p) => p.id !== subOut)}
          onPick={pickSub}
          accent={accent}
          empty={subOut ? t('directo_entry.no_bench') : t('directo_entry.no_field_players')}
        />
      ) : null}

      {/* SEGUNDO PISO. Un solo chip, y a propósito con otro aspecto: no es un tipo
          más, es la puerta al formulario completo (falta, córner, asistencia, fuera
          de juego, tiro, y el penalti del rival). Abre en el minuto del reloj.
          Además es la ÚNICA puerta a ese formulario cuando el acta está vacía: hasta
          ahora solo se llegaba tocando un evento ya apuntado. */}
      {mode === null ? (
        <Pressable
          disabled={disabled}
          onPress={onMore}
          className="self-start rounded-xl border border-dashed border-zinc-300 px-3 py-2 active:opacity-70"
          style={{ opacity: disabled ? 0.4 : 1 }}
        >
          <Text className="text-sm text-zinc-500">{t('partido_directo.timeline.add')}</Text>
        </Pressable>
      ) : null}

      {mode === 'rival' ? (
        <View style={{ gap: 8 }}>
          <Text className="text-xs text-zinc-400">{t('directo_entry.rival_dorsal')}</Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={dorsal}
              onChangeText={(v) => setDorsal(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              placeholder="0"
              maxLength={2}
              className="w-20 rounded-xl border border-zinc-200 px-3 py-2 text-center text-base text-[#0F1B2E]"
            />
            <Pressable
              onPress={registerRival}
              disabled={!dorsal}
              className="rounded-xl px-4 py-2.5 active:opacity-70"
              style={{ backgroundColor: accent, opacity: dorsal ? 1 : 0.4 }}
            >
              <Text className="text-sm font-semibold text-white">
                {t('directo_entry.register_rival')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Chip de un jugador de la plantilla. Exportado: lo reusa la hoja de corrección. */
export function rosterChip(
  r: LineupRosterPlayer,
  t: (key: string) => string,
): { id: string; label: string; dorsal: number | null } {
  const name = `${r.firstName} ${r.lastName}`.trim();
  return { id: r.playerId, label: name || t('directo_entry.player'), dorsal: r.dorsal };
}

/**
 * Rejilla de actores. Exportada porque la hoja de corrección elige jugador igual que
 * la entrada rápida: una segunda rejilla sería la misma pantalla escrita dos veces.
 * `disabled` es aditivo (por defecto false) y lo necesita el write-guard: sin red los
 * chips SE VEN, atenuados, en vez de desaparecer.
 */
export function ActorGrid({
  title,
  players,
  onPick,
  accent,
  empty,
  disabled = false,
}: {
  title: string;
  players: { id: string; label: string; dorsal: number | null }[];
  onPick: (id: string) => void;
  accent: string;
  empty: string;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text className="text-xs text-zinc-400">{title}</Text>
      {players.length === 0 ? (
        <Text className="py-2 text-sm text-zinc-400">{empty}</Text>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {players.map((p) => (
            <Pressable
              key={p.id}
              disabled={disabled}
              onPress={() => onPick(p.id)}
              className="flex-row items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-2 active:opacity-70"
              style={{ borderLeftWidth: 3, borderLeftColor: accent, opacity: disabled ? 0.4 : 1 }}
            >
              {p.dorsal != null ? (
                <Text className="text-xs font-bold text-zinc-400 tabular-nums">{p.dorsal}</Text>
              ) : null}
              <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
