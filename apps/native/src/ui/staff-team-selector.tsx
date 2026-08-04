import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useActiveStaffTeam } from '@/auth/active-staff-team';
import { useApp } from '@/auth/context';
import { BRAND } from '@/theme';
import { t } from '@/i18n';

/**
 * O2-10b-2 — Selector de EQUIPO ACTIVO del coordinador en la cabecera de sus
 * consultas (cuerpo técnico de dirección · jugadores). Espejo de `ChildSelector`:
 * solo se muestra si el usuario tiene MÁS DE UN equipo; al cambiar de equipo,
 * `setActiveTeam` recompone las pantallas (su key de caché lleva el teamId → datos
 * del nuevo equipo). El color del punto es el del equipo.
 */
export function StaffTeamSelector() {
  const { teams, activeTeam, setActiveTeam } = useActiveStaffTeam();
  const { theme } = useApp();
  const [open, setOpen] = useState(false);
  const accent = theme?.color ?? BRAND.navy;

  if (teams.length <= 1 || !activeTeam) return null;

  return (
    <View className="border-b border-zinc-100 bg-white px-4 py-2">
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 active:opacity-70"
      >
        <View className="flex-row items-center gap-2">
          <View
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: activeTeam.color || accent }}
          />
          <Text className="text-sm font-semibold text-[#0F1B2E]">{activeTeam.name}</Text>
        </View>
        <Text className="text-xs text-zinc-400">{t('staff_team.change')}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
          <View className="rounded-t-3xl bg-white p-4 pb-8">
            <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t('staff_team.pick')}
            </Text>
            {teams.map((team) => {
              const active = team.teamId === activeTeam.teamId;
              return (
                <Pressable
                  key={team.teamId}
                  onPress={() => {
                    setOpen(false);
                    if (!active) void setActiveTeam(team.teamId);
                  }}
                  className="flex-row items-center justify-between rounded-xl px-3 py-3 active:bg-zinc-50"
                >
                  <View className="flex-row items-center gap-2">
                    <View
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: team.color || accent }}
                    />
                    <Text className={active ? 'text-base font-semibold text-[#0F1B2E]' : 'text-base text-zinc-600'}>
                      {team.name}
                    </Text>
                  </View>
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
