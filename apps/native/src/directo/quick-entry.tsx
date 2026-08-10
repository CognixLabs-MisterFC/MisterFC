import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type {
  DetailFieldPlayer,
  LineupRosterPlayer,
  QuickEntryInput,
} from '@misterfc/core';
import { useTranslations } from '@/locale/provider';

/**
 * O2-9b — ENTRADA RÁPIDA de eventos del directo (staff). Réplica del flujo web
 * "elegir tipo + jugador/lado + confirma", optimizada para "regístralo YA" (está
 * pasando AHORA) con el MÍNIMO de toques:
 *
 *   · Gol propio / Amarilla / Roja → tocar TIPO, tocar JUGADOR   → 2 toques.
 *   · Cambio                        → tocar «Cambio», SALE, ENTRA → 3 toques.
 *   · Gol rival                     → tocar «Gol rival», dorsal, registrar.
 *
 * El último toque CONFIRMA (no hay botón extra en los de un actor): el evento se
 * registra al instante (optimista + cola). No decide red ni gate: eso lo llevan el
 * hook de cola (offline) y la RLS (al subir). Aquí solo se ELIGE qué pasó.
 */
type Mode = null | 'goal' | 'yellow_card' | 'red_card' | 'sub' | 'rival';

export function QuickEntry({
  fieldPlayers,
  roster,
  accent,
  disabled,
  onRegister,
}: {
  fieldPlayers: DetailFieldPlayer[];
  roster: LineupRosterPlayer[];
  accent: string;
  disabled: boolean;
  onRegister: (input: QuickEntryInput) => void;
}) {
  const t = useTranslations('');
  const [mode, setMode] = useState<Mode>(null);
  const [subOut, setSubOut] = useState<string | null>(null);
  const [dorsal, setDorsal] = useState('');

  const onFieldIds = useMemo(
    () => new Set(fieldPlayers.map((p) => p.playerId)),
    [fieldPlayers],
  );
  // Banquillo elegible a ENTRAR = roster que no está en el campo ahora mismo.
  const bench = useMemo(
    () => roster.filter((r) => !onFieldIds.has(r.playerId)),
    [roster, onFieldIds],
  );

  const reset = () => {
    setMode(null);
    setSubOut(null);
    setDorsal('');
  };

  const pickPlayer = (playerId: string) => {
    if (mode === 'goal') onRegister({ kind: 'player_goal', playerId });
    else if (mode === 'yellow_card' || mode === 'red_card')
      onRegister({ kind: 'card', card: mode, playerId });
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
      {mode === 'goal' || mode === 'yellow_card' || mode === 'red_card' ? (
        <ActorGrid
          title={t('directo_entry.pick_player')}
          players={fieldPlayers.map((p) => ({ id: p.playerId, label: p.label, dorsal: p.dorsal }))}
          onPick={pickPlayer}
          accent={accent}
          empty={t('directo_entry.no_field_players')}
        />
      ) : null}

      {mode === 'sub' ? (
        <ActorGrid
          title={subOut ? t('directo_entry.pick_in') : t('directo_entry.pick_out')}
          players={(subOut ? bench.map((r) => rosterChip(r, t)) : fieldPlayers.map((p) => ({
            id: p.playerId,
            label: p.label,
            dorsal: p.dorsal,
          }))).filter((p) => p.id !== subOut)}
          onPick={pickSub}
          accent={accent}
          empty={subOut ? t('directo_entry.no_bench') : t('directo_entry.no_field_players')}
        />
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

function rosterChip(r: LineupRosterPlayer, t: (key: string) => string): { id: string; label: string; dorsal: number | null } {
  const name = `${r.firstName} ${r.lastName}`.trim();
  return { id: r.playerId, label: name || t('directo_entry.player'), dorsal: r.dorsal };
}

function ActorGrid({
  title,
  players,
  onPick,
  accent,
  empty,
}: {
  title: string;
  players: { id: string; label: string; dorsal: number | null }[];
  onPick: (id: string) => void;
  accent: string;
  empty: string;
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
              onPress={() => onPick(p.id)}
              className="flex-row items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-2 active:opacity-70"
              style={{ borderLeftWidth: 3, borderLeftColor: accent }}
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
