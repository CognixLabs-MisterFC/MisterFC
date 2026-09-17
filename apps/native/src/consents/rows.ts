/**
 * RV-2 — agrupar y ordenar los consentimientos del tutor para la pantalla de Perfil.
 *
 * PURO y SIN importar de core, igual que `messaging/family-recipients.ts`: ningún test
 * de `apps/native` importa `@misterfc/core` hoy, y no voy a ser yo quien abra esa
 * puerta por una función de ordenación.
 *
 * Por eso la lista de tipos retirables ENTRA COMO PARÁMETRO en vez de reimportarse:
 * la única fuente sigue siendo `REVOCABLE_CONSENT_TYPES` en core, que a su vez tiene
 * un test de contrato contra el `if` de la migración de RV-1. Tres sitios, una sola
 * verdad, y una cadena de tests que se rompe si alguien separa uno.
 */

export type ConsentRowInput = {
  playerId: string | null;
  playerName: string | null;
  consentType: string;
  granted: boolean;
  acceptedAt: string;
  legalDocumentId: string;
  title: string;
};

export type ConsentRow = ConsentRowInput & {
  /** ¿Se le pinta el botón de retirar? Solo si está concedido Y es retirable. */
  canRevoke: boolean;
};

export type ConsentSection = {
  /** `null` = los de la cuenta (T&C, privacidad); si no, el id del hijo. */
  playerId: string | null;
  /** `null` en la sección de la cuenta: el título lo pone la pantalla. */
  playerName: string | null;
  rows: ConsentRow[];
};

/**
 * Orden de los tipos DENTRO de cada grupo. Fijo y escrito a mano a propósito: ordenar
 * por título sería ordenar por una cadena que viene de la base y que cada club escribe
 * como quiere, además de depender del idioma. Este orden va de lo general (lo que se
 * firma al entrar) a lo concreto (lo que se decide por hijo).
 */
const ORDEN: readonly string[] = [
  'terms_conditions',
  'privacy_policy',
  'image_internal',
  'image_social',
  'medical_data_processing',
];

function pesoTipo(t: string): number {
  const i = ORDEN.indexOf(t);
  // Un tipo nuevo que nadie haya añadido aquí cae AL FINAL, no en medio: se ve que
  // sobra, en vez de colarse entre los conocidos como si siempre hubiera estado.
  return i === -1 ? ORDEN.length : i;
}

/**
 * La cuenta primero y después un grupo por hijo.
 *
 * La cuenta va delante porque son los dos documentos que esta persona firmó sobre SÍ
 * MISMA, y porque son los únicos que no se pueden retirar: dejarlos al final, después
 * de varios botones de «Retirar», invita a buscarles uno.
 */
export function consentSections(
  rows: readonly ConsentRowInput[],
  opts: { revocableTypes: readonly string[] },
): ConsentSection[] {
  const cuenta: ConsentRowInput[] = [];
  const porHijo = new Map<string, ConsentRowInput[]>();

  for (const r of rows) {
    if (r.playerId === null) cuenta.push(r);
    else {
      const lista = porHijo.get(r.playerId);
      if (lista) lista.push(r);
      else porHijo.set(r.playerId, [r]);
    }
  }

  const conBoton = (lista: ConsentRowInput[]): ConsentRow[] =>
    [...lista]
      .sort((a, b) => pesoTipo(a.consentType) - pesoTipo(b.consentType))
      .map((r) => ({ ...r, canRevoke: r.granted && opts.revocableTypes.includes(r.consentType) }));

  const secciones: ConsentSection[] = [];
  if (cuenta.length > 0) {
    secciones.push({ playerId: null, playerName: null, rows: conBoton(cuenta) });
  }

  const hijos = [...porHijo.entries()].sort(([idA, a], [idB, b]) => {
    const na = a[0]?.playerName ?? '';
    const nb = b[0]?.playerName ?? '';
    const porNombre = na.localeCompare(nb, 'es', { sensitivity: 'base' });
    // Desempate por id: dos hijos con el mismo nombre (o sin nombre) no pueden
    // cambiar de sitio entre dos renders.
    return porNombre !== 0 ? porNombre : idA.localeCompare(idB);
  });

  for (const [playerId, lista] of hijos) {
    secciones.push({
      playerId,
      playerName: lista.find((r) => r.playerName)?.playerName ?? null,
      rows: conBoton(lista),
    });
  }

  return secciones;
}

/**
 * La clave del aviso de qué pasa al retirar. Devuelve `null` para los tipos sin aviso
 * propio, que hoy no existen — pero un tipo nuevo sin texto NO puede caer en el del
 * vecino: preferimos no decir nada a decir algo falso sobre un dato de un menor.
 */
export function revokeEffectKey(consentType: string): string | null {
  switch (consentType) {
    case 'image_internal':
      return 'revoke_effect.image_internal';
    case 'image_social':
      return 'revoke_effect.image_social';
    case 'medical_data_processing':
      return 'revoke_effect.medical';
    default:
      return null;
  }
}
