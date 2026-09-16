import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
  REVOCABLE_CONSENT_TYPES,
  getAcceptedLegalDocumentFromClient,
  getTutorConsentsFromClient,
  revokePlayerConsentFromClient,
  type AcceptedLegalDocument,
  type ConsentType,
  type TutorConsent,
  type TutorConsentsResult,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { useTranslations } from '@/locale/provider';
import { consentSections, revokeEffectKey, type ConsentRow } from '@/consents/rows';

/**
 * RV-2 — «Permisos que has dado»: consultar y retirar, en una sola tarjeta dentro de
 * Perfil, que es la pantalla COMPARTIDA por las cuatro áreas.
 *
 * Perfil y no una pantalla propia porque es donde el tutor ya va a cambiar sus datos,
 * y porque no hace falta gatear por rol: `get_tutor_consents` devuelve CERO filas a
 * quien no es tutor de nadie, así que al cuerpo técnico no se le pinta nada. La
 * ausencia de la tarjeta es el resultado correcto de la consulta, no una condición
 * escrita aparte que pueda desincronizarse.
 *
 * LO QUE SÍ SE PINTA SIEMPRE ES EL FALLO. Una lista vacía y una lectura rota no
 * pueden verse igual: decirle «no has firmado nada» a quien sí firmó es, en un
 * documento de RGPD, la frase que no se puede soltar por equivocación. Vacía = nada;
 * rota = una tarjeta que lo dice.
 */
export function ConsentsCard() {
  const t = useTranslations('consentimientos');
  const { activeClub } = useApp();
  const { user } = useSession();
  const online = useIsOnline();

  const clubId = activeClub?.club.id ?? null;
  const userId = user?.id ?? null;

  // `get_tutor_consents` es POR CLUB, igual que en la web: se ven los permisos del club
  // activo. Y `activeClub` puede ser null de verdad — un seguidor puro no tiene ninguno,
  // y Perfil es la misma pantalla para las cuatro áreas. En ese caso no se pregunta nada
  // y se devuelve la lista vacía, que es la respuesta correcta: un seguidor no es tutor.
  // La clave centinela conserva el recurso `consents`, así que la invalidación la sigue
  // alcanzando.
  const { data, refresh } = useCached<TutorConsentsResult>(
    clubId && userId ? `consents.${clubId}.${userId}` : 'consents.sin-club',
    async () =>
      clubId ? getTutorConsentsFromClient(supabase, clubId) : { ok: true, consents: [] },
  );

  const [doc, setDoc] = useState<
    | { loading: true }
    | { loading: false; doc: AcceptedLegalDocument }
    | { loading: false; error: string }
    | null
  >(null);
  const [confirm, setConfirm] = useState<ConsentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  if (!data.ok) {
    return (
      <View className="gap-2">
        <Text className="text-sm text-zinc-400">{t('section_title')}</Text>
        <View className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <Text className="text-sm text-amber-900">{t('load_error')}</Text>
        </View>
      </View>
    );
  }

  const secciones = consentSections(data.consents as TutorConsent[], {
    revocableTypes: REVOCABLE_CONSENT_TYPES,
  });

  // Cero consentimientos = no es tutor de nadie. No es un vacío que haya que explicar.
  if (secciones.length === 0) return null;

  async function verTexto(legalDocumentId: string) {
    setDoc({ loading: true });
    const res = await getAcceptedLegalDocumentFromClient(supabase, legalDocumentId);
    setDoc(
      res.ok
        ? { loading: false, doc: res.document }
        : { loading: false, error: t(res.reason === 'not_found' ? 'doc_not_found' : 'doc_error') },
    );
  }

  async function retirar(row: ConsentRow) {
    if (!row.playerId) return;
    setBusy(true);
    setError(null);
    const res = await revokePlayerConsentFromClient(
      supabase,
      row.playerId,
      row.consentType as ConsentType,
    );
    setBusy(false);
    if (!res.ok) {
      setError(t(`errors.${res.reason}`));
      return;
    }
    setConfirm(null);
    // La retirada cambia cosas que se ven en OTRAS pantallas: la foto del jugador deja
    // de poder leerse del bucket y la ficha médica deja de verse y de escribirse. Sin
    // esto, la plantilla y la gestión seguirían sirviendo lo viejo hasta re-enfocarse.
    void invalidateAfterWrite('revokeConsent');
    refresh();
  }

  return (
    <View className="gap-2">
      <Text className="text-sm text-zinc-400">{t('section_title')}</Text>

      <View className="gap-3 rounded-2xl border border-zinc-200 p-4">
        <Text className="text-xs text-zinc-500">{t('intro')}</Text>

        {secciones.map((sec) => (
          <View key={sec.playerId ?? 'cuenta'} className="gap-2">
            <Text className="text-sm font-semibold text-[#0F1B2E]">
              {sec.playerId === null ? t('account_group') : (sec.playerName ?? t('child_unnamed'))}
            </Text>

            {sec.rows.map((row) => (
              <View
                key={`${sec.playerId ?? 'cuenta'}.${row.consentType}`}
                className="gap-1 rounded-xl border border-zinc-100 bg-zinc-50 p-3"
              >
                <Text className="text-sm text-[#0F1B2E]">{row.title}</Text>
                <Text className="text-xs text-zinc-500">
                  {t(row.granted ? 'granted' : 'revoked')} · {formatDate(row.acceptedAt)}
                </Text>

                <View className="mt-1 flex-row items-center gap-4">
                  <Pressable onPress={() => void verTexto(row.legalDocumentId)}>
                    <Text className="text-xs font-medium text-[#0F1B2E] underline">
                      {t('view_text')}
                    </Text>
                  </Pressable>

                  {row.canRevoke && (
                    <Pressable
                      onPress={() => {
                        setError(null);
                        setConfirm(row);
                      }}
                      disabled={!online}
                    >
                      <Text
                        className={`text-xs font-medium ${online ? 'text-red-600' : 'text-zinc-400'}`}
                      >
                        {t('revoke')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))}

        {/* Write-guard: sin red no se intenta la escritura, y se dice por qué. */}
        {!online && <Text className="text-xs text-amber-600">{t('offline')}</Text>}
      </View>

      {/* El texto EXACTO que se firmó. */}
      <Modal
        visible={doc !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDoc(null)}
      >
        <View className="flex-1 justify-center bg-black/50 p-6">
          <View className="max-h-[85%] rounded-2xl bg-white p-5">
            {doc?.loading ? (
              <View className="py-8">
                <ActivityIndicator />
              </View>
            ) : doc && 'error' in doc ? (
              <Text className="text-sm text-red-600">{doc.error}</Text>
            ) : doc && 'doc' in doc ? (
              <>
                <Text className="text-lg font-bold text-[#0F1B2E]">{doc.doc.title}</Text>
                <ScrollView className="mt-3">
                  <Text className="text-sm text-zinc-700">{doc.doc.body}</Text>
                </ScrollView>
              </>
            ) : null}
            <Pressable className="mt-4 self-end" onPress={() => setDoc(null)}>
              <Text className="text-sm font-semibold text-[#0F1B2E]">{t('close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Confirmación. Lleva el aviso de QUÉ pasa al retirar, que no es lo mismo para
          los tres tipos y no se puede resumir en una frase común. */}
      <Modal
        visible={confirm !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirm(null)}
      >
        <View className="flex-1 justify-center bg-black/50 p-6">
          <View className="rounded-2xl bg-white p-5">
            <Text className="text-lg font-bold text-[#0F1B2E]">{t('revoke_title')}</Text>
            {confirm && <Text className="mt-2 text-sm text-zinc-700">{confirm.title}</Text>}
            {confirm &&
              (() => {
                const clave = revokeEffectKey(confirm.consentType);
                return clave ? (
                  <Text className="mt-2 text-sm text-zinc-600">{t(clave)}</Text>
                ) : null;
              })()}
            <Text className="mt-2 text-xs text-zinc-500">{t('revoke_note')}</Text>

            {error && <Text className="mt-2 text-sm text-red-600">{error}</Text>}

            <View className="mt-4 flex-row justify-end gap-4">
              <Pressable onPress={() => setConfirm(null)} disabled={busy}>
                <Text className="text-sm text-zinc-500">{t('revoke_cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => confirm && void retirar(confirm)}
                disabled={busy || !online}
              >
                <View className="flex-row items-center gap-2">
                  {busy && <ActivityIndicator size="small" />}
                  <Text className="text-sm font-semibold text-red-600">{t('revoke_confirm')}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** DD/MM/AAAA, igual que el resto de fechas de la app. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
