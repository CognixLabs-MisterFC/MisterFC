import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { EventEditAvailability, LineupRosterPlayer } from '@misterfc/core';
import { useTranslations } from '@/locale/provider';
import { ActorGrid, rosterChip } from './quick-entry';

/**
 * CORREGIR un evento del directo desde la app: borrar, cambiar el minuto, cambiar el
 * actor. Hasta ahora esto solo existía en web, así que un gol apuntado al jugador
 * equivocado obligaba a abrir el ordenador.
 *
 * SOLO CON RED (write-guard de la casa, el mismo de la alineación y del reloj): los
 * botones SE VEN y avisan de que hace falta conexión, en vez de desaparecer. Una
 * corrección no se encola — las tres operaciones leen la fila en el servidor antes de
 * escribir, y la cola está diseñada para altas idempotentes, no para ediciones
 * ordenadas.
 *
 * Esta hoja NO decide si se puede: recibe `availability` ya calculada por
 * `eventEditAvailability` (core, con sus tests). Aquí solo se pinta y se recoge lo que
 * el entrenador toca.
 *
 * El borrado va en DOS toques (`Borrar evento` → `Sí, borrar`) y no con un diálogo del
 * sistema: es la misma figura que `reopen_confirm` en el control del reloj, y mantiene
 * la confirmación dentro de la hoja, donde el entrenador está mirando.
 */
export function EventEditSheet({
  evento,
  roster,
  availability,
  accent,
  busy,
  errorKey,
  onDelete,
  onMinute,
  onActor,
  onClose,
}: {
  evento: { id: string; type: string; side: 'own' | 'rival'; displayMinute: number };
  roster: LineupRosterPlayer[];
  availability: EventEditAvailability;
  accent: string;
  busy: boolean;
  errorKey: string | null;
  onDelete: () => void;
  onMinute: (minute: number) => void;
  onActor: (actor: { playerId?: string; rivalDorsal?: number }) => void;
  onClose: () => void;
}) {
  const t = useTranslations('');
  const [minuto, setMinuto] = useState(String(evento.displayMinute));
  const [dorsal, setDorsal] = useState('');
  const [confirmando, setConfirmando] = useState(false);

  // Solo se escribe con 'edit'. Con 'offline' los controles se ven, deshabilitados y
  // con su aviso; con los otros dos la hoja ni ofrece la operación.
  const puede = availability === 'edit' && !busy;
  const atenuado = { opacity: puede ? 1 : 0.4 };

  const guardarMinuto = () => {
    const n = Number.parseInt(minuto, 10);
    // El rango lo vuelve a comprobar el esquema de core; aquí solo se evita mandar
    // una llamada que ya se sabe inválida.
    if (Number.isInteger(n) && n >= 0 && n <= 130) onMinute(n);
  };

  const guardarDorsal = () => {
    const n = Number.parseInt(dorsal, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 99) onActor({ rivalDorsal: n });
  };

  return (
    <View className="rounded-2xl border border-zinc-200 p-4" style={{ gap: 12 }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {`${t('directo_edit.title')} · ${t(`directo.event.${evento.type}`)} ${t('directo.minute', { minute: evento.displayMinute })}`}
        </Text>
        <Pressable onPress={onClose} className="px-2 py-1 active:opacity-60">
          <Text className="text-xs text-zinc-500">{t('directo_entry.cancel')}</Text>
        </Pressable>
      </View>

      {/* El aviso dice CUÁL de los dos casos es, no la misma frase para los dos. */}
      {availability === 'no_permission' ? (
        <Banner text={t('directo_control.no_permission')} />
      ) : availability === 'not_editable' ? (
        <Banner text={t('directo_edit.not_editable')} />
      ) : availability === 'offline' ? (
        <Banner text={t('directo_edit.offline')} />
      ) : null}

      {errorKey ? (
        <View className="rounded-xl bg-red-50 px-4 py-2">
          <Text className="text-center text-xs text-red-600">{t(errorKey)}</Text>
        </View>
      ) : null}

      {availability === 'no_permission' || availability === 'not_editable' ? null : (
        <>
          {/* ── Minuto ── */}
          <View style={{ gap: 6 }}>
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {t('directo_edit.minute_label')}
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={minuto}
                onChangeText={setMinuto}
                editable={puede}
                keyboardType="number-pad"
                maxLength={3}
                className="w-20 rounded-xl border border-zinc-200 px-3 py-2 text-center text-sm"
                style={atenuado}
              />
              <Pressable
                disabled={!puede}
                onPress={guardarMinuto}
                className="rounded-full px-4 py-2 active:opacity-70"
                style={{ backgroundColor: accent, ...atenuado }}
              >
                <Text className="text-sm font-semibold text-white">{t('directo_edit.save')}</Text>
              </Pressable>
            </View>
          </View>

          {/* ── Actor: jugador propio, o dorsal si el evento es del rival ── */}
          {evento.side === 'own' ? (
            // La MISMA rejilla de la entrada rápida (`ActorGrid` + `rosterChip`): el
            // entrenador elige jugador igual que cuando lo apunta.
            <ActorGrid
              title={t('directo_entry.pick_player')}
              players={roster.map((r) => rosterChip(r, t))}
              onPick={(playerId) => onActor({ playerId })}
              accent={accent}
              empty={t('directo_entry.no_field_players')}
              disabled={!puede}
            />
          ) : (
            <View style={{ gap: 6 }}>
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                {t('directo_entry.rival_dorsal')}
              </Text>
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={dorsal}
                  onChangeText={setDorsal}
                  editable={puede}
                  keyboardType="number-pad"
                  maxLength={2}
                  className="w-20 rounded-xl border border-zinc-200 px-3 py-2 text-center text-sm"
                  style={atenuado}
                />
                <Pressable
                  disabled={!puede}
                  onPress={guardarDorsal}
                  className="rounded-full px-4 py-2 active:opacity-70"
                  style={{ backgroundColor: accent, ...atenuado }}
                >
                  <Text className="text-sm font-semibold text-white">{t('directo_edit.save')}</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ── Borrar, en dos toques ── */}
          <Pressable
            disabled={!puede}
            onPress={() => {
              if (confirmando) onDelete();
              else setConfirmando(true);
            }}
            className="self-start rounded-full border border-red-200 px-4 py-2 active:opacity-70"
            style={atenuado}
          >
            <Text className="text-sm font-semibold text-red-600">
              {confirmando ? t('directo_edit.delete_confirm') : t('directo_edit.delete')}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View className="rounded-xl bg-amber-50 px-4 py-2">
      <Text className="text-center text-xs text-amber-700">{text}</Text>
    </View>
  );
}
