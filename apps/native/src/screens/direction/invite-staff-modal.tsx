import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { canInviteToClub, invitableRoles, type InvitableRole } from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useIsOnline } from '@/data/connectivity';
import { callServerEndpoint } from '@/lib/server-api';
import { KeyboardModalView } from '@/ui/keyboard';
import { appLocale, useTranslations } from '@/locale/provider';

/**
 * W-6 — "Nueva invitación": dar de alta en el club a alguien que NO está dentro, con
 * su rol, desde la app.
 *
 * ÚNICA pieza de la serie que llama a un ENDPOINT, y no por costumbre: crear la cuenta
 * del invitado y enlazarla exige la service-role, que no puede vivir en un teléfono.
 * W-5 escribe su tabla directamente porque ahí el gate es la RLS; aquí no basta.
 *
 * El flujo entero es el de la web (`performStaffInvite`, en core): mismo enlazado,
 * mismo correo, misma regla de «a una persona se le escribe una vez»
 * (`pendingCoversEmail`). Esta pantalla no decide NADA de eso.
 *
 * QUÉ ROLES SE OFRECEN — `invitableRoles`, que cruza dos permisos distintos:
 *   · quién invita: admin_club o director (el coordinador NO);
 *   · a qué se puede invitar: los roles ALTOS (admin_club, director) son exclusivos
 *     del OWNER del club, que es una columna (`clubs.owner_profile_id`), no un papel.
 * `isOwner` ya viene en `activeClub` —booleano derivado, nunca el id crudo—, así que
 * no hace falta ninguna lectura nueva.
 *
 * Write-guard: sin red no se llama.
 */

/**
 * Los códigos del endpoint traducidos a las claves de este namespace, que son las
 * MISMAS que usa la web.
 *
 * El endpoint distingue `email_invalid` de `role_invalid` —la app puede señalar el
 * campo— y los dos caen en el texto de «revisa los datos», que es el que existe. Un
 * código que no esté aquí sale como `generic`.
 */
const TEXTO_DE_ERROR: Record<string, string> = {
  invalid: 'error_invalid_input',
  invalid_input: 'error_invalid_input',
  email_invalid: 'error_invalid_input',
  role_invalid: 'error_invalid_input',
  forbidden: 'error_forbidden',
  no_club: 'error_no_club',
  generic: 'error_generic',
};

function claveDeError(code: unknown): string {
  return (typeof code === 'string' && TEXTO_DE_ERROR[code]) || 'error_generic';
}

/**
 * El botón, con su candado. Se decide ANTES de pintarlo: a un coordinador no se le
 * ofrece esto, porque `invitations_insert_admin` le responde 42501 y la pantalla le
 * habría prometido algo que no ocurre.
 */
export function InviteStaffAction({
  teamId,
  onDone,
}: {
  /** Equipo al que llega la invitación, o null para «sin equipo». */
  teamId: string | null;
  onDone: () => void;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const online = useIsOnline();
  const [open, setOpen] = useState(false);

  if (!canInviteToClub(activeClub?.role)) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!online}
        className="rounded-full bg-[#0F1B2E] px-3 py-1.5 active:opacity-80"
        style={!online ? { opacity: 0.5 } : undefined}
      >
        <Text className="text-xs font-medium text-white">
          {t('invitations.form.action')}
        </Text>
      </Pressable>
      {open ? (
        <InviteStaffModal
          visible
          teamId={teamId}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}

type Hecho =
  | { clase: 'enviada'; email: string; covered: boolean }
  | { clase: 'ya_esta'; nombre: string; rol: string };

function InviteStaffModal({
  visible,
  teamId,
  onClose,
  onDone,
}: {
  visible: boolean;
  teamId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const online = useIsOnline();

  const [correo, setCorreo] = useState('');
  const [rol, setRol] = useState<InvitableRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);

  const roles = useMemo(
    () =>
      invitableRoles({
        role: activeClub?.role ?? null,
        isOwner: activeClub?.isOwner ?? false,
      }),
    [activeClub?.role, activeClub?.isOwner],
  );

  const close = useCallback(() => {
    if (saving) return;
    setCorreo('');
    setRol(null);
    setError(null);
    setHecho(null);
    onClose();
  }, [saving, onClose]);

  const submit = useCallback(async () => {
    if (!online || saving || !rol || correo.trim().length === 0) return; // write-guard
    setSaving(true);
    setError(null);
    try {
      const res = await callServerEndpoint('/api/staff/invitations', {
        method: 'POST',
        // `appLocale()` y no un hook: es el patrón de la casa para el idioma que
        // viaja al servidor (igual que el auto-invitar de familia). El correo se
        // escribe en el idioma DEL DESTINATARIO si tiene perfil; esto es el de reserva.
        body: { email: correo.trim(), role: rol, teamId, locale: appLocale() },
      });
      let json: {
        error?: unknown;
        status?: unknown;
        email?: unknown;
        covered?: unknown;
        member?: { fullName?: unknown; clubRole?: unknown };
      } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        json = {};
      }
      if (!res.ok) {
        setError(claveDeError(json.error));
        return;
      }
      if (json.status === 'existing_member') {
        // No se ha creado invitación ni ha salido correo: a un miembro ACTIVO la
        // invitación no le cambia el rol, así que prometerlo sería mentir.
        setHecho({
          clase: 'ya_esta',
          nombre: typeof json.member?.fullName === 'string' ? json.member.fullName : '—',
          rol: typeof json.member?.clubRole === 'string' ? json.member.clubRole : '',
        });
      } else {
        setHecho({
          clase: 'enviada',
          email: typeof json.email === 'string' ? json.email : correo.trim(),
          covered: json.covered === true,
        });
      }
      onDone();
    } catch {
      // no_web_url / no_session / red caída a mitad.
      setError('error_generic');
    } finally {
      setSaving(false);
    }
  }, [online, saving, rol, correo, teamId, onDone]);

  const puede = online && !saving && rol != null && correo.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardModalView className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="max-h-[80%] w-full max-w-md rounded-2xl bg-white p-5">
          <Text className="text-lg font-bold text-[#0F1B2E]">
            {t('invitations.new_section_title')}
          </Text>

          {hecho ? (
            <>
              <Text className="mt-2 text-sm text-zinc-700">
                {hecho.clase === 'ya_esta'
                  ? t('invitations.form.existing.body', {
                      name: hecho.nombre,
                      role: hecho.rol ? t(`roles.${hecho.rol}`) : '',
                    })
                  : hecho.covered
                    ? t('invitations.form.ok_covered', { email: hecho.email })
                    : t('invitations.form.ok', { email: hecho.email })}
              </Text>
              <View className="mt-4 flex-row justify-end">
                <Pressable
                  onPress={close}
                  className="rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-white">
                    {t('invitations.form.close')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <ScrollView className="mt-3" keyboardShouldPersistTaps="handled">
                <Text className="text-xs font-medium text-zinc-500">
                  {t('invitations.form.email_label')}
                </Text>
                <TextInput
                  value={correo}
                  onChangeText={setCorreo}
                  editable={!saving}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={254}
                  placeholder={t('invitations.form.email_placeholder')}
                  className="mt-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
                />

                <Text className="mt-4 text-xs font-medium text-zinc-500">
                  {t('invitations.form.role_label')}
                </Text>
                <View className="mt-1 flex-row flex-wrap gap-2">
                  {roles.map((r) => (
                    <Pressable
                      key={r}
                      onPress={() => setRol(r)}
                      className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
                        rol === r ? 'border-[#0F1B2E] bg-[#0F1B2E]' : 'border-zinc-200'
                      }`}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          rol === r ? 'text-white' : 'text-zinc-600'
                        }`}
                      >
                        {/* Las MISMAS etiquetas que el formulario de la web: el rol de
                            club se nombra igual en los dos sitios. */}
                        {t(`invitations.form.role_${r}`)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              {error ? (
                <Text className="mt-3 text-xs text-red-600">
                  {t(`invitations.form.${error}`)}
                </Text>
              ) : null}
              {!online ? (
                <Text className="mt-3 text-xs text-zinc-500">
                  {t('invitations.form.offline')}
                </Text>
              ) : null}

              <View className="mt-4 flex-row justify-end gap-2">
                <Pressable
                  onPress={close}
                  disabled={saving}
                  className="rounded-full px-4 py-2 active:opacity-60"
                >
                  <Text className="text-sm text-zinc-500">
                    {t('invitations.form.cancel')}
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
                      ? t('invitations.form.submitting')
                      : t('invitations.form.submit')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardModalView>
    </Modal>
  );
}

/** Los códigos que el modal sabe traducir; su test los lee de aquí como texto. */
export const CODIGOS_DE_ERROR = TEXTO_DE_ERROR;
