import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '../../auth/roles';
import type { Role } from '../../auth/current-user';
import {
  accessUntil,
  applyClock,
  requiresSubscription,
  subscriptionStateFrom,
  type EntitlementFacts,
  type SubscriptionLinks,
} from '../rules';

const links = (o: Partial<SubscriptionLinks> = {}): SubscriptionLinks => ({
  isPlatformAdmin: false,
  activeRoles: [],
  isTutor: false,
  isSpectator: false,
  ...o,
});

const facts = (o: Partial<EntitlementFacts> = {}): EntitlementFacts => ({
  expiresAt: null,
  gracePeriodExpiresAt: null,
  billingIssueDetectedAt: null,
  unlinkedAt: null,
  ...o,
});

const NOW = new Date('2026-09-11T12:00:00Z');
const iso = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('requiresSubscription', () => {
  it('el tutor paga', () => {
    expect(requiresSubscription(links({ isTutor: true }))).toBe(true);
  });

  it('el seguidor paga, igual que el tutor', () => {
    expect(requiresSubscription(links({ isSpectator: true }))).toBe(true);
  });

  it('la membership familiar (rol jugador) paga', () => {
    expect(requiresSubscription(links({ activeRoles: ['jugador'] }))).toBe(true);
  });

  it.each(STAFF_ROLES)('%s no paga', (role) => {
    expect(requiresSubscription(links({ activeRoles: [role] }))).toBe(false);
  });

  // La decisión que confirmó Jose el 2026-09-11.
  it('EL STAFF GANA: un entrenador que además es tutor no paga', () => {
    expect(
      requiresSubscription(
        links({ activeRoles: ['entrenador_ayudante'], isTutor: true }),
      ),
    ).toBe(false);
  });

  it('el superadmin de plataforma no paga aunque sea tutor', () => {
    expect(requiresSubscription(links({ isPlatformAdmin: true, isTutor: true }))).toBe(
      false,
    );
  });

  it('quien no tiene ningún vínculo no paga: no hay nada que cobrarle', () => {
    expect(requiresSubscription(links())).toBe(false);
  });

  // `activeRoles` son las memberships VIVAS: una baja saca al staff de la lista y
  // vuelve a pagar por su vínculo familiar.
  it('un entrenador DADO DE BAJA que es tutor vuelve a pagar', () => {
    expect(requiresSubscription(links({ activeRoles: [], isTutor: true }))).toBe(true);
  });
});

/**
 * CONTRATO con el SQL. `requires_subscription` en la migración lleva la lista de roles
 * escrita a mano; si alguien toca una de las dos, esto cae. Es el mismo criterio que el
 * literal del email en el pgTAP de BC-6.
 */
describe('la lista de roles gratis no puede derivar del SQL', () => {
  function findMigration(): string {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      const candidate = join(
        dir,
        'supabase/migrations/20261063000000_su1_suscripcion_modelo.sql',
      );
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`no encuentro la migración de SU-1 subiendo desde ${process.cwd()}`);
  }

  it('STAFF_ROLES es exactamente la lista del CHECK de la migración', () => {
    const sql = findMigration();
    const block = sql.slice(
      sql.indexOf('function public.requires_subscription'),
      sql.indexOf('revoke all on function public.requires_subscription'),
    );
    const clause = block.slice(block.indexOf('m.role in ('));
    const roles = [...clause.slice(0, clause.indexOf(')')).matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1] as Role,
    );

    expect(roles.length).toBeGreaterThan(0);
    expect([...roles].sort()).toEqual([...STAFF_ROLES].sort());
  });
});

describe('accessUntil', () => {
  // Si esto fuera el mínimo, la gracia no daría ni un día de acceso.
  it('es el MÁXIMO: con el vencimiento pasado manda la gracia', () => {
    expect(accessUntil(iso(-2), iso(5))).toBe(iso(5));
  });

  it('sin gracia manda el vencimiento', () => {
    expect(accessUntil(iso(10), null)).toBe(iso(10));
  });

  it('sin vencimiento manda la gracia', () => {
    expect(accessUntil(null, iso(3))).toBe(iso(3));
  });

  it('sin ninguno de los dos no hay acceso', () => {
    expect(accessUntil(null, null)).toBeNull();
  });

  it('una gracia vieja no recorta un vencimiento bueno', () => {
    expect(accessUntil(iso(300), iso(-1))).toBe(iso(300));
  });
});

describe('subscriptionStateFrom', () => {
  it('quien no paga es staff_free y entra', () => {
    const s = subscriptionStateFrom({ requiresSubscription: false }, null, NOW);
    expect(s.state).toBe('staff_free');
    expect(s.hasAccess).toBe(true);
  });

  it('sin fila es none y no entra', () => {
    const s = subscriptionStateFrom({ requiresSubscription: true }, null, NOW);
    expect(s.state).toBe('none');
    expect(s.hasAccess).toBe(false);
  });

  it('al día es active', () => {
    const s = subscriptionStateFrom(
      { requiresSubscription: true },
      facts({ expiresAt: iso(300) }),
      NOW,
    );
    expect(s.state).toBe('active');
    expect(s.hasAccess).toBe(true);
    expect(s.billingIssue).toBe(false);
  });

  it('en gracia DA ACCESO y se distingue de active', () => {
    const s = subscriptionStateFrom(
      { requiresSubscription: true },
      facts({
        expiresAt: iso(-2),
        gracePeriodExpiresAt: iso(5),
        billingIssueDetectedAt: iso(-2),
      }),
      NOW,
    );
    expect(s.state).toBe('grace');
    expect(s.hasAccess).toBe(true);
    expect(s.billingIssue).toBe(true);
  });

  it('acabada la gracia se cierra, y sin esperar ningún evento', () => {
    const s = subscriptionStateFrom(
      { requiresSubscription: true },
      facts({
        expiresAt: iso(-60),
        gracePeriodExpiresAt: iso(-1),
        billingIssueDetectedAt: iso(-60),
      }),
      NOW,
    );
    expect(s.state).toBe('expired');
    expect(s.hasAccess).toBe(false);
    // El impago sigue abierto aunque ya no dé acceso: la UI lo necesita para el aviso.
    expect(s.billingIssue).toBe(true);
  });

  // El motivo de que esta regla exista en TS: la app cachea y el tiempo pasa.
  it('el MISMO hecho deja de dar acceso cuando pasa la fecha', () => {
    const f = facts({ expiresAt: '2026-09-11T18:00:00Z' });
    expect(subscriptionStateFrom({ requiresSubscription: true }, f, NOW).hasAccess).toBe(
      true,
    );
    expect(
      subscriptionStateFrom(
        { requiresSubscription: true },
        f,
        new Date('2026-09-11T18:00:01Z'),
      ).hasAccess,
    ).toBe(false);
  });

  it('la cuenta borrada es unlinked y gana sobre cualquier fecha futura', () => {
    const s = subscriptionStateFrom(
      { requiresSubscription: true },
      facts({ expiresAt: iso(300), unlinkedAt: iso(-1) }),
      NOW,
    );
    expect(s.state).toBe('unlinked');
    expect(s.hasAccess).toBe(false);
  });
});

/**
 * `applyClock` es lo que consume la nativa. Solo puede CERRAR: nunca abre algo que el
 * servidor haya cerrado.
 */
describe('applyClock', () => {
  const base = {
    requiresSubscription: true,
    hasAccess: true,
    state: 'active' as const,
    accessUntil: iso(5),
    billingIssue: false,
  };

  it('con la fecha por delante no toca nada', () => {
    expect(applyClock(base, NOW)).toEqual(base);
  });

  it('pasada la fecha cierra, sin esperar al servidor', () => {
    const s = applyClock({ ...base, accessUntil: iso(-1) }, NOW);
    expect(s.hasAccess).toBe(false);
    expect(s.state).toBe('expired');
  });

  it('cierra la gracia en cuanto vence, y no antes', () => {
    const grace = { ...base, state: 'grace' as const, billingIssue: true };
    expect(applyClock(grace, NOW).hasAccess).toBe(true);
    expect(
      applyClock({ ...grace, accessUntil: '2026-09-11T11:59:59Z' }, NOW).hasAccess,
    ).toBe(false);
  });

  it('a quien no paga no le vigila ninguna fecha', () => {
    const free = {
      requiresSubscription: false,
      hasAccess: true,
      state: 'staff_free' as const,
      accessUntil: null,
      billingIssue: false,
    };
    expect(applyClock(free, NOW)).toEqual(free);
  });

  it('NO reabre lo que el servidor cerró: unlinked sigue cerrado', () => {
    const unlinked = {
      requiresSubscription: true,
      hasAccess: false,
      state: 'unlinked' as const,
      accessUntil: iso(300),
      billingIssue: false,
    };
    expect(applyClock(unlinked, NOW)).toEqual(unlinked);
  });

  it('sin fecha no hay acceso', () => {
    expect(applyClock({ ...base, accessUntil: null }, NOW).hasAccess).toBe(false);
  });
});

