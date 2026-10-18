import { Text, View } from 'react-native';
import { Section } from './sections';
import type { FichaMedical, FichaNotes } from './staff-reads';
import { formatShortDate } from '@/lib/format-date';

/**
 * Los dos bloques RESERVADOS de la ficha del cuerpo técnico: los datos médicos
 * del jugador y las notas que el staff escribe sobre él.
 *
 * Están aparte de `sections.tsx` a propósito: aquellos los comparten las DOS
 * fichas (la de familia y la de staff) y estos son solo de staff. Un bloque en el
 * módulo compartido es una invitación a montarlo donde no toca, y «donde no toca»
 * aquí quiere decir en la pantalla que abre un padre.
 *
 * Los dos pintan lo MISMO ante las mismas cuatro situaciones, y eso tampoco es
 * estética — es lo único que hace legible una ficha a medias:
 *
 *   cargando            → nada (ya hay un spinner en la pantalla),
 *   sin permiso         → nada: el bloque no existe para quien no puede verlo,
 *   con permiso y vacío → se DICE que no hay nada apuntado,
 *   no se pudo leer     → se DICE, y no se finge un vacío.
 *
 * Esa última es la razón de que reciban `loading` además del valor: sin él, «aún
 * no ha llegado» y «no se pudo leer» son el mismo `null`, y el aviso saldría
 * parpadeando en cada carga.
 */

type T = (key: string, values?: Record<string, string | number>) => string;

export function FichaMedicalSection({
  value,
  loading,
  t,
}: {
  value: FichaMedical | null;
  loading: boolean;
  t: T;
}) {
  if (loading) return null;

  // No se pudo leer (y no había copia guardada): se dice. `loadFichaMedical`
  // lanza en ese caso, así que aquí llega como null y NO como un `forbidden`.
  if (!value) {
    return (
      <Section title={t('gestion.medical_title')}>
        <Text className="text-xs text-red-600">{t('ficha.medical_unavailable')}</Text>
      </Section>
    );
  }

  // Sin acceso: ni el bloque. Puede ser que el jugador no sea de su equipo o que
  // la familia haya retirado el consentimiento de salud; la RPC no dice cuál de
  // las dos, así que la pantalla tampoco se lo inventa.
  if (!value.ok) return null;

  const m = value.medical;
  return (
    <Section title={t('gestion.medical_title')}>
      <Text className="mb-2 text-xs text-zinc-400">{t('jugadores.medical.readonly_hint')}</Text>
      {m === null ? (
        <Text className="text-sm text-zinc-500">{t('gestion.medical_empty')}</Text>
      ) : (
        <View className="gap-1.5">
          <MedicalRow label={t('gestion.medical_allergies')} value={m.allergies} />
          <MedicalRow label={t('gestion.medical_medication')} value={m.medication} />
          <MedicalRow label={t('gestion.medical_conditions')} value={m.medical_conditions} />
          <MedicalRow label={t('gestion.medical_emergency')} value={m.emergency_contact} />
        </View>
      )}
    </Section>
  );
}

/**
 * Un campo médico. Se pintan los CUATRO aunque estén vacíos: el hueco con su
 * etiqueta dice «aquí no hay nada apuntado», que es verdad; esconder la etiqueta
 * dejaría a quien mira sin saber si el campo existe.
 *
 * El contacto de emergencia NO se enlaza como teléfono: es texto libre («la
 * abuela, 600…») y un `tel:` sobre eso marca cualquier cosa. Los números que sí
 * son números están arriba, en el bloque de contacto.
 */
function MedicalRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View>
      <Text className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</Text>
      {value ? (
        <Text className="text-sm text-[#0F1B2E]">{value}</Text>
      ) : (
        <Text className="text-sm text-zinc-400">—</Text>
      )}
    </View>
  );
}

export function FichaNotesSection({
  value,
  loading,
  t,
}: {
  value: FichaNotes | null;
  loading: boolean;
  t: T;
}) {
  if (loading) return null;

  if (!value) {
    return (
      <Section title={t('jugadores.notes.section')}>
        <Text className="text-xs text-red-600">{t('ficha.notes_unavailable')}</Text>
      </Section>
    );
  }

  // Las notas son del cuerpo técnico DEL JUGADOR (más dirección): un entrenador de
  // otro equipo no las ve, y para él el bloque no está.
  if (!value.ok) return null;

  return (
    <Section title={t('jugadores.notes.section')}>
      {value.notes.length === 0 ? (
        <Text className="text-sm text-zinc-500">{t('jugadores.notes.empty')}</Text>
      ) : (
        value.notes.map((n) => (
          <View key={n.id} className="border-b border-zinc-100 py-2">
            <Text className="text-[10px] uppercase tracking-wide text-zinc-400">
              {`${n.authorName ?? ''}${n.authorName ? ' · ' : ''}${formatShortDate(t, n.createdAt)}`}
            </Text>
            <Text className="mt-0.5 text-sm text-[#0F1B2E]">{n.note}</Text>
          </View>
        ))
      )}
    </Section>
  );
}
