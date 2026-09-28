import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invitableRoles } from '@misterfc/core';

/**
 * W-6 — que "Nueva invitación" no se quede MUDA, y que el candado siga delante.
 *
 * Todo el texto se pide por plantilla (`invitations.form.role_${r}`,
 * `invitations.form.${error}`), así que `check:cadenas-muertas` no puede verlo: mira
 * claves SIN USO, no claves QUE FALTAN. En W-3 este mismo test cazó un namespace
 * equivocado antes de que lo viera nadie.
 *
 * Y vigila dos invariantes que no son de texto:
 *   · el modal llama al ENDPOINT y nunca al admin (la service-role no baja al móvil);
 *   · el botón se decide con `canInviteToClub` ANTES de pintarse.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const CATALOGOS = ['es', 'en', 'va'] as const;

function catalogo(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(RAIZ, 'messages', `${locale}.json`), 'utf8'));
}

function clave(obj: Record<string, unknown>, ruta: string): unknown {
  let cur: unknown = obj;
  for (const p of ruta.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function texto(locale: string, ruta: string): string {
  const v = clave(catalogo(locale), ruta);
  expect(typeof v, `${locale}: falta ${ruta}`).toBe('string');
  return v as string;
}

const MODAL = readFileSync(join(__dirname, 'invite-staff-modal.tsx'), 'utf8');
const LISTA = readFileSync(join(__dirname, 'invitations-list.tsx'), 'utf8');

/**
 * Los DESTINOS de la tabla de errores, leídos del modal como TEXTO: importar un
 * `.tsx` de la app arrastra `react-native`, que este runner no sabe parsear.
 */
function destinosDeError(): string[] {
  const desde = MODAL.indexOf('const TEXTO_DE_ERROR');
  expect(desde, 'no se encuentra TEXTO_DE_ERROR').toBeGreaterThan(-1);
  const cuerpo = MODAL.slice(desde, MODAL.indexOf('};', desde));
  return [...new Set([...cuerpo.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]))];
}

describe('W-6 · los textos de invitar', () => {
  it('la tabla traduce a claves que EXISTEN en los tres idiomas', () => {
    const destinos = destinosDeError();
    expect(destinos.length).toBeGreaterThanOrEqual(4);
    for (const locale of CATALOGOS) {
      for (const k of destinos) {
        expect(texto(locale, `invitations.form.${k}`).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('nombra todos los códigos que el endpoint puede devolver', () => {
    const cuerpo = MODAL.slice(MODAL.indexOf('const TEXTO_DE_ERROR'));
    for (const code of [
      'invalid',
      'invalid_input',
      'email_invalid',
      'role_invalid',
      'forbidden',
      'no_club',
      'generic',
    ]) {
      expect(cuerpo, `la tabla no nombra ${code}`).toContain(`${code}:`);
    }
  });

  it('un código desconocido cae en generic, no en una clave inventada', () => {
    expect(MODAL).toContain("|| 'error_generic'");
  });

  it('TODOS los roles invitables tienen etiqueta, incluidos los del owner', () => {
    // `invitableRoles` del owner devuelve los seis; si a uno le faltara la etiqueta,
    // el chip saldría con la clave en crudo y solo al owner — el caso más difícil de
    // ver a mano.
    const todos = invitableRoles({ role: 'admin_club', isOwner: true });
    expect(todos).toHaveLength(6);
    for (const locale of CATALOGOS) {
      for (const r of todos) {
        expect(texto(locale, `invitations.form.role_${r}`).trim().length).toBeGreaterThan(0);
      }
    }
    expect(MODAL, 'el chip debe pedir la etiqueta por `invitations.form.role_`').toContain(
      'invitations.form.role_${r}',
    );
  });

  it('el rol de quien YA está en el club se nombra por `roles.`', () => {
    // Ese aviso puede nombrar cualquiera de los seis roles de club, y `club_role` solo
    // tiene los dos de entrenador (el fallo exacto que cazó W-3).
    expect(MODAL).toContain('roles.${hecho.rol}');
    for (const locale of CATALOGOS) {
      for (const r of [
        'admin_club',
        'director',
        'coordinador',
        'entrenador_principal',
        'entrenador_ayudante',
        'jugador',
      ]) {
        expect(texto(locale, `roles.${r}`).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('las cadenas propias del modal están en los tres idiomas', () => {
    const propias = [
      'action',
      'email_label',
      'email_placeholder',
      'role_label',
      'submit',
      'submitting',
      'cancel',
      'close',
      'offline',
      'ok',
      'ok_covered',
    ];
    for (const locale of CATALOGOS) {
      for (const k of propias) {
        expect(texto(locale, `invitations.form.${k}`).trim().length).toBeGreaterThan(0);
      }
      // Los dos desenlaces llevan el correo, y el de «ya está» el nombre y el rol.
      expect(texto(locale, 'invitations.form.ok')).toContain('{email}');
      expect(texto(locale, 'invitations.form.ok_covered')).toContain('{email}');
      expect(texto(locale, 'invitations.form.existing.body')).toContain('{name}');
    }
  });

  it('«enviada» y «creada sin correo nuevo» son textos DISTINTOS', () => {
    // Decir «invitación enviada» cuando no ha salido ningún correo es exactamente la
    // clase de promesa falsa que esta serie va quitando.
    for (const locale of CATALOGOS) {
      expect(texto(locale, 'invitations.form.ok')).not.toBe(
        texto(locale, 'invitations.form.ok_covered'),
      );
    }
  });
});

describe('W-6 · el candado y la vía', () => {
  it('llama al ENDPOINT, no a la base ni al admin', () => {
    // La service-role no baja a un teléfono: crear y enlazar la cuenta del invitado es
    // lo único de la serie que no puede hacer la app con su sesión.
    expect(MODAL).toContain("callServerEndpoint('/api/staff/invitations'");
    expect(MODAL).not.toContain('createSupabaseAdminClient');
    expect(MODAL).not.toContain('service_role');
    expect(MODAL).not.toContain("from('invitations')");
  });

  it('el botón se decide con `canInviteToClub` ANTES de pintarse', () => {
    const i = MODAL.indexOf('canInviteToClub(');
    const j = MODAL.indexOf("t('invitations.form.action')");
    expect(i, 'no se llama al candado').toBeGreaterThan(-1);
    expect(j, 'no se encuentra el botón').toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
    // Y devuelve null: no es un `disabled`, es no pintarlo.
    expect(MODAL).toContain('return null;');
  });

  it('los roles ofrecidos salen de core, no de una lista escrita aquí', () => {
    expect(MODAL).toContain('invitableRoles(');
    expect(MODAL).not.toContain("'entrenador_ayudante',");
  });

  it('sin red no se escribe (write-guard)', () => {
    expect(MODAL).toContain('if (!online || saving');
  });

  it('la lista pasa el equipo de ESA lista y refresca al acabar', () => {
    expect(LISTA).toContain('InviteStaffAction');
    expect(LISTA).toContain('teamId={teamId}');
    expect(LISTA).toContain('onDone={refresh}');
  });
});
