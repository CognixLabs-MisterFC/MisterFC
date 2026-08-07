import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useActivePlayer } from '@/auth/active-player';
import { useApp } from '@/auth/context';
import { BRAND } from '@/theme';
import { useTranslations } from '@/locale/provider';

/**
 * O2-5 C1 — Selector de HIJO ACTIVO en la cabecera de las pantallas player-scoped
 * (Mi ficha, Mi informe, Seguidores). El estado viene de la Tanda A
 * (`useActivePlayer`); aquí se construye la UI. Solo se muestra si el tutor tiene
 * MÁS DE UN hijo en el club activo; al cambiar de hijo, `setActivePlayer` recompone
 * las pantallas (su key de caché lleva el playerId → datos del nuevo hijo).
 */
export function ChildSelector() {
  const { players, activePlayer, setActivePlayer } = useActivePlayer();
  const { theme } = useApp();
  const t = useTranslations('shell.selector');
  const [open, setOpen] = useState(false);
  const accent = theme?.color ?? BRAND.navy;

  if (players.length <= 1 || !activePlayer) return null;

  return (
    <View className="border-b border-zinc-100 bg-white px-4 py-2">
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 active:opacity-70"
      >
        <View className="flex-row items-center gap-2">
          <View className="h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
            <Text className="text-[11px] font-bold text-white">
              {activePlayer.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text className="text-sm font-semibold text-[#0F1B2E]">{activePlayer.name}</Text>
        </View>
        <Text className="text-xs text-zinc-400">{t('change')}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
          <View className="rounded-t-3xl bg-white p-4 pb-8">
            <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t('pick_child')}
            </Text>
            {players.map((p) => {
              const active = p.id === activePlayer.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setOpen(false);
                    if (!active) void setActivePlayer(p.id);
                  }}
                  className="flex-row items-center justify-between rounded-xl px-3 py-3 active:bg-zinc-50"
                >
                  <Text className={active ? 'text-base font-semibold text-[#0F1B2E]' : 'text-base text-zinc-600'}>
                    {p.name}
                  </Text>
                  {active ? <Text style={{ color: accent }}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
