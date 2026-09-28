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
import {
  PLAYER_LINK_RELATIONS,
  linkPlayerToMember,
  type LinkPlayerError,
  type PlayerLinkCandidate,
  type PlayerLinkRelation,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useIsOnline } from '@/data/connectivity';
import { KeyboardModalView } from '@/ui/keyboard';
import { useTranslations } from '@/locale/provider';

/**
 * W-5 — "Agregar jugador": vincular un jugador del club a esta persona como hijo o
 * tutelado, desde la ficha de dirección. Sin invitación por correo: ya está dentro.
 *
 * SIN ENDPOINT, como W-4 y por otro motivo. `player_accounts` es una tabla y su gate
 * es la RLS `player_accounts_write_admin`, así que la app escribe con su propia
 * sesión igual que la web con su cookie: las dos llegan como el usuario y las dos
 * pasan por la misma policy. Es lo que ya hacen ocho módulos de core. Un route
 * handler solo añadiría una capa (se midió el de W-2: coge el bearer, construye un
 * cliente RLS-scoped —nunca admin— y llama a core, sin revalidar ni tocar el
 * service-role).
 *
 * Quién ve el botón lo dice `canLinkPlayers` (core), no esta pantalla. Y no es el
 * permiso de asignar equipos: el coordinador entra en aquél y no en éste.
 *
 * Los CANDIDATOS los pasa la ficha, que ya los ha leído para pintar la lista de
 * vinculados. Es la misma lectura y se hace una vez: si el modal releyera, las dos
 * listas podrían discrepar justo en lo que importa (quién ya está vinculado).
 *
 * Write-guard: sin red no se llama.
 */

/**
 * Los seis desenlaces de `linkPlayerToMember`, todos con texto en los tres idiomas.
 *
 * Se exporta para que exista como declaración —el tipo la vigila: si
 * `LinkPlayerError` gana un desenlace, esto deja de compilar—, pero su test la LEE de
 * este fichero como texto en vez de importarla: importar un `.tsx` de la app arrastra
 * `react-native`, y el runner de la nativa no sabe parsearlo (`import typeof`).
 */
export const CODIGOS_DE_ERROR: readonly LinkPlayerError[] = [
  'player_invalid',
  'relation_invalid',
  'cross_club',
  'already_linked',
  'forbidden',
  'generic',
];

export function AddPlayerLinkModal({
  visible,
  membershipId,
  candidatos,
  onClose,
  onDone,
}: {
  visible: boolean;
  membershipId: string;
  candidatos: readonly PlayerLinkCandidate[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('');
  const online = useIsOnline();

  const [busca, setBusca] = useState('');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [relacion, setRelacion] = useState<PlayerLinkRelation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LinkPlayerError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * El filtro existe porque esta lista es el CLUB ENTERO —cientos de jugadores—, y no
   * el puñado de staff de W-3. Sin él, elegir es bajar scroll a ciegas.
   *
   * Sin acentos y sin mayúsculas: quien busca "angel" tiene que encontrar a "Ángel".
   */
  const lista = useMemo(() => {
    const q = normaliza(busca);
    if (q.length === 0) return candidatos;
    return candidatos.filter((c) => normaliza(c.fullName).includes(q));
  }, [busca, candidatos]);

  const close = useCallback(() => {
    if (saving) return;
    setBusca('');
    setPlayerId(null);
    setRelacion(null);
    setError(null);
    setDone(null);
    onClose();
  }, [saving, onClose]);

  const submit = useCallback(async () => {
    if (!online || saving || !playerId || !relacion) return; // write-guard
    const elegido = candidatos.find((c) => c.playerId === playerId);
    setSaving(true);
    setError(null);
    const res = await linkPlayerToMember(supabase, {
      membershipId,
      playerId,
      relation: relacion,
    });
    setSaving(false);
    if (res.ok) {
      setDone(elegido?.fullName ?? '');
      onDone();
    } else {
      setError(res.error);
    }
  }, [online, saving, playerId, relacion, candidatos, membershipId, onDone]);

  const puede = online && !saving && playerId != null && relacion != null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardModalView className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="max-h-[80%] w-full max-w-md rounded-2xl bg-white p-5">
          <Text className="text-lg font-bold text-[#0F1B2E]">
            {t('cuerpo_tecnico.players.add.title')}
          </Text>

          {done !== null ? (
            <>
              <Text className="mt-2 text-sm text-zinc-700">
                {t('cuerpo_tecnico.players.add.done', { name: done })}
              </Text>
              <View className="mt-4 flex-row justify-end">
                <Pressable
                  onPress={close}
                  className="rounded-full bg-[#0F1B2E] px-4 py-2 active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-white">
                    {t('cuerpo_tecnico.players.add.close')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className="mt-2 text-sm text-zinc-600">
                {t('cuerpo_tecnico.players.add.description')}
              </Text>

              {candidatos.length === 0 ? (
                <Text className="mt-4 text-sm text-zinc-500">
                  {t('cuerpo_tecnico.players.add.empty')}
                </Text>
              ) : (
                <ScrollView className="mt-3" keyboardShouldPersistTaps="handled">
                  <Text className="text-xs font-medium text-zinc-500">
                    {t('cuerpo_tecnico.players.add.field.player')}
                  </Text>
                  <TextInput
                    value={busca}
                    onChangeText={setBusca}
                    editable={!saving}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t('cuerpo_tecnico.players.add.field.search_placeholder')}
                    className="mt-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-[#0F1B2E]"
                  />

                  {/* Una lista vacía POR EL FILTRO no dice lo mismo que un club sin
                      jugadores por vincular: son dos textos distintos. */}
                  {lista.length === 0 ? (
                    <Text className="mt-2 text-sm text-zinc-500">
                      {t('cuerpo_tecnico.players.add.no_match')}
                    </Text>
                  ) : (
                    <View className="mt-2 overflow-hidden rounded-xl border border-zinc-200">
                      {lista.map((c, i) => (
                        <Pressable
                          key={c.playerId}
                          onPress={() => setPlayerId(c.playerId)}
                          className={`px-3 py-2.5 active:opacity-70 ${
                            i > 0 ? 'border-t border-zinc-100' : ''
                          } ${playerId === c.playerId ? 'bg-zinc-100' : ''}`}
                        >
                          <Text className="text-sm text-[#0F1B2E]" numberOfLines={1}>
                            {c.fullName}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <Text className="mt-4 text-xs font-medium text-zinc-500">
                    {t('cuerpo_tecnico.players.add.field.relation')}
                  </Text>
                  <View className="mt-1 flex-row flex-wrap gap-2">
                    {PLAYER_LINK_RELATIONS.map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => setRelacion(r)}
                        className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
                          relacion === r
                            ? 'border-[#0F1B2E] bg-[#0F1B2E]'
                            : 'border-zinc-200'
                        }`}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            relacion === r ? 'text-white' : 'text-zinc-600'
                          }`}
                        >
                          {t(`cuerpo_tecnico.players.relation.${r}`)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}

              {error ? (
                <Text className="mt-3 text-xs text-red-600">
                  {t(`cuerpo_tecnico.players.add.errors.${error}`)}
                </Text>
              ) : null}
              {!online ? (
                <Text className="mt-3 text-xs text-zinc-500">
                  {t('cuerpo_tecnico.players.add.offline')}
                </Text>
              ) : null}

              <View className="mt-4 flex-row justify-end gap-2">
                <Pressable
                  onPress={close}
                  disabled={saving}
                  className="rounded-full px-4 py-2 active:opacity-60"
                >
                  <Text className="text-sm text-zinc-500">
                    {t('cuerpo_tecnico.players.add.cancel')}
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
                    {t('cuerpo_tecnico.players.add.save')}
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

/** Minúsculas y sin diacríticos, para que el filtro no dependa de los acentos. */
function normaliza(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
