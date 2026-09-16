/**
 * Cómo se agrupan y se ordenan los destinatarios de la familia, y qué pasa al tocar
 * uno. Vive aquí y no en la pantalla porque en esta app lo que se prueba es la lógica
 * pura: las pantallas no se renderizan en los tests.
 *
 * NO importa de `@misterfc/core`: el tipo de entrada se declara aquí, estructural. Si
 * el de core cambia de forma, el sitio que los junta —la pantalla— deja de compilar,
 * que es donde queremos enterarnos. Lo que se evita es que un test de lógica pura
 * acabe cargando el cliente de Supabase (la lección de R-3).
 */

/** Estructuralmente `FamilyRecipient` de core. */
export type Recipient = {
  profileId: string;
  fullName: string | null;
  kind: 'club' | 'team';
  staffRole: string;
  teamId: string | null;
  teamName: string | null;
  conversationId: string | null;
};

export type RecipientSection = {
  /** 'team' = el cuerpo técnico de su equipo · 'club' = admin y dirección. */
  kind: 'club' | 'team';
  /** El nombre del equipo en 'team'; null en 'club', que no va por equipo. */
  teamName: string | null;
  data: Recipient[];
};

/**
 * Secciones para la lista. EL EQUIPO PRIMERO, y no es arbitrario: es a quien la
 * familia escribe casi siempre —una duda del entrenamiento, una ausencia— mientras
 * que al club se escribe de cuotas y papeles, que es más raro. Poner primero lo
 * frecuente ahorra un scroll cada vez.
 *
 * Si el jugador está en más de un equipo sale una sección por equipo, con su nombre,
 * porque «Ana, entrenadora» sin decir de qué equipo no distingue nada cuando el chaval
 * sube y baja de categoría.
 *
 * Dentro de cada sección, por nombre. `localeCompare` con 'es' y sin distinguir
 * acentos ni mayúsculas: el mismo criterio que el directorio de staff.
 */
export function recipientSections(recipients: readonly Recipient[]): RecipientSection[] {
  const porNombre = (a: Recipient, b: Recipient) =>
    (a.fullName ?? '').localeCompare(b.fullName ?? '', 'es', { sensitivity: 'base' });

  const equipos = new Map<string, Recipient[]>();
  const club: Recipient[] = [];

  for (const r of recipients) {
    if (r.kind === 'club') {
      club.push(r);
      continue;
    }
    // `teamId` null en una fila de equipo no debería pasar; si pasa, agrupa aparte en
    // vez de perder al destinatario.
    const clave = r.teamId ?? '';
    equipos.set(clave, [...(equipos.get(clave) ?? []), r]);
  }

  const secciones: RecipientSection[] = [...equipos.entries()]
    .map(([, filas]) => ({
      kind: 'team' as const,
      teamName: filas[0]?.teamName ?? null,
      data: [...filas].sort(porNombre),
    }))
    .sort((a, b) => (a.teamName ?? '').localeCompare(b.teamName ?? '', 'es', { sensitivity: 'base' }));

  if (club.length > 0) {
    secciones.push({ kind: 'club', teamName: null, data: [...club].sort(porNombre) });
  }

  return secciones;
}

/**
 * Qué hay que hacer al tocar a alguien. Devolver la decisión —y no que la pantalla
 * mire `conversationId` a mano— es lo que permite probar que NO se crea un hilo que ya
 * existe: abrir dos veces al mismo entrenador tiene que llevar al mismo sitio.
 */
export type TapAction =
  | { action: 'open'; conversationId: string }
  | { action: 'create'; recipientProfileId: string };

export function tapActionFor(recipient: Recipient): TapAction {
  return recipient.conversationId
    ? { action: 'open', conversationId: recipient.conversationId }
    : { action: 'create', recipientProfileId: recipient.profileId };
}

/**
 * Lo que se enseña debajo del nombre. Preferimos el rol concreto (`entrenador_principal`,
 * `delegado`, `director`…) porque es lo que le dice a la familia a quién está
 * escribiendo; el equipo ya lo dice la cabecera de la sección.
 *
 * Devuelve la CLAVE de i18n, no el texto: traducir es de la pantalla.
 */
export function roleLabelKey(recipient: Recipient): string {
  return `mensajes_familia.role.${recipient.staffRole}`;
}
