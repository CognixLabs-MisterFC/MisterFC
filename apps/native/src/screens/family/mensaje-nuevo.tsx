import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getFamilyRecipientsFromClient,
  startFamilyConversationFromClient,
  type FamilyRecipient,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { reportDataError } from '@/lib/report-error';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useIsOnline } from '@/data/connectivity';
import {
  recipientSections,
  roleLabelKey,
  tapActionFor,
  type Recipient,
  type RecipientSection,
} from '@/messaging/family-recipients';
import { ChildSelector } from '@/ui/child-selector';
import { LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * La familia elige a quién escribir (migración 20261076000000).
 *
 * QUIÉN SALE EN LA LISTA NO LO DECIDE ESTA PANTALLA. La lista viene de
 * `family_conversation_recipients`, y la RPC que crea el hilo valida contra esa
 * MISMA lista. Si aquí se armara una lista propia, lo que se ofrece y lo que se
 * permite podrían separarse — y el que se separa siempre es el que se ve.
 *
 * DE QUÉ HIJO. El hilo cuelga del JUGADOR, así que un tutor con dos hijos tiene dos
 * conversaciones distintas con el mismo entrenador. El selector va arriba en modo
 * lectura, como en Gestión: escribir al entrenador del hermano equivocado no es
 * grave, pero es confuso y no se ve hasta que contestan.
 *
 * Y NO MIENTE CON LAS LISTAS VACÍAS, que es el defecto que acabamos de quitar del
 * selector del staff: «no hay a quién escribir» (un club sin dirección y un jugador
 * sin equipo) y «no hemos podido mirar» son dos cosas, se pintan distinto, y el fallo
 * además va a Sentry.
 */
export function MensajeNuevoScreen() {
  const t = useTranslations('');
  const router = useRouter();
  const { theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const online = useIsOnline();
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const [sections, setSections] = useState<RecipientSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!playerId) {
        setLoading(false);
        return;
      }
      const res = await getFamilyRecipientsFromClient(supabase, playerId);
      if (!active) return;
      if (res.ok) {
        setSections(recipientSections(res.recipients as Recipient[]));
        setFailed(false);
      } else {
        // `forbidden` y `no_session` también son fallos DE VERDAD aquí: esta pantalla
        // solo se alcanza desde la bandeja de un tutor con su hijo activo, así que si
        // el servidor dice que no, algo va mal y hay que verlo.
        reportDataError('family-recipients', new Error(res.reason));
        setFailed(true);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [playerId]);

  const abrir = useCallback(
    async (recipient: FamilyRecipient) => {
      if (!online || !playerId || busyId) return; // write-guard
      const paso = tapActionFor(recipient as Recipient);
      const titulo = recipient.fullName ?? t(roleLabelKey(recipient as Recipient));

      if (paso.action === 'open') {
        router.push({
          pathname: '/family/mensaje',
          params: { conversationId: paso.conversationId, title: titulo },
        });
        return;
      }

      setBusyId(recipient.profileId);
      setError(null);
      const res = await startFamilyConversationFromClient(
        supabase,
        playerId,
        paso.recipientProfileId,
      );
      setBusyId(null);
      if (!res.ok) {
        reportDataError('family-start-conversation', new Error(res.reason));
        // `forbidden` tiene su propio texto: el destinatario dejó de valer entre que
        // se pintó la lista y se tocó (se fue del club, lo sacaron del equipo). No es
        // un fallo genérico y decirlo así ahorra el "inténtalo de nuevo" inútil.
        setError(
          res.reason === 'forbidden'
            ? t('mensajes_familia.recipient_gone')
            : t('mensajes_familia.start_error'),
        );
        return;
      }
      router.replace({
        pathname: '/family/mensaje',
        params: { conversationId: res.conversationId, title: titulo },
      });
    },
    [online, playerId, busyId, router, t],
  );

  if (!playerId) return <EmptyState message={t('child.none')} />;
  if (loading) return <LoadingScreen />;

  return (
    <View className="flex-1 bg-white">
      <View className="px-4 pt-4">
        <ScreenTitle>{t('mensajes_familia.new_title')}</ScreenTitle>
      </View>
      <View className="flex-row px-4 pb-1 pt-2">
        <ChildSelector readOnly />
      </View>

      {!online ? (
        <Text className="px-4 pb-1 text-xs text-zinc-400">{t('mensajes_familia.offline')}</Text>
      ) : null}
      {error ? <Text className="px-4 pb-1 text-xs text-red-600">{error}</Text> : null}

      {failed ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-sm text-red-600">
            {t('mensajes_familia.load_failed')}
          </Text>
          <Text className="mt-1 text-center text-xs text-zinc-400">
            {t('mensajes_familia.load_failed_hint')}
          </Text>
        </View>
      ) : sections.length === 0 ? (
        // Legítimo: un club sin dirección y un jugador sin equipo no tienen a quién
        // escribir. No es lo mismo que el bloque de arriba y por eso no se parece.
        <EmptyState message={t('mensajes_familia.nobody')} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.profileId}
          contentContainerStyle={{ padding: 16 }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text className="px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {section.kind === 'club'
                ? t('mensajes_familia.group_club')
                : (section.teamName ?? t('mensajes_familia.group_team'))}
            </Text>
          )}
          renderItem={({ item }) => (
            <Row
              recipient={item}
              accent={accent}
              busy={busyId === item.profileId}
              disabled={!online || busyId != null}
              onPress={() => void abrir(item as FamilyRecipient)}
            />
          )}
        />
      )}
    </View>
  );
}

function Row({
  recipient,
  accent,
  busy,
  disabled,
  onPress,
}: {
  recipient: Recipient;
  accent: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTranslations('');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="mt-1 flex-row items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3 active:opacity-70"
      style={disabled && !busy ? { opacity: 0.5 } : undefined}
    >
      <View className="flex-1">
        <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
          {recipient.fullName ?? t(roleLabelKey(recipient))}
        </Text>
        <Text className="text-[10px] uppercase tracking-wide text-zinc-400">
          {t(roleLabelKey(recipient))}
        </Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={accent} /> : null}
    </Pressable>
  );
}
