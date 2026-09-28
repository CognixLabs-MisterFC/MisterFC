import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
  canAssignStaffToTeam,
  clubScopedCacheKey,
  getCoordinatedTeamIdsFromClient,
  getStaffCandidatesFromClient,
  staffAssignmentPermission,
  type StaffCandidate,
  type TeamStaffRole,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { reportDataError } from '@/lib/report-error';
import { useTranslations } from '@/locale/provider';

/**
 * W-3 — "Añadir staff": dar una función en ESTE equipo a alguien que ya está en el
 * club. La contraparte de W-2: allí la persona estaba fija y se elegía el equipo.
 *
 * MISMO endpoint que W-2 (`/api/staff/assignments`), porque pide exactamente lo
 * mismo: membresía + equipo + función. No hay endpoint nuevo en W-3.
 *
 * El candado vive en `AddStaffAction`, no aquí: se decide ANTES de pintar el botón,
 * porque a un coordinador no se le puede ofrecer esto en un equipo que no coordina
 * (la RLS le responde 42501). Eso es lo que este mismo PR arregla en la web.
 */

/**
 * Los códigos que devuelve el endpoint, traducidos a las claves de ESTA pantalla.
 *
 * El endpoint habla el idioma de W-2 (`invalid`, `staff_role_invalid`) y este
 * namespace usa otros nombres (`membership_invalid`, `team_staff_role_invalid`)
 * porque aquí lo que se elige es la PERSONA. La tabla es explícita y hay un test que
 * comprueba que cada destino existe en los tres idiomas.
 */
const TEXTO_DE_ERROR: Record<string, string> = {
  invalid: 'membership_invalid',
  membership_invalid: 'membership_invalid',
  staff_role_invalid: 'team_staff_role_invalid',
  team_staff_role_invalid: 'team_staff_role_invalid',
  team_invalid: 'team_invalid',
  cross_club: 'cross_club',
  principal_exists: 'principal_exists',
  role_exists: 'role_exists',
  forbidden: 'forbidden',
  generic: 'generic',
};

function claveDeError(code: unknown): string {
  return (typeof code === 'string' && TEXTO_DE_ERROR[code]) || 'generic';
}

/**
 * El botón, con su candado. Se le pasa a `CuerpoTecnicoScreen` por la prop `action`,
 * y SOLO desde la ruta de dirección: esa pantalla la comparten familia y dirección.
 */
export function AddStaffAction({
  teamId,
  refresh,
}: {
  teamId: string;
  refresh: () => void;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const online = useIsOnline();
  const [open, setOpen] = useState(false);

  const clubId = activeClub?.club.id ?? null;
  const viewerMembershipId = activeClub?.membershipId ?? null;
  const viewerRole = activeClub?.role ?? null;

  // `undefined` mientras se resuelve: no se pinta el botón todavía. Un coordinador
  // no debe verlo hasta saber si coordina este equipo.
  const { data: coordinados } = useCached<string[] | null>(
    clubScopedCacheKey('dir-coordinados', clubId ?? 'none'),
    (sb) =>
      viewerMembershipId
        ? getCoordinatedTeamIdsFromClient(
            sb,
            { membershipId: viewerMembershipId, role: viewerRole },
            (e) => reportDataError('add-staff-coordinated', e),
          )
        : Promise.resolve([]),
  );

  // Para admin/director la lectura devuelve `null`, que aquí significa "sin recortar".
  // `useCached` no distingue "null cargado" de "todavía nada", así que se usa el rol
  // para saber si hace falta esperar.
  const necesitaEsperar = staffAssignmentPermission(viewerRole).teamSource === 'own_coordinated_teams';
  if (necesitaEsperar && coordinados == null) return null;
  if (!canAssignStaffToTeam(viewerRole, teamId, coordinados ?? null)) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!online}
        className="rounded-full bg-[#0F1B2E] px-3 py-1.5 active:opacity-80"
        style={!online ? { opacity: 0.5 } : undefined}
      >
        <Text className="text-xs font-medium text-white">{t('staff.add.action')}</Text>
      </Pressable>
      <AddStaffModal
        visible={open}
        teamId={teamId}
        onClose={() => setOpen(false)}
        onDone={refresh}
      />
    </>
  );
}

function AddStaffModal({
  visible,
  teamId,
  onClose,
  onDone,
}: {
  visible: boolean;
  teamId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const online = useIsOnline();

  const clubId = activeClub?.club.id ?? null;
  const viewerRole = activeClub?.role ?? null;

  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [staffRole, setStaffRole] = useState<TeamStaffRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const roles = useMemo(() => staffAssignmentPermission(viewerRole).roles, [viewerRole]);

  const { data: candidatos } = useCached<StaffCandidate[]>(
    clubScopedCacheKey('dir-candidatos-staff', clubId ?? 'none'),
    (sb) =>
      clubId
        ? getStaffCandidatesFromClient(sb, clubId, (e) =>
            reportDataError('add-staff-candidates', e),
          )
        : Promise.resolve([]),
  );

  // Referencia ESTABLE, no un `candidatos ?? []` nuevo cada render: `submit` la usa
  // para sacar el nombre del elegido, y sin esto cambiaría sus dependencias en cada
  // pintado (lo caza `react-hooks/exhaustive-deps`). Mismo patrón que `coaches` en
  // la lista de dirección.
  const gente = useMemo(() => candidatos ?? [], [candidatos]);

  const close = useCallback(() => {
    if (saving) return;
    setMembershipId(null);
    setStaffRole(null);
    setError(null);
    setDone(null);
    onClose();
  }, [saving, onClose]);

  const submit = useCallback(async () => {
    if (!online || saving || !membershipId || !staffRole) return; // write-guard
    const elegido = gente.find((c) => c.membershipId === membershipId);
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
        setDone(elegido?.fullName ?? '');
        onDone();
      } else {
        setError(claveDeError(json.error));
      }
    } catch {
      // no_web_url / no_session / red caída a mitad.
      setError('generic');
    } finally {
      setSaving(false);
    }
  }, [online, saving, membershipId, staffRole, teamId, gente, onDone]);

  const puede = online && !saving && membershipId != null && staffRole != null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="max-h-[80%] w-full max-w-md rounded-2xl bg-white p-5">
          <Text className="text-lg font-bold text-[#0F1B2E]">{t('staff.add.title')}</Text>

          {done !== null ? (
            <>
              <Text className="mt-2 text-sm text-zinc-700">
                {t('staff.add.done', { name: done })}
              </Text>
              <View className="mt-4 flex-row justify-end">
                <Pressable
                  onPress={close}
                  className="rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-white">
                    {t('staff.add.close')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className="mt-2 text-sm text-zinc-600">{t('staff.add.description')}</Text>

              {gente.length === 0 ? (
                <Text className="mt-4 text-sm text-zinc-500">{t('staff.add.empty')}</Text>
              ) : (
                <ScrollView className="mt-3" keyboardShouldPersistTaps="handled">
                  <Text className="text-xs font-medium text-zinc-500">
                    {t('staff.add.field.member')}
                  </Text>
                  <View className="mt-1 overflow-hidden rounded-xl border border-zinc-200">
                    {gente.map((c, i) => (
                      <Pressable
                        key={c.membershipId}
                        onPress={() => setMembershipId(c.membershipId)}
                        className={`flex-row items-center gap-2 px-3 py-2.5 active:opacity-70 ${
                          i > 0 ? 'border-t border-zinc-100' : ''
                        } ${membershipId === c.membershipId ? 'bg-zinc-100' : ''}`}
                      >
                        <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                          {c.fullName}
                        </Text>
                        <Text className="text-xs text-zinc-400" numberOfLines={1}>
                          {/* `roles`, NO `club_role`: ese namespace solo tiene
                              las dos funciones de entrenador (existe para la lista
                              de W-2, cuyos datos nunca traen otra cosa). Aquí los
                              candidatos pueden ser admin_club, director o
                              coordinador, y con `club_role` la etiqueta salía en
                              crudo. Es el namespace que usa el diálogo de la web. */}
                          {t(`roles.${c.clubRole}`)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text className="mt-4 text-xs font-medium text-zinc-500">
                    {t('staff.add.field.staff_role')}
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
                  {t(`staff.add.errors.${error}`)}
                </Text>
              ) : null}
              {!online ? (
                <Text className="mt-3 text-xs text-zinc-500">{t('staff.add.offline')}</Text>
              ) : null}

              <View className="mt-4 flex-row justify-end gap-2">
                <Pressable
                  onPress={close}
                  disabled={saving}
                  className="rounded-full px-4 py-2 active:opacity-60"
                >
                  <Text className="text-sm text-zinc-500">{t('staff.add.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={!puede}
                  className="flex-row items-center gap-2 rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                  style={!puede ? { opacity: 0.5 } : undefined}
                >
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text className="text-sm font-semibold text-white">
                    {saving ? t('staff.add.saving') : t('staff.add.save')}
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
