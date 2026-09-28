import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
  getAssignmentTargetTeamsFromClient,
  staffAssignmentPermission,
  clubScopedCacheKey,
  type ClubTeamCard,
  type TeamStaffRole,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { reportDataError } from '@/lib/report-error';
import { useTranslations } from '@/locale/provider';

/**
 * W-2 — "Agregar rol": dar una función en un equipo a alguien que YA está en el club,
 * desde la app. Se usa desde las DOS superficies de dirección (la fila de la lista de
 * cuerpo técnico y la ficha), igual que en la web es el mismo diálogo en los dos
 * sitios.
 *
 * Quién decide qué:
 *   · QUÉ SE OFRECE lo dice `staffAssignmentPermission` (core, W-2): las funciones del
 *     selector y de dónde salen los equipos. No se deduce aquí — la web lo tenía
 *     repartido en tres sitios y uno de sus comentarios ya mentía.
 *   · QUIÉN PUEDE de verdad lo dice la RLS `team_staff_insert_admin`, en el INSERT que
 *     hace el endpoint con el cliente del usuario. Esta pantalla no es un candado.
 *
 * Write-guard: sin red no se llama (el botón queda deshabilitado y se dice por qué).
 */

const ERRORES = [
  'team_invalid',
  'staff_role_invalid',
  'cross_club',
  'principal_exists',
  'role_exists',
  'forbidden',
  'generic',
] as const;
type ErrorCode = (typeof ERRORES)[number];

function esError(v: unknown): v is ErrorCode {
  return typeof v === 'string' && (ERRORES as readonly string[]).includes(v);
}

export function AddRoleModal({
  visible,
  membershipId,
  personName,
  onClose,
  onDone,
}: {
  visible: boolean;
  /** Membresía de la PERSONA a la que se le da el rol (no la de quien mira). */
  membershipId: string;
  personName: string;
  onClose: () => void;
  /** Se llama tras un alta correcta, para que la pantalla de detrás se recargue. */
  onDone: () => void;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const online = useIsOnline();

  const clubId = activeClub?.club.id ?? null;
  const viewerMembershipId = activeClub?.membershipId ?? null;
  const viewerRole = activeClub?.role ?? null;

  const [teamId, setTeamId] = useState<string | null>(null);
  const [staffRole, setStaffRole] = useState<TeamStaffRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState(false);

  const roles = useMemo(() => staffAssignmentPermission(viewerRole).roles, [viewerRole]);

  // Los equipos ofrecidos dependen del rol de quien mira, así que la caché va por
  // club (el rol no cambia dentro de una sesión de club).
  const { data: teams } = useCached<ClubTeamCard[]>(
    clubScopedCacheKey('dir-destinos-rol', clubId ?? 'none'),
    (sb) =>
      clubId && viewerMembershipId
        ? getAssignmentTargetTeamsFromClient(
            sb,
            { clubId, viewerMembershipId, role: viewerRole },
            (e) => reportDataError('add-role-targets', e),
          )
        : Promise.resolve([]),
  );

  const opciones = teams ?? [];

  const close = useCallback(() => {
    if (saving) return;
    setTeamId(null);
    setStaffRole(null);
    setError(null);
    setDone(false);
    onClose();
  }, [saving, onClose]);

  const submit = useCallback(async () => {
    if (!online || saving || !teamId || !staffRole) return; // write-guard
    setSaving(true);
    setError(null);
    try {
      const res = await callServerEndpoint('/api/staff/assignments', {
        method: 'POST',
        body: { membershipId, teamId, staffRole },
      });
      let json: { error?: unknown } = {};
      try {
        json = (await res.json()) as { error?: unknown };
      } catch {
        json = {};
      }
      if (res.ok) {
        setDone(true);
        onDone();
      } else {
        // El endpoint devuelve los MISMOS códigos que la web, así que el texto se
        // comparte. Un código que no conozcamos no se disfraza: es `generic`.
        setError(esError(json.error) ? json.error : 'generic');
      }
    } catch {
      // no_web_url / no_session / red caída a mitad.
      setError('generic');
    } finally {
      setSaving(false);
    }
  }, [online, saving, teamId, staffRole, membershipId, onDone]);

  const puede = online && !saving && teamId != null && staffRole != null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="max-h-[80%] w-full max-w-md rounded-2xl bg-white p-5">
          <Text className="text-lg font-bold text-[#0F1B2E]">
            {t('cuerpo_tecnico.add_role.title')}
          </Text>

          {done ? (
            <>
              <Text className="mt-2 text-sm text-zinc-700">
                {t('cuerpo_tecnico.add_role.done', { name: personName })}
              </Text>
              <View className="mt-4 flex-row justify-end">
                <Pressable
                  onPress={close}
                  className="rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-white">
                    {t('cuerpo_tecnico.add_role.close')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className="mt-2 text-sm text-zinc-600">
                {t('cuerpo_tecnico.add_role.description')}
              </Text>

              {opciones.length === 0 ? (
                <Text className="mt-4 text-sm text-zinc-500">
                  {t('cuerpo_tecnico.add_role.no_teams')}
                </Text>
              ) : (
                <ScrollView className="mt-3" keyboardShouldPersistTaps="handled">
                  <Text className="text-xs font-medium text-zinc-500">
                    {t('cuerpo_tecnico.add_role.field.team')}
                  </Text>
                  <View className="mt-1 overflow-hidden rounded-xl border border-zinc-200">
                    {opciones.map((tm, i) => (
                      <Pressable
                        key={tm.teamId}
                        onPress={() => setTeamId(tm.teamId)}
                        className={`flex-row items-center gap-3 px-3 py-2.5 active:opacity-70 ${
                          i > 0 ? 'border-t border-zinc-100' : ''
                        } ${teamId === tm.teamId ? 'bg-zinc-100' : ''}`}
                      >
                        <View
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: tm.color }}
                        />
                        <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                          {tm.name}
                        </Text>
                        <Text className="text-xs text-zinc-400" numberOfLines={1}>
                          {tm.categoryName}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text className="mt-4 text-xs font-medium text-zinc-500">
                    {t('cuerpo_tecnico.add_role.field.staff_role')}
                  </Text>
                  <View className="mt-1 flex-row flex-wrap gap-2">
                    {roles.map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => setStaffRole(r)}
                        className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
                          staffRole === r
                            ? 'border-[#0F1B2E] bg-[#0F1B2E]'
                            : 'border-zinc-200 bg-white'
                        }`}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            staffRole === r ? 'text-white' : 'text-zinc-600'
                          }`}
                        >
                          {t(`staff_role.${r}`)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}

              {error ? (
                <Text className="mt-3 text-xs text-red-600">
                  {t(`cuerpo_tecnico.add_role.errors.${error}`)}
                </Text>
              ) : null}
              {!online ? (
                <Text className="mt-3 text-xs text-zinc-500">
                  {t('cuerpo_tecnico.add_role.offline')}
                </Text>
              ) : null}

              <View className="mt-4 flex-row justify-end gap-2">
                <Pressable
                  onPress={close}
                  disabled={saving}
                  className="rounded-full px-4 py-2 active:opacity-60"
                >
                  <Text className="text-sm text-zinc-500">
                    {t('cuerpo_tecnico.add_role.cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={!puede}
                  className="flex-row items-center gap-2 rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                  style={!puede ? { opacity: 0.5 } : undefined}
                >
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text className="text-sm font-semibold text-white">
                    {saving
                      ? t('cuerpo_tecnico.add_role.saving')
                      : t('cuerpo_tecnico.add_role.save')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
