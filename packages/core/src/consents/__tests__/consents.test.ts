import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  REVOCABLE_CONSENT_TYPES,
  getAcceptedLegalDocumentFromClient,
  getTutorConsentsFromClient,
  isRevocableConsent,
} from '../reads';
import { revokePlayerConsentFromClient } from '../actions';

/**
 * Lo que se protege aquí:
 *
 *   · una lista VACÍA es legítima (el cuerpo técnico no ha firmado nada) y no puede
 *     confundirse con un fallo de lectura — decirle «no has firmado nada» a quien sí
 *     firmó es, en un documento de RGPD, la frase que no se puede soltar por error;
 *   · los seis motivos de la retirada llegan separados a la pantalla;
 *   · la lista de retirables NO deriva del SQL, así que se compara con él.
 */
type RpcResult = { data: unknown; error: { message: string } | null };

function makeClient(byFn: Record<string, RpcResult>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const sb = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(byFn[fn] ?? { data: null, error: { message: 'sin mock' } });
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, calls };
}

const FILA_HIJO = {
  player_id: 'p1',
  player_name: 'Hijo Uno',
  consent_type: 'medical_data_processing',
  granted: true,
  accepted_at: '2026-09-01T10:00:00Z',
  legal_document_id: 'doc-1',
  title: 'Datos de salud',
};

const FILA_CUENTA = {
  player_id: null,
  player_name: null,
  consent_type: 'privacy_policy',
  granted: true,
  accepted_at: '2026-09-01T10:00:00Z',
  legal_document_id: 'doc-2',
  title: 'Privacidad',
};

describe('getTutorConsentsFromClient', () => {
  it('mapea las dos clases de fila: de un hijo y de la cuenta', async () => {
    const { sb, calls } = makeClient({
      get_tutor_consents: { data: [FILA_HIJO, FILA_CUENTA], error: null },
    });
    const res = await getTutorConsentsFromClient(sb, 'club-1');
    expect(res).toEqual({
      ok: true,
      consents: [
        {
          playerId: 'p1',
          playerName: 'Hijo Uno',
          consentType: 'medical_data_processing',
          granted: true,
          acceptedAt: '2026-09-01T10:00:00Z',
          legalDocumentId: 'doc-1',
          title: 'Datos de salud',
        },
        {
          playerId: null,
          playerName: null,
          consentType: 'privacy_policy',
          granted: true,
          acceptedAt: '2026-09-01T10:00:00Z',
          legalDocumentId: 'doc-2',
          title: 'Privacidad',
        },
      ],
    });
    expect(calls).toEqual([{ fn: 'get_tutor_consents', args: { p_club_id: 'club-1' } }]);
  });

  it('lista vacía es ok:true, NO un error', async () => {
    const { sb } = makeClient({ get_tutor_consents: { data: [], error: null } });
    expect(await getTutorConsentsFromClient(sb, 'club-1')).toEqual({ ok: true, consents: [] });
  });

  it('un fallo de lectura NO se disfraza de lista vacía', async () => {
    const { sb } = makeClient({
      get_tutor_consents: { data: null, error: { message: 'boom' } },
    });
    expect(await getTutorConsentsFromClient(sb, 'club-1')).toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('sin sesión tiene su propio motivo', async () => {
    const { sb } = makeClient({
      get_tutor_consents: { data: null, error: { message: 'no_session' } },
    });
    expect(await getTutorConsentsFromClient(sb, 'club-1')).toEqual({
      ok: false,
      reason: 'no_session',
    });
  });
});

describe('getAcceptedLegalDocumentFromClient', () => {
  it('devuelve el texto firmado', async () => {
    const { sb } = makeClient({
      get_legal_document_body: { data: [{ title: 'T', body: 'cuerpo' }], error: null },
    });
    expect(await getAcceptedLegalDocumentFromClient(sb, 'doc-1')).toEqual({
      ok: true,
      document: { title: 'T', body: 'cuerpo' },
    });
  });

  // La RPC está gateada por "existe un consent tuyo que lo referencia": pedir uno
  // ajeno devuelve CERO FILAS, no un error. Son cosas distintas y se dicen distinto.
  it('cero filas es not_found, no error', async () => {
    const { sb } = makeClient({ get_legal_document_body: { data: [], error: null } });
    expect(await getAcceptedLegalDocumentFromClient(sb, 'doc-x')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('un fallo de lectura es error', async () => {
    const { sb } = makeClient({
      get_legal_document_body: { data: null, error: { message: 'boom' } },
    });
    expect(await getAcceptedLegalDocumentFromClient(sb, 'doc-1')).toEqual({
      ok: false,
      reason: 'error',
    });
  });
});

describe('revokePlayerConsentFromClient', () => {
  it('retira y no devuelve nada más', async () => {
    const { sb, calls } = makeClient({ revoke_player_consent: { data: null, error: null } });
    expect(await revokePlayerConsentFromClient(sb, 'p1', 'image_internal')).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        fn: 'revoke_player_consent',
        args: { p_player_id: 'p1', p_consent_type: 'image_internal' },
      },
    ]);
  });

  // Ni siquiera llama: no se pinta un botón que la base va a rechazar. La autoridad
  // sigue siendo el SQL — esto es interfaz, no seguridad.
  it('los obligatorios ni se intentan', async () => {
    const { sb, calls } = makeClient({ revoke_player_consent: { data: null, error: null } });
    expect(await revokePlayerConsentFromClient(sb, 'p1', 'privacy_policy')).toEqual({
      ok: false,
      reason: 'not_revocable',
    });
    expect(calls).toEqual([]);
  });

  it.each([
    ['forbidden', 'forbidden'],
    ['no_session', 'no_session'],
    ['nothing_to_revoke', 'nothing_to_revoke'],
    ['no_active_season', 'no_active_season'],
    ['not_revocable', 'not_revocable'],
    ['algo raro', 'error'],
  ])('el error %s del SQL llega como %s', async (mensaje, esperado) => {
    const { sb } = makeClient({
      revoke_player_consent: { data: null, error: { message: mensaje } },
    });
    expect(await revokePlayerConsentFromClient(sb, 'p1', 'image_social')).toEqual({
      ok: false,
      reason: esperado,
    });
  });
});

/**
 * CONTRATO con RV-1. La lista de retirables está escrita a mano en los dos sitios —en
 * el `if` de `revoke_player_consent` y aquí— porque una deriva del otro no se puede
 * leer de forma fiable. Lo que sí se puede es COMPARARLAS.
 *
 * Si se separan, el daño es de los que no dan error: un botón que la base rechaza, o
 * peor, un consentimiento retirable al que la pantalla no ofrece botón.
 */
describe('la lista de retirables no puede derivar del SQL', () => {
  function findMigration(): string {
    let dir = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      const candidate = join(
        dir,
        'supabase/migrations/20261077000000_rv1_revocar_consentimiento.sql',
      );
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`no encuentro la migración de RV-1 subiendo desde ${process.cwd()}`);
  }

  it('los NO retirables del SQL son exactamente los que aquí faltan', () => {
    const sql = findMigration();
    const cuerpo = sql.slice(sql.indexOf('create or replace function public.revoke_player_consent'));
    const clausula = cuerpo.slice(cuerpo.indexOf('if p_consent_type in ('));
    const noRetirables = [
      ...clausula.slice(0, clausula.indexOf(')')).matchAll(/'([a-z_]+)'/g),
    ].map((m) => m[1]);

    expect(noRetirables.length).toBeGreaterThan(0);
    for (const t of noRetirables) {
      expect(isRevocableConsent(t as never)).toBe(false);
    }
    // Y al revés: ninguno de los que ofrecemos está en la lista prohibida del SQL.
    for (const t of REVOCABLE_CONSENT_TYPES) {
      expect(noRetirables).not.toContain(t);
    }
  });
});
