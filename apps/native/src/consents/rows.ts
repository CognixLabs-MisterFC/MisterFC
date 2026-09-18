/**
 * Agrupar y ordenar los consentimientos del tutor para la pantalla de Perfil.
 *
 * PURO y SIN importar de core, igual que `messaging/family-recipients.ts`: ningún test
 * de `apps/native` importa `@misterfc/core` hoy, y no voy a ser yo quien abra esa
 * puerta por una función de ordenación.
 *
 * Por eso la lista de tipos retirables ENTRA COMO PARÁMETRO en vez de reimportarse:
 * la única fuente sigue siendo `REVOCABLE_CONSENT_TYPES` en core, que a su vez tiene
 * un test de contrato contra los `if` de las migraciones de RV-1 y RV-3. Tres sitios,
 * una sola verdad, y una cadena de tests que se rompe si alguien separa uno.
 *
 * RV-3 — la pantalla pasa a tener DOS fuentes y no una, porque son dos preguntas:
 *
 *   · el LEDGER (`get_tutor_consents`) dice qué se firmó. Es lo único que puede
 *     responder por los dos documentos de la cuenta (T&C y privacidad).
 *   · la REJILLA (`get_tutor_consent_options`) dice, por cada hijo, en qué estado
 *     están los tres permisos opcionales — incluido `never`, que el ledger no puede
 *     contar porque no tiene fila.
 *
 * Donde las dos hablan del mismo hijo, manda la rejilla: es un superconjunto (siempre
 * tres filas) y es la única que sabe si se puede conceder.
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

export type ConsentOptionInput = {
  playerId: string;
  playerName: string | null;
  consentType: string;
  state: string;
  decidedAt: string | null;
  signedDocumentId: string | null;
  signedDocumentTitle: string | null;
  currentDocumentId: string | null;
  currentDocumentTitle: string | null;
};

/** Una fila de solo lectura: los dos documentos de la cuenta, y el histórico. */
export type ConsentRow = ConsentRowInput;

/** Una fila decidible: uno de los tres permisos opcionales de un hijo. */
export type OptionRow = ConsentOptionInput & {
  /** `null` cuando no hay ni texto firmado ni texto vigente: la pantalla pone el nombre del tipo. */
  title: string | null;
  /** Solo si está concedido Y es retirable. */
  canRevoke: boolean;
  /** Solo si NO está concedido y el club tiene texto publicado. */
  canGrant: boolean;
  /**
   * No está concedido y el club no ha publicado el texto. No es un fallo de la app: no
   * hay documento que aceptar, y eso se arregla en el club. La pantalla lo dice en vez
   * de ofrecer un botón que la base va a rechazar con `no_document`.
   */
  needsClubDocument: boolean;
};

export type ConsentSection =
  /** Los dos documentos que esta persona firmó sobre SÍ MISMA. No se retiran aquí. */
  | { kind: 'account'; rows: ConsentRow[] }
  /** Un hijo cuyos permisos gestiona: los tres opcionales, decididos o no. */
  | { kind: 'child'; playerId: string; playerName: string | null; rows: OptionRow[] }
  /**
   * Un jugador que YA NO gestiona pero sobre el que hay filas suyas en el ledger. El
   * ledger no se borra nunca, así que lo que decidió se sigue viendo — la Política de
   * Privacidad promete eso— pero sin botones, porque el gate ya dice que no.
   */
  | { kind: 'past'; playerId: string; playerName: string | null; rows: ConsentRow[] };

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

function porNombre(a: string | null, b: string | null, idA: string, idB: string): number {
  const cmp = (a ?? '').localeCompare(b ?? '', 'es', { sensitivity: 'base' });
  // Desempate por id: dos hijos con el mismo nombre (o sin nombre) no pueden cambiar
  // de sitio entre dos renders.
  return cmp !== 0 ? cmp : idA.localeCompare(idB);
}

/**
 * La cuenta primero, después un grupo por hijo, y al final los jugadores que ya no
 * gestiona.
 *
 * La cuenta va delante porque son los dos documentos que esta persona firmó sobre SÍ
 * MISMA, y porque son los únicos que no se pueden retirar: dejarlos al final, después
 * de varios botones, invita a buscarles uno.
 */
export function consentSections(
  input: { ledger: readonly ConsentRowInput[]; options: readonly ConsentOptionInput[] },
  opts: { revocableTypes: readonly string[] },
): ConsentSection[] {
  const secciones: ConsentSection[] = [];

  const cuenta = input.ledger
    .filter((r) => r.playerId === null)
    .sort((a, b) => pesoTipo(a.consentType) - pesoTipo(b.consentType));
  if (cuenta.length > 0) secciones.push({ kind: 'account', rows: cuenta });

  // ── Un grupo por hijo, desde la rejilla ──────────────────────────────────────
  const porHijo = new Map<string, ConsentOptionInput[]>();
  for (const o of input.options) {
    const lista = porHijo.get(o.playerId);
    if (lista) lista.push(o);
    else porHijo.set(o.playerId, [o]);
  }

  const hijos = [...porHijo.entries()].sort(([idA, a], [idB, b]) =>
    porNombre(a[0]?.playerName ?? null, b[0]?.playerName ?? null, idA, idB),
  );

  for (const [playerId, lista] of hijos) {
    const rows: OptionRow[] = [...lista]
      .sort((a, b) => pesoTipo(a.consentType) - pesoTipo(b.consentType))
      .map((o) => {
        const concedido = o.state === 'granted';
        const retirable = opts.revocableTypes.includes(o.consentType);
        return {
          ...o,
          title: o.signedDocumentTitle ?? o.currentDocumentTitle,
          canRevoke: concedido && retirable,
          canGrant: !concedido && retirable && o.currentDocumentId !== null,
          needsClubDocument: !concedido && retirable && o.currentDocumentId === null,
        };
      });
    secciones.push({
      kind: 'child',
      playerId,
      playerName: lista.find((o) => o.playerName)?.playerName ?? null,
      rows,
    });
  }

  // ── Y lo que solo está en el ledger: jugadores que ya no gestiona ────────────
  const delLedger = new Map<string, ConsentRowInput[]>();
  for (const r of input.ledger) {
    if (r.playerId === null || porHijo.has(r.playerId)) continue;
    const lista = delLedger.get(r.playerId);
    if (lista) lista.push(r);
    else delLedger.set(r.playerId, [r]);
  }

  const pasados = [...delLedger.entries()].sort(([idA, a], [idB, b]) =>
    porNombre(a[0]?.playerName ?? null, b[0]?.playerName ?? null, idA, idB),
  );

  for (const [playerId, lista] of pasados) {
    secciones.push({
      kind: 'past',
      playerId,
      playerName: lista.find((r) => r.playerName)?.playerName ?? null,
      rows: [...lista].sort((a, b) => pesoTipo(a.consentType) - pesoTipo(b.consentType)),
    });
  }

  return secciones;
}

/**
 * La clave del aviso de qué pasa al RETIRAR. Devuelve `null` para los tipos sin aviso
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

/**
 * Y la de qué pasa al CONCEDER, que no es el mismo texto al revés: la imagen interna
 * enciende la foto al instante, el permiso médico devuelve la lectura Y la escritura de
 * la ficha, y el de redes no enciende nada automático porque no hay nada que publique
 * solo. Misma regla que arriba: sin texto propio, no se dice nada.
 */
export function grantEffectKey(consentType: string): string | null {
  switch (consentType) {
    case 'image_internal':
      return 'grant_effect.image_internal';
    case 'image_social':
      return 'grant_effect.image_social';
    case 'medical_data_processing':
      return 'grant_effect.medical';
    default:
      return null;
  }
}

/** El nombre del tipo, para cuando no hay ningún documento del que sacar un título. */
export function consentTypeKey(consentType: string): string {
  return `types.${consentType}`;
}
