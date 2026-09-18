import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
  REVOCABLE_CONSENT_TYPES,
  getAcceptedLegalDocumentFromClient,
  getLegalDocumentToSignFromClient,
  getTutorConsentOptionsFromClient,
  getTutorConsentsFromClient,
  grantPlayerConsentFromClient,
  revokePlayerConsentFromClient,
  type AcceptedLegalDocument,
  type ConsentOption,
  type ConsentType,
  type TutorConsent,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { invalidateAfterWrite } from '@/data/cache-resources';
import { useTranslations } from '@/locale/provider';
import {
  consentSections,
  consentTypeKey,
  grantEffectKey,
  revokeEffectKey,
  type ConsentRow,
  type OptionRow,
} from '@/consents/rows';

/**
 * «Permisos que has dado»: consultar, retirar y CONCEDER, en una sola tarjeta dentro de
 * Perfil, que es la pantalla COMPARTIDA por las cuatro áreas.
 *
 * Perfil y no una pantalla propia porque es donde el tutor ya va a cambiar sus datos,
 * y porque no hace falta gatear por rol: las dos lecturas devuelven CERO filas a quien
 * no es tutor de nadie, así que al cuerpo técnico no se le pinta nada. La ausencia de
 * la tarjeta es el resultado correcto de la consulta, no una condición escrita aparte
 * que pueda desincronizarse.
 *
 * LO QUE SÍ SE PINTA SIEMPRE ES EL FALLO. Una lista vacía y una lectura rota no
 * pueden verse igual: decirle «no has firmado nada» a quien sí firmó es, en un
 * documento de RGPD, la frase que no se puede soltar por equivocación. Vacía = nada;
 * rota = una tarjeta que lo dice.
 *
 * RV-3 — dos lecturas y no una, porque son dos preguntas. El LEDGER responde por los
 * dos documentos de la cuenta; la REJILLA responde, por cada hijo, en qué estado están
 * los tres permisos opcionales — incluido «nunca se decidió», que el ledger no puede
 * contar porque no tiene fila. Ese era el agujero: sin la rejilla, un permiso que nunca
 * se dio no se podía dar, y desde #622 eso significa una foto que no se ve nunca.
 *
 * CONCEDER SE HACE COMO EL ALTA: se enseña el texto COMPLETO, se acepta, y se sella la
 * versión aceptada. El botón de aceptar no existe hasta que el texto está en pantalla
 * —no se puede consentir lo que no se ha podido leer— y si el club no ha publicado ese
 * documento no hay nada que conceder: la tarjeta lo dice, porque eso se arregla en el
 * club.
 */
type DocState =
  | { loading: true }
  | { loading: false; doc: AcceptedLegalDocument }
  | { loading: false; error: string };

type GrantState = { row: OptionRow; text: DocState };

export function ConsentsCard() {
  const t = useTranslations('consentimientos');
  const { activeClub } = useApp();
  const { user } = useSession();
  const online = useIsOnline();

  const clubId = activeClub?.club.id ?? null;
  const userId = user?.id ?? null;

  // Las dos lecturas son POR CLUB, igual que en la web: se ven los permisos del club
  // activo. Y `activeClub` puede ser null de verdad — un seguidor puro no tiene ninguno,
  // y Perfil es la misma pantalla para las cuatro áreas. En ese caso no se pregunta nada
  // y se devuelven las listas vacías, que es la respuesta correcta: un seguidor no es
  // tutor. La clave centinela conserva el recurso `consents`, así que la invalidación la
  // sigue alcanzando.
  //
  // Van en UN solo recurso cacheado a propósito: son la misma pantalla y tienen que
  // refrescarse juntas. Con dos claves, una concesión podía dejar la rejilla nueva junto
  // al ledger viejo, que es la forma más rápida de pintar dos estados distintos del
  // mismo permiso.
  const { data, refresh } = useCached(
    clubId && userId ? `consents.${clubId}.${userId}` : 'consents.sin-club',
    async (): Promise<{
      ok: boolean;
      reason?: 'no_session' | 'error';
      ledger: TutorConsent[];
      options: ConsentOption[];
    }> => {
      if (!clubId) return { ok: true, ledger: [], options: [] };
      const [led, opt] = await Promise.all([
        getTutorConsentsFromClient(supabase, clubId),
        getTutorConsentOptionsFromClient(supabase, clubId),
      ]);
      // Si CUALQUIERA de las dos falla se pinta el fallo. Media pantalla de permisos es
      // peor que ninguna: no se distingue de la pantalla entera.
      if (!led.ok) return { ok: false, reason: led.reason, ledger: [], options: [] };
      if (!opt.ok) return { ok: false, reason: opt.reason, ledger: [], options: [] };
      return { ok: true, ledger: led.consents, options: opt.options };
    },
  );

  const [doc, setDoc] = useState<DocState | null>(null);
  const [confirm, setConfirm] = useState<OptionRow | null>(null);
  const [grant, setGrant] = useState<GrantState | null>(null);
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

  const secciones = consentSections(
    { ledger: data.ledger, options: data.options },
    { revocableTypes: REVOCABLE_CONSENT_TYPES },
  );

  // Cero consentimientos y cero opciones = no es tutor de nadie. No es un vacío que
  // haya que explicar.
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

  /** Abre la concesión y trae el texto vigente COMPLETO. Sin texto no hay botón. */
  async function abrirConcesion(row: OptionRow) {
    if (!row.currentDocumentId) return;
    setError(null);
    setGrant({ row, text: { loading: true } });
    const res = await getLegalDocumentToSignFromClient(supabase, row.currentDocumentId);
    const siguiente: DocState = res.ok
      ? { loading: false, doc: res.document }
      : { loading: false, error: t(res.reason === 'not_found' ? 'doc_not_found' : 'doc_error') };
    // Si mientras llegaba el texto se cerró el modal o se abrió OTRO permiso, este
    // resultado ya no es de lo que hay en pantalla.
    setGrant((prev) => (prev && prev.row === row ? { row, text: siguiente } : prev));
  }

  async function retirar(row: OptionRow) {
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

  async function conceder(row: OptionRow) {
    if (!row.currentDocumentId) return;
    setBusy(true);
    setError(null);
    const res = await grantPlayerConsentFromClient(
      supabase,
      row.playerId,
      row.consentType as ConsentType,
      row.currentDocumentId,
    );
    setBusy(false);
    if (!res.ok) {
      setError(t(`grant_errors.${res.reason}`));
      // El club publicó otra versión mientras el modal estaba abierto: lo que hay en
      // pantalla ya no es el texto vigente, así que se recarga para que el siguiente
      // intento vaya sobre el nuevo.
      if (res.reason === 'document_changed') refresh();
      return;
    }
    setGrant(null);
    void invalidateAfterWrite('grantConsent');
    refresh();
  }

  /** Las filas de solo lectura: la cuenta y el histórico. */
  function filaLectura(row: ConsentRow, prefijo: string) {
    return (
      <View
        key={`${prefijo}.${row.consentType}`}
        className="gap-1 rounded-xl border border-zinc-100 bg-zinc-50 p-3"
      >
        <Text className="text-sm text-[#0F1B2E]">{row.title}</Text>
        <Text className="text-xs text-zinc-500">
          {t(row.granted ? 'granted' : 'revoked')} · {formatDate(row.acceptedAt)}
        </Text>
        <View className="mt-1 flex-row items-center gap-4">
          <Pressable onPress={() => void verTexto(row.legalDocumentId)}>
            <Text className="text-xs font-medium text-[#0F1B2E] underline">{t('view_text')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-2">
      <Text className="text-sm text-zinc-400">{t('section_title')}</Text>

      <View className="gap-3 rounded-2xl border border-zinc-200 p-4">
        <Text className="text-xs text-zinc-500">{t('intro')}</Text>

        {secciones.map((sec) => (
          <View key={sec.kind === 'account' ? 'cuenta' : `${sec.kind}.${sec.playerId}`} className="gap-2">
            <Text className="text-sm font-semibold text-[#0F1B2E]">
              {sec.kind === 'account'
                ? t('account_group')
                : (sec.playerName ?? t('child_unnamed'))}
            </Text>

            {sec.kind === 'past' && (
              <Text className="text-xs text-zinc-500">{t('no_longer_managed')}</Text>
            )}

            {sec.kind === 'account' || sec.kind === 'past'
              ? sec.rows.map((row) =>
                  filaLectura(row, sec.kind === 'account' ? 'cuenta' : sec.playerId),
                )
              : sec.rows.map((row) => (
                  <View
                    key={`${sec.playerId}.${row.consentType}`}
                    className="gap-1 rounded-xl border border-zinc-100 bg-zinc-50 p-3"
                  >
                    <Text className="text-sm text-[#0F1B2E]">
                      {row.title ?? t(consentTypeKey(row.consentType))}
                    </Text>
                    <Text className="text-xs text-zinc-500">
                      {row.state === 'never'
                        ? t('not_decided')
                        : `${t(row.state === 'granted' ? 'granted' : 'revoked')} · ${formatDate(row.decidedAt)}`}
                    </Text>

                    {/* El club no ha publicado el texto: no hay nada que aceptar, y no
                        es cosa de la app. */}
                    {row.needsClubDocument && (
                      <Text className="mt-1 text-xs text-amber-700">{t('needs_club_document')}</Text>
                    )}

                    <View className="mt-1 flex-row items-center gap-4">
                      {row.signedDocumentId && (
                        <Pressable onPress={() => void verTexto(row.signedDocumentId as string)}>
                          <Text className="text-xs font-medium text-[#0F1B2E] underline">
                            {t('view_text')}
                          </Text>
                        </Pressable>
                      )}

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

                      {row.canGrant && (
                        <Pressable onPress={() => void abrirConcesion(row)} disabled={!online}>
                          <Text
                            className={`text-xs font-semibold ${online ? 'text-emerald-700' : 'text-zinc-400'}`}
                          >
                            {t('grant')}
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

      {/* CONCEDER — como el alta: el texto completo delante, y solo entonces el botón.
          El aviso de qué pasa al conceder no es el de retirar al revés, así que cada
          tipo tiene el suyo. */}
      <Modal
        visible={grant !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setGrant(null)}
      >
        <View className="flex-1 justify-center bg-black/50 p-6">
          <View className="max-h-[90%] rounded-2xl bg-white p-5">
            <Text className="text-lg font-bold text-[#0F1B2E]">{t('grant_title')}</Text>

            {grant?.text.loading ? (
              <View className="py-8">
                <ActivityIndicator />
              </View>
            ) : grant && 'error' in grant.text ? (
              // Sin texto no hay botón: no se consiente lo que no se ha podido leer.
              <Text className="mt-3 text-sm text-red-600">{grant.text.error}</Text>
            ) : grant && 'doc' in grant.text ? (
              <>
                <Text className="mt-2 text-sm font-semibold text-[#0F1B2E]">
                  {grant.text.doc.title}
                </Text>
                <ScrollView className="mt-2 max-h-64 rounded-xl bg-zinc-50 p-3">
                  <Text className="text-sm text-zinc-700">{grant.text.doc.body}</Text>
                </ScrollView>

                {(() => {
                  const clave = grantEffectKey(grant.row.consentType);
                  return clave ? (
                    <Text className="mt-3 text-sm text-zinc-600">{t(clave)}</Text>
                  ) : null;
                })()}
                <Text className="mt-2 text-xs text-zinc-500">{t('grant_note')}</Text>
              </>
            ) : null}

            {error && <Text className="mt-2 text-sm text-red-600">{error}</Text>}

            <View className="mt-4 flex-row justify-end gap-4">
              <Pressable onPress={() => setGrant(null)} disabled={busy}>
                <Text className="text-sm text-zinc-500">{t('grant_cancel')}</Text>
              </Pressable>
              {grant && 'doc' in grant.text && (
                <Pressable
                  onPress={() => void conceder(grant.row)}
                  disabled={busy || !online}
                >
                  <View className="flex-row items-center gap-2">
                    {busy && <ActivityIndicator size="small" />}
                    <Text className="text-sm font-semibold text-emerald-700">
                      {t('grant_confirm')}
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirmación de la RETIRADA. Lleva el aviso de QUÉ pasa, que no es lo mismo
          para los tres tipos y no se puede resumir en una frase común. */}
      <Modal
        visible={confirm !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirm(null)}
      >
        <View className="flex-1 justify-center bg-black/50 p-6">
          <View className="rounded-2xl bg-white p-5">
            <Text className="text-lg font-bold text-[#0F1B2E]">{t('revoke_title')}</Text>
            {confirm && (
              <Text className="mt-2 text-sm text-zinc-700">
                {confirm.title ?? t(consentTypeKey(confirm.consentType))}
              </Text>
            )}
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
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
