import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  getClubStaffFromClient,
  getMemberPlayerLinksFromClient,
  getStaffContactFromClient,
  clubScopedCacheKey,
  canEditStaffIdentityOf,
  canLinkPlayers,
  staffAssignmentPermission,
  type ClubStaffRow,
  type MemberPlayerLinks,
  type StaffContact,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { RoleChip } from '@/screens/staff/hub-parts';
import { useTranslations } from '@/locale/provider';
import { AddRoleModal } from '@/screens/direction/add-role-modal';
import { AddPlayerLinkModal } from '@/screens/direction/add-player-link-modal';
import { EditIdentityModal } from '@/screens/direction/edit-identity-modal';
import { reportDataError } from '@/lib/report-error';

/**
 * O2-11a-2 — FICHA de un miembro del cuerpo técnico (DIRECCIÓN). Reutiliza la
 * lectura club-wide `getClubStaffFromClient` (misma caché club-scoped que la lista) y
 * selecciona la membresía del parámetro. Muestra rol de club y sus asignaciones
 * (equipo·rol de staff).
 *
 * W-2 — y deja AGREGAR ROL, como la ficha de la web. Era la única escritura de esta
 * pantalla; mover y quitar siguen siendo web. Quién ve el botón lo dice
 * `staffAssignmentPermission` (core), no un `role === …` escrito aquí; quién puede de
 * verdad, la RLS del INSERT.
 *
 * W-5 — y muestra los JUGADORES VINCULADOS (hijos y tutelados), con su botón de
 * agregar. Tres permisos distintos conviven ya en esta pantalla y ninguno se reutiliza
 * como atajo: asignar equipos, editar identidad y vincular jugadores.
 *
 * Quién llega hasta aquí: el área 'direction' es SOLO admin_club y director
 * (`navAreaForRole`), y resulta que es el mismo conjunto que `canLinkPlayers` y que el
 * de la RLS de lectura de `player_accounts`. Por eso esta tarjeta no necesita ninguna
 * decisión de privacidad ni puede enseñar una lista recortada sin avisar — lo que sí le
 * pasaría a un coordinador en la página equivalente de la web, que él alcanza.
 */
export function DireccionCoachFichaScreen() {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const { user } = useSession();
  const { membershipId, name } = useLocalSearchParams<{ membershipId?: string; name?: string }>();
  const clubId = activeClub?.club.id ?? null;
  const puedeAsignar = staffAssignmentPermission(activeClub?.role).canAssign;

  const [addOpen, setAddOpen] = useState(false);
  const [editando, setEditando] = useState<'name' | 'contact' | null>(null);
  const puedeVincular = canLinkPlayers(activeClub?.role);

  const { data, fromCache, loading, refresh } = useCached<ClubStaffRow[]>(
    clubScopedCacheKey('dir-cuerpo', clubId ?? 'none'),
    (sb) => (clubId ? getClubStaffFromClient(sb, clubId) : Promise.resolve([])),
  );

  // W-4 — el contacto se pide APARTE y no se mete en `getClubStaffFromClient`: esa
  // lectura es club-wide y su caché es club-scoped, así que añadirle teléfono y
  // correo dejaría el contacto de TODO el cuerpo técnico guardado en el dispositivo
  // por haber abierto una lista. Aquí solo se lee al abrir una ficha.
  const { data: contacto, refresh: refrescarContacto } = useCached<StaffContact | null>(
    clubScopedCacheKey('dir-contacto', membershipId ?? 'none'),
    (sb) =>
      membershipId
        ? getStaffContactFromClient(sb, membershipId, (e) =>
            reportDataError('staff-contact', e),
          )
        : Promise.resolve(null),
  );

  if (loading) return <LoadingScreen />;
  const coach = (data ?? []).find((c) => c.membershipId === membershipId) ?? null;
  if (!coach) return <EmptyState message={t('dir_cuerpo.not_found')} />;

  // W-4 — editar identidad NO es el mismo permiso que asignar: el coordinador
  // entra en aquél y no en éste. Y lleva dentro la regla «no sobre uno mismo», que
  // en W-4 no imponía nadie abajo y desde W-7 (mig 20261111000000) sí: los dos RPC
  // la comprueban. Esto sigue aquí para no ofrecer lo que el servidor rechazaría.
  // Se calcula AQUÍ y no arriba porque necesita el perfil del coach, que sale de la
  // lista ya cargada.
  const puedeEditar = canEditStaffIdentityOf(activeClub?.role, user?.id, coach.profileId);

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
        <View>
          <ScreenTitle>{coach.fullName || name || ''}</ScreenTitle>
          <View className="mt-1 flex-row items-center gap-2">
            <RoleChip label={t(`club_role.${coach.clubRole}`)} />
            {puedeAsignar ? (
              <Pressable
                onPress={() => setAddOpen(true)}
                className="rounded-full bg-[#0F1B2E] px-3 py-1.5 active:opacity-80"
              >
                <Text className="text-xs font-medium text-white">
                  {t('cuerpo_tecnico.add_role.action')}
                </Text>
              </Pressable>
            ) : null}
            {puedeEditar ? (
              <Pressable
                onPress={() => setEditando('name')}
                className="rounded-full border border-zinc-200 px-3 py-1.5 active:opacity-70"
              >
                <Text className="text-xs font-medium text-zinc-600">
                  {t('cuerpo_tecnico.edit_name.action')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* W-4 — CONTACTO gestionado por el club. Solo se pinta a quien puede
            editarlo: no es un dato público ni el email de acceso, y esta ficha es de
            dirección. Se lee aparte de la lista (ver arriba). */}
        {puedeEditar ? (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <View className="mb-2 flex-row items-center justify-between gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t('cuerpo_tecnico.contact.title')}
              </Text>
              <Pressable
                onPress={() => setEditando('contact')}
                className="rounded-full border border-zinc-200 px-3 py-1 active:opacity-70"
              >
                <Text className="text-xs font-medium text-zinc-600">
                  {t('cuerpo_tecnico.edit_contact.action')}
                </Text>
              </Pressable>
            </View>
            <Text className="text-sm text-[#0F1B2E]">
              {contacto?.phone || t('cuerpo_tecnico.contact.empty')}
            </Text>
            <Text className="mt-0.5 text-sm text-[#0F1B2E]">
              {contacto?.contactEmail || t('cuerpo_tecnico.contact.empty')}
            </Text>
          </View>
        ) : null}

        <View className="rounded-2xl border border-zinc-200 p-4">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('dir_cuerpo.assignments')}
          </Text>
          {coach.assignments.length === 0 ? (
            <Text className="text-sm text-zinc-400">{t('dir_cuerpo.no_team')}</Text>
          ) : (
            coach.assignments.map((a, i) => (
              <View
                key={a.teamStaffId}
                className={`flex-row items-center gap-3 py-2 ${i > 0 ? 'border-t border-zinc-100' : ''}`}
              >
                <View className="h-3 w-3 rounded-full" style={{ backgroundColor: a.teamColor }} />
                <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                  {a.teamName}
                </Text>
                <RoleChip label={t(`staff_role.${a.staffRole}`)} />
              </View>
            ))
          )}
        </View>

        {/* W-5 — hijos y tutelados. Es un componente aparte a propósito: su lectura
            necesita el PERFIL del coach, que solo se conoce después de resolverlo, y
            un hook no puede ir detrás de los `return` de arriba. Montarlo aquí es lo
            que hace imposible ese error de orden. */}
        {membershipId ? (
          <TarjetaVinculos
            membershipId={membershipId}
            profileId={coach.profileId}
            clubId={clubId}
            puedeVincular={puedeVincular}
          />
        ) : null}
      </ScrollView>

      {editando ? (
        <EditIdentityModal
          visible
          modo={editando}
          targetProfileId={coach.profileId}
          nombreActual={coach.fullName}
          contactoActual={contacto ?? null}
          onClose={() => setEditando(null)}
          onDone={() => {
            refresh();
            refrescarContacto();
          }}
        />
      ) : null}

      {membershipId ? (
        <AddRoleModal
          visible={addOpen}
          membershipId={membershipId}
          personName={coach.fullName || name || ''}
          onClose={() => setAddOpen(false)}
          onDone={refresh}
        />
      ) : null}
    </View>
  );
}

/**
 * Los jugadores vinculados a esta persona, y el botón de agregar.
 *
 * Lectura APARTE de `getClubStaffFromClient` y con su propia clave de caché, como el
 * contacto de W-4 y por el mismo motivo: esa lectura es club-wide y su caché también,
 * así que meter aquí los hijos de cada miembro dejaría en el dispositivo el censo de
 * familias del club entero por haber abierto una lista.
 */
function TarjetaVinculos({
  membershipId,
  profileId,
  clubId,
  puedeVincular,
}: {
  membershipId: string;
  profileId: string;
  clubId: string | null;
  puedeVincular: boolean;
}) {
  const t = useTranslations('');
  const online = useIsOnline();
  const [abierto, setAbierto] = useState(false);

  const { data, refresh } = useCached<MemberPlayerLinks>(
    clubScopedCacheKey('dir-vinculos', membershipId),
    (sb) =>
      clubId
        ? getMemberPlayerLinksFromClient(sb, { clubId, profileId }, (e) =>
            reportDataError('member-player-links', e),
          )
        : Promise.resolve({ linked: [], candidates: [] }),
  );

  const vinculados = data?.linked ?? [];
  const candidatos = data?.candidates ?? [];

  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <View className="mb-2 flex-row items-center justify-between gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('cuerpo_tecnico.players.title')}
        </Text>
        {puedeVincular ? (
          <Pressable
            onPress={() => setAbierto(true)}
            disabled={!online}
            className="rounded-full border border-zinc-200 px-3 py-1 active:opacity-70"
            style={!online ? { opacity: 0.5 } : undefined}
          >
            <Text className="text-xs font-medium text-zinc-600">
              {t('cuerpo_tecnico.players.add.action')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {vinculados.length === 0 ? (
        <Text className="text-sm text-zinc-400">{t('cuerpo_tecnico.players.empty')}</Text>
      ) : (
        vinculados.map((l, i) => (
          <View
            key={l.linkId}
            className={`flex-row items-center gap-3 py-2 ${
              i > 0 ? 'border-t border-zinc-100' : ''
            }`}
          >
            <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
              {l.fullName}
            </Text>
            {/* Los tres valores del CHECK tienen texto, `self` incluido: un miembro
                del club puede ser además jugador adulto con cuenta propia. */}
            <Text className="text-xs text-zinc-400">
              {t(`cuerpo_tecnico.players.relation.${l.relation}`)}
            </Text>
          </View>
        ))
      )}

      {abierto ? (
        <AddPlayerLinkModal
          visible
          membershipId={membershipId}
          candidatos={candidatos}
          onClose={() => setAbierto(false)}
          onDone={refresh}
        />
      ) : null}
    </View>
  );
}
