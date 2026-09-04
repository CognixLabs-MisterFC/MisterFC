import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useActivePlayer } from '@/auth/active-player';
import { useApp } from '@/auth/context';
import { BRAND } from '@/theme';
import { useTranslations } from '@/locale/provider';

/**
 * Selector de HIJO ACTIVO — chip compacto.
 *
 * DÓNDE VIVE: SOLO en el inicio de familia, en la línea del saludo. Antes era una
 * franja de ancho completo repetida en ocho pantallas (diez montajes contando las
 * ramas de vacío y de error); un solo sitio donde se elige.
 *
 * `readOnly`: el MISMO chip sin abrir nada. Lo usan las pantallas que quedaron sin
 * decir de quién son sus datos (gestión, seguidores, convocatorias,
 * entrenamientos). No es un selector: es la referencia de a quién estás mirando.
 * En `gestión` se editan alergias y se pide el borrado RGPD de un menor, y en
 * `seguidores` se decide quién puede ver a un niño: escribir en la ficha del
 * hermano equivocado es un daño real y silencioso.
 *
 * Va en el MISMO componente, y no en uno aparte, para que las dos formas no puedan
 * divergir: misma fuente de datos (`useActivePlayer`), mismo aspecto, misma regla
 * de cuándo se pinta.
 *
 * Con UN SOLO hijo no pinta nada, ni como selector ni como etiqueta: sin hermanos
 * no hay ambigüedad que resolver.
 */
export function ChildSelector({ readOnly = false }: { readOnly?: boolean }) {
  const { players, activePlayer, setActivePlayer } = useActivePlayer();
  const { theme } = useApp();
  const t = useTranslations('shell.selector');
  const [open, setOpen] = useState(false);
  const accent = theme?.color ?? BRAND.navy;

  if (players.length <= 1 || !activePlayer) return null;

  // Solo el nombre de pila: el chip comparte línea con el saludo, que lleva el
  // nombre completo del tutor y es quien debe llevarse el espacio sobrante.
  const firstName = activePlayer.name.trim().split(/\s+/)[0] || activePlayer.name;

  const chip = (
    <View className="flex-row items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1.5">
      <View
        className="h-5 w-5 items-center justify-center rounded-full"
        style={{ backgroundColor: accent }}
      >
        <Text className="text-[10px] font-bold text-white">
          {activePlayer.name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <Text className="text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
        {firstName}
      </Text>
      {readOnly ? null : <Text className="text-xs text-zinc-400">▾</Text>}
    </View>
  );

  // Etiqueta: dice de quién son los datos. Para cambiar de hijo se va al inicio.
  if (readOnly) {
    return (
      <View className="shrink-0" accessibilityLabel={activePlayer.name}>
        {chip}
      </View>
    );
  }

  return (
    <View className="shrink-0">
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('pick_child')}
        // Área de toque cómoda sin agrandar el chip (comparte línea con el saludo).
        hitSlop={8}
        className="active:opacity-70"
      >
        {chip}
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
