import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * RC-2 · CENSO DE TRADUCCIONES de «retirar el acceso», y el gate del boton.
 *
 * Existe por lo mismo que el censo de consentimientos: las claves se COMPONEN en
 * tiempo de ejecucion —`invite_self.revoke.errors.<codigo>` y
 * `invite_self.revoke.done.<resultado>`— y una clave compuesta que no existe NO
 * rompe: el hook pinta la clave tal cual. El sintoma de una traduccion olvidada
 * seria un tutor leyendo `invite_self.revoke.errors.jugador_mayor_de_edad` en la
 * pantalla donde decide sobre la cuenta de su hijo. Es el fallo de R-4.
 *
 * Los codigos NO se escriben a mano aqui: se leen del fuente de core. Una lista
 * escrita en el test envejece igual que el censo que el test existe para evitar.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const LOCALES = ['es', 'en', 'va'] as const;

const FUENTE_CORE = join(
  RAIZ, 'packages', 'core', 'src', 'invitations', 'self-revoke.ts',
);
const FUENTE_NATIVA = join(__dirname, '..', 'screens', 'family', 'gestion.tsx');

function miembrosDeUnion(fuente: string, nombre: string): string[] {
  const bloque = new RegExp(`export type ${nombre} =([\\s\\S]*?);`).exec(fuente);
  if (!bloque) throw new Error(`no se encontro la union ${nombre} en core`);
  return [...bloque[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function bloqueRevoke(locale: string): Record<string, unknown> {
  const j = JSON.parse(
    readFileSync(join(RAIZ, 'messages', `${locale}.json`), 'utf8'),
  ) as { invite_self: { revoke: Record<string, unknown> } };
  return j.invite_self.revoke;
}

function tiene(obj: Record<string, unknown>, ruta: string): boolean {
  return (
    ruta.split('.').reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    ) !== undefined
  );
}

const core = readFileSync(FUENTE_CORE, 'utf8');
const ERRORES = miembrosDeUnion(core, 'SelfRevokeError');
const RESULTADOS = miembrosDeUnion(core, 'SelfRevokeOutcome');

/** Las claves fijas que pintan las dos pantallas, web y nativa. */
const LITERALES = [
  'action',
  'title',
  'confirm',
  'confirm_invited',
  'keeps_player',
  'confirm_action',
  'cancel',
];

describe('censo de traducciones de retirar el acceso', () => {
  it('el fuente de core declara los codigos que esperamos', () => {
    // Ancla positiva: si el regex dejara de encontrar nada, los bucles de abajo no
    // comprobarian nada y pasarian en verde sin medir una sola clave.
    expect(ERRORES).toContain('jugador_mayor_de_edad');
    expect(ERRORES.length).toBeGreaterThanOrEqual(3);
    expect(RESULTADOS).toEqual(['account', 'invitation', 'none']);
  });

  for (const locale of LOCALES) {
    it(`${locale}: cada error y cada resultado tienen su frase`, () => {
      const b = bloqueRevoke(locale);
      for (const codigo of ERRORES) {
        expect(tiene(b, `errors.${codigo}`), `falta errors.${codigo} en ${locale}`).toBe(true);
      }
      for (const r of RESULTADOS) {
        expect(tiene(b, `done.${r}`), `falta done.${r} en ${locale}`).toBe(true);
      }
      for (const k of LITERALES) {
        expect(tiene(b, k), `falta ${k} en ${locale}`).toBe(true);
      }
    });
  }

  it('la confirmacion dice que el jugador SIGUE en el club, en los tres idiomas', () => {
    // No es adorno: sin esa frase, «retirar» suena a borrar al nino. Es la decision
    // de Jose («la ficha, el equipo y las convocatorias se quedan») y se comprueba
    // que este escrita, no solo que exista la clave.
    for (const locale of LOCALES) {
      const texto = String(bloqueRevoke(locale).keeps_player ?? '');
      expect(texto.length, `keeps_player vacio en ${locale}`).toBeGreaterThan(40);
    }
  });
});

describe('el boton de retirar no cuelga del estado', () => {
  const nativa = readFileSync(FUENTE_NATIVA, 'utf8');

  it('la pantalla decide con canOfferSelfRevoke, la regla de core', () => {
    expect(nativa).toContain('canOfferSelfRevoke(');
  });

  it('y el boton se pinta bajo ese gate, no bajo el status', () => {
    // MN-9 gatea `player_self_account_status` con `user_manages_player`, asi que al
    // PROPIO jugador le contesta 'linked' igual que a su padre. Colgar el boton del
    // estado le pondria delante un «retirar mi cuenta» que el SQL le niega.
    const trozo = /\{canRevoke \?\s*\(\s*<RevokeAccessButton/.exec(nativa);
    expect(trozo, 'RevokeAccessButton tiene que pintarse bajo {canRevoke ?}').not.toBeNull();
  });
});
