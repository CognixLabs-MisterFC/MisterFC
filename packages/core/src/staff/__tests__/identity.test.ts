import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { ADMIN_ROLES } from '../../auth/roles';
import {
  STAFF_NAME_MAX,
  canEditStaffIdentity,
  canEditStaffIdentityOf,
  getStaffContactFromClient,
  staffContactInput,
  staffNameInput,
  updateStaffContactFromClient,
  updateStaffNameFromClient,
} from '../identity';

/**
 * W-4 — nombre y contacto de un miembro del cuerpo técnico.
 *
 * Qué se protege aquí:
 *   · que el permiso NO se confunda con el de asignar (el coordinador entra en uno y
 *     no en el otro, y confundirlos le daría un botón que el RPC le niega);
 *   · los LÍMITES de validación, porque el SQL los vuelve a comprobar: si aquí y allí
 *     no coinciden, el usuario ve `generic` en vez del motivo;
 *   · que vacío se guarde como NULL y no como cadena vacía — un contacto que parece
 *     puesto y no lo está es peor que uno ausente;
 *   · y que los motivos del RPC, que llegan como TEXTO dentro del mensaje, se
 *     traduzcan uno por uno.
 */
function cliente(opts: {
  rpcError?: { message: string } | null;
  contacto?: { phone: string | null; contact_email: string | null } | null;
  selectError?: { code: string } | null;
}): {
  db: SupabaseClient<Database>;
  llamadas: { nombre: string; args: Record<string, unknown> }[];
} {
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ nombre, args });
      return Promise.resolve({ error: opts.rpcError ?? null });
    },
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () =>
        Promise.resolve(
          opts.selectError
            ? { data: null, error: opts.selectError }
            : { data: opts.contacto ?? null, error: null },
        );
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, llamadas };
}

const PARAMS = { clubId: 'club-1', targetProfileId: 'prof-1' };

describe('canEditStaffIdentity · NO es el permiso de asignar', () => {
  it('admin_club y director sí', () => {
    expect(canEditStaffIdentity('admin_club')).toBe(true);
    expect(canEditStaffIdentity('director')).toBe(true);
  });

  it('el COORDINADOR no, aunque sí pueda asignar roles', () => {
    // Éste es el test que impide el atajo de reutilizar `staffAssignmentPermission`.
    // Las dos funciones SQL lo dicen: «el coordinador NO, la identidad es más
    // sensible».
    expect(canEditStaffIdentity('coordinador')).toBe(false);
    expect(ADMIN_ROLES).toContain('coordinador');
  });

  it('nadie más, ni sin rol', () => {
    for (const r of ['entrenador_principal', 'entrenador_ayudante', 'jugador'] as const) {
      expect(canEditStaffIdentity(r)).toBe(false);
    }
    expect(canEditStaffIdentity(null)).toBe(false);
    expect(canEditStaffIdentity(undefined)).toBe(false);
  });
});

describe('canEditStaffIdentityOf · no sobre uno mismo', () => {
  const YO = 'prof-yo';
  const OTRO = 'prof-otro';

  it('un admin edita a otro', () => {
    expect(canEditStaffIdentityOf('admin_club', YO, OTRO)).toBe(true);
    expect(canEditStaffIdentityOf('director', YO, OTRO)).toBe(true);
  });

  it('pero NO a sí mismo, aunque el RPC se lo permitiría', () => {
    // Los dos RPC no imponen esta regla: este es el único sitio donde existe. Su
    // motivo está escrito en la web desde Bug 2 — editarse va por /perfil.
    expect(canEditStaffIdentityOf('admin_club', YO, YO)).toBe(false);
    expect(canEditStaffIdentityOf('director', YO, YO)).toBe(false);
  });

  it('el coordinador tampoco, ni a otros', () => {
    expect(canEditStaffIdentityOf('coordinador', YO, OTRO)).toBe(false);
  });

  it('sin saber quién mira o a quién, no se ofrece', () => {
    // Falla cerrado: un `profileId` que llega vacío mientras carga la sesión no
    // puede convertirse en "sí, adelante".
    expect(canEditStaffIdentityOf('admin_club', null, OTRO)).toBe(false);
    expect(canEditStaffIdentityOf('admin_club', YO, null)).toBe(false);
    expect(canEditStaffIdentityOf('admin_club', undefined, undefined)).toBe(false);
    expect(canEditStaffIdentityOf('admin_club', '', OTRO)).toBe(false);
  });
});

describe('staffNameInput · los límites', () => {
  it('recorta los espacios', () => {
    expect(staffNameInput('  Ana Pérez  ')).toEqual({ ok: true, value: 'Ana Pérez' });
  });

  it('vacío, o solo espacios, es name_required', () => {
    expect(staffNameInput('')).toEqual({ ok: false, error: 'name_required' });
    expect(staffNameInput('    ')).toEqual({ ok: false, error: 'name_required' });
  });

  it('el tope son 120: 120 pasa, 121 no', () => {
    expect(staffNameInput('a'.repeat(STAFF_NAME_MAX)).ok).toBe(true);
    expect(staffNameInput('a'.repeat(STAFF_NAME_MAX + 1))).toEqual({
      ok: false,
      error: 'name_too_long',
    });
    // Y el tope es el del SQL: si alguien lo cambia aquí a solas, el error pasa a
    // llegar del servidor como `generic`.
    expect(STAFF_NAME_MAX).toBe(120);
  });

  it('se mide DESPUÉS de recortar', () => {
    expect(staffNameInput(`  ${'a'.repeat(120)}  `).ok).toBe(true);
  });
});

describe('staffContactInput · vacío es NULL, no cadena vacía', () => {
  it('los dos vacíos → dos null', () => {
    expect(staffContactInput({ phone: '', contactEmail: '  ' })).toEqual({
      ok: true,
      phone: null,
      contactEmail: null,
    });
  });

  it('teléfono: 3 pasa, 2 no; 32 pasa, 33 no', () => {
    expect(staffContactInput({ phone: '123', contactEmail: '' }).ok).toBe(true);
    expect(staffContactInput({ phone: '12', contactEmail: '' })).toEqual({
      ok: false,
      error: 'phone_invalid',
    });
    expect(staffContactInput({ phone: '1'.repeat(32), contactEmail: '' }).ok).toBe(true);
    expect(staffContactInput({ phone: '1'.repeat(33), contactEmail: '' })).toEqual({
      ok: false,
      error: 'phone_invalid',
    });
  });

  it('email de contacto: pide algo@algo.algo', () => {
    expect(staffContactInput({ phone: '', contactEmail: 'a@b.es' }).ok).toBe(true);
    for (const malo of ['sin-arroba', 'a@b', 'a b@c.es', 'a@@b.es', '@b.es']) {
      expect(
        staffContactInput({ phone: '', contactEmail: malo }),
        `${malo} debería ser inválido`,
      ).toEqual({ ok: false, error: 'contact_email_invalid' });
    }
  });

  it('un email larguísimo tampoco', () => {
    const largo = `${'a'.repeat(250)}@b.es`;
    expect(staffContactInput({ phone: '', contactEmail: largo })).toEqual({
      ok: false,
      error: 'contact_email_invalid',
    });
  });

  it('el teléfono se comprueba ANTES que el email: un motivo por vez', () => {
    expect(staffContactInput({ phone: '1', contactEmail: 'malo' })).toEqual({
      ok: false,
      error: 'phone_invalid',
    });
  });
});

describe('updateStaffNameFromClient', () => {
  it('llama al RPC del nombre con el valor ya recortado', async () => {
    const { db, llamadas } = cliente({});
    const res = await updateStaffNameFromClient(db, { ...PARAMS, fullName: '  Ana  ' });
    expect(res).toEqual({ ok: true });
    expect(llamadas).toHaveLength(1);
    const [llamada] = llamadas;
    expect(llamada?.nombre).toBe('admin_update_staff_profile');
    expect(llamada?.args).toEqual({
      p_club_id: 'club-1',
      p_target_profile_id: 'prof-1',
      p_full_name: 'Ana',
    });
  });

  it('un nombre inválido NO llega al servidor', async () => {
    const { db, llamadas } = cliente({});
    expect(await updateStaffNameFromClient(db, { ...PARAMS, fullName: ' ' })).toEqual({
      ok: false,
      error: 'name_required',
    });
    expect(llamadas).toEqual([]);
  });

  it('traduce los cuatro motivos del RPC', async () => {
    for (const code of ['forbidden', 'target_invalid', 'name_required', 'name_too_long'] as const) {
      const { db } = cliente({ rpcError: { message: `${code} (P0001)` } });
      expect(
        await updateStaffNameFromClient(db, { ...PARAMS, fullName: 'Ana' }),
      ).toEqual({ ok: false, error: code });
    }
  });

  it('un mensaje que no reconocemos NO se disfraza: generic', async () => {
    const { db } = cliente({ rpcError: { message: 'deadlock detected' } });
    expect(await updateStaffNameFromClient(db, { ...PARAMS, fullName: 'Ana' })).toEqual({
      ok: false,
      error: 'generic',
    });
  });
});

describe('updateStaffContactFromClient', () => {
  it('manda null donde el usuario dejó vacío', async () => {
    const { db, llamadas } = cliente({});
    const res = await updateStaffContactFromClient(db, {
      ...PARAMS,
      phone: '600123123',
      contactEmail: '',
    });
    expect(res).toEqual({ ok: true });
    const [llamada] = llamadas;
    expect(llamada?.nombre).toBe('admin_update_staff_contact');
    expect(llamada?.args).toEqual({
      p_club_id: 'club-1',
      p_target_profile_id: 'prof-1',
      p_phone: '600123123',
      p_contact_email: null,
    });
  });

  it('un contacto inválido NO llega al servidor', async () => {
    const { db, llamadas } = cliente({});
    expect(
      await updateStaffContactFromClient(db, { ...PARAMS, phone: '', contactEmail: 'malo' }),
    ).toEqual({ ok: false, error: 'contact_email_invalid' });
    expect(llamadas).toEqual([]);
  });

  it('traduce los cuatro motivos del RPC', async () => {
    for (const code of [
      'forbidden',
      'target_invalid',
      'phone_invalid',
      'contact_email_invalid',
    ] as const) {
      const { db } = cliente({ rpcError: { message: `${code} (P0001)` } });
      expect(
        await updateStaffContactFromClient(db, { ...PARAMS, phone: '', contactEmail: '' }),
      ).toEqual({ ok: false, error: code });
    }
  });
});

describe('getStaffContactFromClient', () => {
  it('devuelve el contacto actual', async () => {
    const { db } = cliente({ contacto: { phone: '600', contact_email: 'a@b.es' } });
    expect(await getStaffContactFromClient(db, 'm1')).toEqual({
      phone: '600',
      contactEmail: 'a@b.es',
    });
  });

  it('sin contacto puesto, dos null (no undefined)', async () => {
    const { db } = cliente({ contacto: { phone: null, contact_email: null } });
    expect(await getStaffContactFromClient(db, 'm1')).toEqual({
      phone: null,
      contactEmail: null,
    });
  });

  it('si no hay fila, null', async () => {
    const { db } = cliente({ contacto: null });
    expect(await getStaffContactFromClient(db, 'm1')).toBeNull();
  });

  it('si la lectura falla, null y se avisa', async () => {
    const { db } = cliente({ selectError: { code: '42501' } });
    const vistos: unknown[] = [];
    expect(await getStaffContactFromClient(db, 'm1', (e) => vistos.push(e))).toBeNull();
    expect(vistos).toHaveLength(1);
  });
});
