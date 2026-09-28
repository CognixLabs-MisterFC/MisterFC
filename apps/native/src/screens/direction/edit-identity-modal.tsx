import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import {
  STAFF_NAME_MAX,
  updateStaffContactFromClient,
  updateStaffNameFromClient,
  type StaffContact,
  type StaffIdentityError,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useIsOnline } from '@/data/connectivity';
import { KeyboardModalView } from '@/ui/keyboard';
import { useTranslations } from '@/locale/provider';

/**
 * W-4 — editar el NOMBRE o el CONTACTO de un miembro del cuerpo técnico, desde la
 * ficha de dirección.
 *
 * SIN ENDPOINT, y es el primero de la serie que no lo lleva. El permiso vive DENTRO
 * de `admin_update_staff_profile` y `admin_update_staff_contact` (SECURITY DEFINER),
 * que se invocan COMO EL USUARIO: la app llama al RPC con su propia sesión igual que
 * la web. Un route handler aquí no añadiría ningún gate, solo una capa.
 *
 * Quién ve el botón lo decide `canEditStaffIdentityOf` (core), NO esta pantalla. Y
 * ojo: ese permiso no es el de asignar roles — el coordinador entra en aquél y no en
 * éste, porque «la identidad es más sensible» (lo dicen las dos funciones SQL).
 *
 * Write-guard: sin red no se llama.
 */

type Modo = 'name' | 'contact';

const CODIGOS: readonly StaffIdentityError[] = [
  'name_required',
  'name_too_long',
  'phone_invalid',
  'contact_email_invalid',
  'target_invalid',
  'forbidden',
  'generic',
];

/**
 * Cada modo tiene su propio namespace de textos, y sus errores viven ahí. Un motivo
 * que ese namespace no tenga se enseña como `generic`, que sí está en los dos.
 */
function claveDeError(modo: Modo, code: StaffIdentityError): string {
  const namespace = modo === 'name' ? 'edit_name' : 'edit_contact';
  const propios: Record<Modo, readonly string[]> = {
    name: ['name_required', 'name_too_long', 'target_invalid', 'forbidden', 'generic'],
    contact: ['phone_invalid', 'contact_email_invalid', 'target_invalid', 'forbidden', 'generic'],
  };
  const clave = propios[modo].includes(code) ? code : 'generic';
  return `cuerpo_tecnico.${namespace}.errors.${clave}`;
}

export function EditIdentityModal({
  visible,
  modo,
  targetProfileId,
  nombreActual,
  contactoActual,
  onClose,
  onDone,
}: {
  visible: boolean;
  modo: Modo;
  /** El PERFIL de la persona editada (no su membresía): es lo que piden los RPC. */
  targetProfileId: string;
  nombreActual: string;
  contactoActual: StaffContact | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const online = useIsOnline();
  const clubId = activeClub?.club.id ?? null;

  const [nombre, setNombre] = useState(nombreActual);
  const [telefono, setTelefono] = useState(contactoActual?.phone ?? '');
  const [correo, setCorreo] = useState(contactoActual?.contactEmail ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StaffIdentityError | null>(null);
  const [done, setDone] = useState(false);

  /**
   * CONTRATO con quien lo pinta: este modal se MONTA al abrir y se DESMONTA al
   * cerrar (`{editando ? <EditIdentityModal … /> : null}`), así que cada apertura
   * nace con los valores guardados y no hay que reiniciar nada.
   *
   * Aquí había un `useEffect` que los reponía al volverse visible, y el lint del
   * compilador de React lo rechazó con razón: era un `setState` sincrónico dentro de
   * un efecto, o sea renders en cascada para lograr lo que el desmontaje ya hace.
   *
   * Se reinicia además en `close` —como hacen los modales hermanos— para que siga
   * siendo correcto si alguien lo deja montado con `visible={false}`.
   */
  const close = useCallback(() => {
    if (saving) return;
    setNombre(nombreActual);
    setTelefono(contactoActual?.phone ?? '');
    setCorreo(contactoActual?.contactEmail ?? '');
    setError(null);
    setDone(false);
    onClose();
  }, [saving, onClose, nombreActual, contactoActual]);

  const submit = useCallback(async () => {
    if (!online || saving || !clubId) return; // write-guard
    setSaving(true);
    setError(null);
    const res =
      modo === 'name'
        ? await updateStaffNameFromClient(supabase, {
            clubId,
            targetProfileId,
            fullName: nombre,
          })
        : await updateStaffContactFromClient(supabase, {
            clubId,
            targetProfileId,
            phone: telefono,
            contactEmail: correo,
          });
    setSaving(false);
    if (res.ok) {
      setDone(true);
      onDone();
    } else {
      setError(res.error);
    }
  }, [online, saving, clubId, modo, targetProfileId, nombre, telefono, correo, onDone]);

  const ns = modo === 'name' ? 'edit_name' : 'edit_contact';
  const puede = online && !saving && (modo === 'contact' || nombre.trim().length > 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardModalView className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-md rounded-2xl bg-white p-5">
          <Text className="text-lg font-bold text-[#0F1B2E]">
            {t(`cuerpo_tecnico.${ns}.title`)}
          </Text>

          {done ? (
            <>
              <Text className="mt-2 text-sm text-zinc-700">
                {t(`cuerpo_tecnico.${ns}.done`)}
              </Text>
              <View className="mt-4 flex-row justify-end">
                <Pressable
                  onPress={close}
                  className="rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-white">
                    {t(`cuerpo_tecnico.${ns}.close`)}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className="mt-2 text-sm text-zinc-600">
                {t(`cuerpo_tecnico.${ns}.description`)}
              </Text>

              {modo === 'name' ? (
                <>
                  <Text className="mt-3 text-xs font-medium text-zinc-500">
                    {t('cuerpo_tecnico.edit_name.field.name')}
                  </Text>
                  <TextInput
                    value={nombre}
                    onChangeText={setNombre}
                    maxLength={STAFF_NAME_MAX}
                    editable={!saving}
                    autoCapitalize="words"
                    className="mt-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
                  />
                </>
              ) : (
                <>
                  <Text className="mt-3 text-xs font-medium text-zinc-500">
                    {t('cuerpo_tecnico.edit_contact.field.phone')}
                  </Text>
                  <TextInput
                    value={telefono}
                    onChangeText={setTelefono}
                    keyboardType="phone-pad"
                    maxLength={32}
                    editable={!saving}
                    className="mt-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
                  />
                  <Text className="mt-3 text-xs font-medium text-zinc-500">
                    {t('cuerpo_tecnico.edit_contact.field.contact_email')}
                  </Text>
                  <TextInput
                    value={correo}
                    onChangeText={setCorreo}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={254}
                    editable={!saving}
                    className="mt-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
                  />
                  <Text className="mt-1 text-[11px] text-zinc-400">
                    {t('cuerpo_tecnico.edit_contact.field.contact_email_hint')}
                  </Text>
                </>
              )}

              {error ? (
                <Text className="mt-3 text-xs text-red-600">{t(claveDeError(modo, error))}</Text>
              ) : null}
              {!online ? (
                <Text className="mt-3 text-xs text-zinc-500">
                  {t(`cuerpo_tecnico.${ns}.offline`)}
                </Text>
              ) : null}

              <View className="mt-4 flex-row justify-end gap-2">
                <Pressable
                  onPress={close}
                  disabled={saving}
                  className="rounded-full px-4 py-2 active:opacity-60"
                >
                  <Text className="text-sm text-zinc-500">
                    {t(`cuerpo_tecnico.${ns}.cancel`)}
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
                      ? t(`cuerpo_tecnico.${ns}.saving`)
                      : t(`cuerpo_tecnico.${ns}.save`)}
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

/** Los códigos que el modal sabe traducir; lo usa su test. */
export const CODIGOS_DE_ERROR = CODIGOS;
