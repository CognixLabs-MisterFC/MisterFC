import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assignStaffToTeam } from '../team-assignment';
import type { Database } from '../../supabase/types';

/**
 * W-1 — DAR UNA FUNCIÓN EN UN EQUIPO a alguien que ya está en el club.
 *
 * QUÉ SE PROTEGE, y por qué estos tests no existían. Esta función vivía en
 * `apps/web/src/lib/team-staff.ts`, compartida entre dos server actions, y **`apps/web`
 * no tiene runner de tests**: sus seis desenlaces con nombre no los ejecutaba nadie. Dos
 * de ellos se deducen de códigos de Postgres —42501 y 23505—, que es justo lo que una
 * segunda implementación escribiría mal.
 *
 * Lo que de verdad se vigila:
 *   · que el permiso NO se reimplemente aquí: lo pone la RLS y esto solo traduce el 42501;
 *   · que el 23505 se traduzca a DOS errores distintos según el rol, porque el índice
 *     parcial cubre dos casos que la persona vive de forma distinta;
 *   · que AÑADA y no mueva: una sola escritura, en `team_staff`, y ninguna en
 *     `memberships` — dar trabajo en un equipo no cambia el rol de club.
 */
type Llamadas = { tablas: string[]; inserts: unknown[] };

function cliente(opts: {
  membership?: { id: string; club_id: string } | null;
  teamClubId?: string | null;
  principalExistente?: boolean;
  insertError?: { code?: string } | null;
}): { db: SupabaseClient<Database>; calls: Llamadas } {
  const calls: Llamadas = { tablas: [], inserts: [] };
  const membership = opts.membership === undefined
    ? { id: 'm1', club_id: 'club-1' }
    : opts.membership;

  const from = (tabla: string) => {
    calls.tablas.push(tabla);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is']) b[m] = () => b;
    b.maybeSingle = async () => {
      if (tabla === 'memberships') return { data: membership };
      if (tabla === 'teams') {
        return opts.teamClubId === null
          ? { data: null }
          : { data: { id: 't1', categories: { club_id: opts.teamClubId ?? 'club-1' } } };
      }
      if (tabla === 'team_staff') {
        return { data: opts.principalExistente ? { id: 'ts1' } : null };
      }
      return { data: null };
    };
    b.insert = (row: unknown) => {
      calls.inserts.push(row);
      return Promise.resolve({ error: opts.insertError ?? null });
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient<Database>, calls };
}

const params = {
  membershipId: 'm1',
  teamId: 't1',
  staffRole: 'entrenador_ayudante' as const,
};

describe('assignStaffToTeam · cuándo NO se escribe', () => {
  it('sin membership: forbidden, y no se intenta insertar', async () => {
    const { db, calls } = cliente({ membership: null });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: false, error: 'forbidden' });
    expect(calls.inserts).toEqual([]);
  });

  it('sin equipo: team_invalid', async () => {
    const { db, calls } = cliente({ teamClubId: null });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: false, error: 'team_invalid' });
    expect(calls.inserts).toEqual([]);
  });

  // El caso que separa dos clubes: una membership de un club no puede colarse en el
  // equipo de otro ni con el id correcto.
  it('equipo de otro club: cross_club', async () => {
    const { db, calls } = cliente({ teamClubId: 'club-2' });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: false, error: 'cross_club' });
    expect(calls.inserts).toEqual([]);
  });

  it('ya hay principal vivo: principal_exists ANTES de escribir', async () => {
    const { db, calls } = cliente({ principalExistente: true });
    expect(
      await assignStaffToTeam(db, { ...params, staffRole: 'entrenador_principal' }),
    ).toEqual({ ok: false, error: 'principal_exists' });
    expect(calls.inserts).toEqual([]);
  });
});

describe('assignStaffToTeam · lo que escribe cuando sí', () => {
  it('una sola fila en team_staff, con la fecha de hoy', async () => {
    const { db, calls } = cliente({});
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: true });
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      team_id: 't1',
      membership_id: 'm1',
      staff_role: 'entrenador_ayudante',
    });
    const hoy = new Date().toISOString().slice(0, 10);
    expect((calls.inserts[0] as { joined_at: string }).joined_at).toBe(hoy);
  });

  // NO TOCA EL ROL DE CLUB: es la diferencia con invitar. Un director que además entrena
  // sigue siendo director, y eso se ve en que `memberships` solo se LEE.
  it('no escribe en memberships: dar trabajo en un equipo no cambia el rol de club', async () => {
    const { db, calls } = cliente({});
    await assignStaffToTeam(db, params);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.tablas.filter((t) => t === 'memberships')).toHaveLength(1);
  });

  it('no mira si hay principal cuando el rol no es principal', async () => {
    // El pre-check cuesta una consulta y solo tiene sentido para el principal. Si un día
    // se hiciera para todos, un ayudante ya existente bloquearía a otro ayudante.
    const { db, calls } = cliente({ principalExistente: true });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: true });
    // `team_staff` se toca UNA vez —el insert— y no dos: sin el `if`, el pre-check
    // añadiría una lectura y devolvería principal_exists a un ayudante.
    expect(calls.tablas.filter((t) => t === 'team_staff')).toHaveLength(1);
  });
});

describe('assignStaffToTeam · los códigos de Postgres', () => {
  // El permiso REAL lo pone la RLS `team_staff_insert_admin`. Aquí no se reimplementa: si
  // alguien lo intentara, este test seguiría pasando y el de arriba también — por eso lo
  // que se fija es la TRADUCCIÓN, que es lo único que hace esta función.
  it('42501 de la RLS sale como forbidden', async () => {
    const { db } = cliente({ insertError: { code: '42501' } });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: false, error: 'forbidden' });
  });

  // El MISMO código, DOS errores: el índice parcial cubre «ya hay principal» y «ya tiene
  // ese rol en este equipo», y la persona vive los dos de forma distinta.
  it('23505 con rol principal es principal_exists', async () => {
    const { db } = cliente({ insertError: { code: '23505' } });
    expect(
      await assignStaffToTeam(db, { ...params, staffRole: 'entrenador_principal' }),
    ).toEqual({ ok: false, error: 'principal_exists' });
  });

  it('23505 con cualquier otro rol es role_exists', async () => {
    const { db } = cliente({ insertError: { code: '23505' } });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: false, error: 'role_exists' });
  });

  it('un código que no conocemos NO se disfraza: generic', async () => {
    const { db } = cliente({ insertError: { code: '40001' } });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: false, error: 'generic' });
  });

  it('un error sin código tampoco: generic', async () => {
    const { db } = cliente({ insertError: {} });
    expect(await assignStaffToTeam(db, params)).toEqual({ ok: false, error: 'generic' });
  });
});
