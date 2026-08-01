import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSpectatorPlayer } from '@/auth/spectator-player';
import { NEUTRAL_COLOR } from '@/theme';
import { t } from '@/i18n';

/**
 * O2-6 — Selector de JUGADOR SEGUIDO ACTIVO en la cabecera de las pantallas de la
 * carcasa /spectator. Espejo de `ChildSelector` (familia), pero sobre
 * `useSpectatorPlayer` y con color NEUTRO (el seguidor no tiene club/tema). Solo se
 * muestra si el seguidor sigue a MÁS DE UN jugador; al cambiar, `setActivePlayer`
 * recompone las pantallas (su key de caché lleva el playerId → datos del nuevo).
 */
export function SpectatorPlayerSelector() {
  const { players, activePlayer, setActivePlayer } = useSpectatorPlayer();
  const [open, setOpen] = useState(false);

  if (players.length <= 1 || !activePlayer) return null;

  return (
    <View className="border-b border-zinc-100 bg-white px-4 py-2">
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 active:opacity-70"
      >
        <View className="flex-row items-center gap-2">
          <View
            className="h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: NEUTRAL_COLOR }}
          >
            <Text className="text-[11px] font-bold text-white">
              {activePlayer.fullName.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text className="text-sm font-semibold text-[#0F1B2E]">
            {activePlayer.fullName}
          </Text>
        </View>
        <Text className="text-xs text-zinc-400">{t('child.change')}</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
          <View className="rounded-t-3xl bg-white p-4 pb-8">
            <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t('child.pick')}
            </Text>
            {players.map((p) => {
              const active = p.playerId === activePlayer.playerId;
              return (
                <Pressable
                  key={p.playerId}
                  onPress={() => {
                    setOpen(false);
                    if (!active) void setActivePlayer(p.playerId);
                  }}
                  className="flex-row items-center justify-between rounded-xl px-3 py-3 active:bg-zinc-50"
                >
                  <Text className={active ? 'text-base font-semibold text-[#0F1B2E]' : 'text-base text-zinc-600'}>
                    {p.fullName}
                  </Text>
                  {active ? <Text style={{ color: NEUTRAL_COLOR }}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
