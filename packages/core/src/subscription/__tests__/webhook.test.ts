import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  ingestRevenueCatEvent,
  parseRevenueCatEvent,
  severityFor,
  shouldRetry,
  verifyRevenueCatSignature,
  type IngestOutcome,
} from '../webhook';

const SECRET = 'whsec_de_prueba';
const NOW = new Date('2026-09-11T12:00:00Z');

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Firma de verdad, con la misma receta que la documentación de RevenueCat. */
async function sign(rawBody: Uint8Array, t: number, secret = SECRET): Promise<string> {
  const prefix = bytes(`${t}.`);
  const signed = new Uint8Array(prefix.length + rawBody.length);
  signed.set(prefix, 0);
  signed.set(rawBody, prefix.length);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, signed));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

const TS = Math.floor(NOW.getTime() / 1000);
const BODY = bytes(JSON.stringify({ api_version: '1.0', event: { id: 'e1' } }));

describe('verifyRevenueCatSignature', () => {
  it('acepta una firma correcta', async () => {
    const header = await sign(BODY, TS);
    expect(await verifyRevenueCatSignature(BODY, header, SECRET, { now: NOW })).toEqual({
      ok: true,
    });
  });

  it('rechaza si no viene la cabecera', async () => {
    expect(await verifyRevenueCatSignature(BODY, null, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'missing_header',
    });
  });

  it.each(['', 'v1=abc', 't=no,v1=aa', 't=1,v1=zz', 't=1,v1=abc'])(
    'rechaza la cabecera mal formada %j',
    async (header) => {
      const res = await verifyRevenueCatSignature(BODY, header, SECRET, { now: NOW });
      expect(res.ok).toBe(false);
    },
  );

  it('rechaza una entrega vieja aunque la firma sea válida', async () => {
    const old = TS - 3600;
    const header = await sign(BODY, old);
    expect(await verifyRevenueCatSignature(BODY, header, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('rechaza con otro secreto', async () => {
    const header = await sign(BODY, TS, 'otro');
    expect(await verifyRevenueCatSignature(BODY, header, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  // La razón de trabajar sobre bytes crudos y no sobre el objeto: reserializar cambia
  // los bytes en cuanto el cuerpo original trae cualquier formato, y tumba firmas
  // VÁLIDAS. Es el fallo clásico de este endpoint.
  it('un cuerpo REESCRITO deja de validar', async () => {
    const pretty = bytes(JSON.stringify({ api_version: '1.0', event: { id: 'e1' } }, null, 2));
    const header = await sign(pretty, TS);
    // Lo que haría un `await req.json()` seguido de volver a serializar:
    const reserialized = bytes(JSON.stringify(JSON.parse(new TextDecoder().decode(pretty))));
    expect(reserialized).not.toEqual(pretty);

    expect(await verifyRevenueCatSignature(pretty, header, SECRET, { now: NOW })).toEqual({
      ok: true,
    });
    expect(
      await verifyRevenueCatSignature(reserialized, header, SECRET, { now: NOW }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('un solo byte distinto en el cuerpo tumba la firma', async () => {
    const header = await sign(BODY, TS);
    const tampered = Uint8Array.from(BODY);
    const i = tampered.length - 2;
    tampered[i] = (tampered[i] ?? 0) ^ 0x01;
    expect(await verifyRevenueCatSignature(tampered, header, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });
});

describe('parseRevenueCatEvent', () => {
  const full = (o: Record<string, unknown> = {}) =>
    bytes(
      JSON.stringify({
        api_version: '1.0',
        event: {
          id: 'evt-1',
          type: 'RENEWAL',
          app_user_id: '11111111-1111-4111-8111-111111111111',
          event_timestamp_ms: Date.parse('2026-09-11T10:00:00Z'),
          environment: 'PRODUCTION',
          store: 'APP_STORE',
          product_id: 'misterfc_anual',
          original_transaction_id: 'otxn',
          transaction_id: 'txn',
          expiration_at_ms: Date.parse('2027-09-11T10:00:00Z'),
          original_app_user_id: '11111111-1111-4111-8111-111111111111',
          ...o,
        },
      }),
    );

  it('mapea los campos que importan', () => {
    const e = parseRevenueCatEvent(full());
    expect(e).toMatchObject({
      id: 'evt-1',
      type: 'RENEWAL',
      environment: 'PRODUCTION',
      storeTransactionId: 'otxn', // el ORIGINAL manda sobre el de la renovación
      expiresAt: '2027-09-11T10:00:00.000Z',
      gracePeriodExpiresAt: null,
    });
  });

  it('coge la fecha de fin de gracia de BILLING_ISSUE', () => {
    const e = parseRevenueCatEvent(
      full({
        type: 'BILLING_ISSUE',
        grace_period_expiration_at_ms: Date.parse('2026-09-18T10:00:00Z'),
      }),
    );
    expect(e?.gracePeriodExpiresAt).toBe('2026-09-18T10:00:00.000Z');
  });

  // Prudencia: lo que no da acceso es la suposición segura.
  it('sin environment se asume SANDBOX, que NO da acceso', () => {
    const e = parseRevenueCatEvent(full({ environment: undefined }));
    expect(e?.environment).toBe('SANDBOX');
  });

  it.each([
    ['no es json', bytes('{no json')],
    ['sin event', bytes(JSON.stringify({ api_version: '1.0' }))],
    ['sin id', bytes(JSON.stringify({ event: { type: 'RENEWAL', app_user_id: 'x' } }))],
  ])('devuelve null cuando %s', (_name, raw) => {
    expect(parseRevenueCatEvent(raw)).toBeNull();
  });
});

function makeAdmin(resp: { data?: unknown; error?: unknown }, args?: unknown[]) {
  return {
    rpc: (_name: string, params: unknown) => {
      args?.push(params);
      return Promise.resolve(resp);
    },
  } as unknown as SupabaseClient<Database>;
}

const EVENT = {
  id: 'evt-1',
  type: 'RENEWAL',
  appUserId: '11111111-1111-4111-8111-111111111111',
  eventAt: '2026-09-11T10:00:00.000Z',
  environment: 'PRODUCTION',
  store: 'APP_STORE',
  productId: 'misterfc_anual',
  storeTransactionId: 'otxn',
  expiresAt: '2027-09-11T10:00:00.000Z',
  gracePeriodExpiresAt: null,
  rcCustomerId: '11111111-1111-4111-8111-111111111111',
  payload: {} as never,
};

describe('ingestRevenueCatEvent', () => {
  it('pasa el evento entero a la RPC', async () => {
    const args: unknown[] = [];
    await ingestRevenueCatEvent(makeAdmin({ data: 'applied' }, args), EVENT);
    expect(args[0]).toMatchObject({
      p_event_id: 'evt-1',
      p_type: 'RENEWAL',
      p_environment: 'PRODUCTION',
      p_store_transaction_id: 'otxn',
    });
  });

  it('un error de la RPC sale como ok:false y se reintenta', async () => {
    const res = await ingestRevenueCatEvent(makeAdmin({ error: { message: 'boom' } }), EVENT);
    expect(res.ok).toBe(false);
    expect(shouldRetry(res)).toBe(true);
  });

  it.each<IngestOutcome>([
    'applied',
    'duplicate',
    'stale',
    'sandbox',
    'deleted_profile',
    'transfer_to_deleted_profile',
    'unknown_profile',
  ])('%s se devuelve tal cual y NO se pide reintento', async (outcome) => {
    const res = await ingestRevenueCatEvent(makeAdmin({ data: outcome }), EVENT);
    expect(res).toEqual({ ok: true, outcome });
    expect(shouldRetry(res)).toBe(false);
  });
});

/**
 * El bloque que más importa de la serie: qué pasa con el webhook de una cuenta que YA
 * está borrada.
 */
describe('una cuenta ya borrada', () => {
  it('deleted_profile NO alerta: es funcionamiento esperado, no un error', () => {
    expect(severityFor('deleted_profile')).toBe('normal');
  });

  it('y se responde 200: pedirles reintento sería gastar los 5 que tienen', async () => {
    const res = await ingestRevenueCatEvent(makeAdmin({ data: 'deleted_profile' }), EVENT);
    expect(shouldRetry(res)).toBe(false);
  });

  it('pero un TRANSFER a una cuenta borrada SÍ alerta: es el cable trampa', () => {
    expect(severityFor('transfer_to_deleted_profile')).toBe('alert');
  });

  it('un App User ID que no es nuestro avisa, sin llegar a incidente', () => {
    expect(severityFor('unknown_profile')).toBe('notice');
  });

  it.each<IngestOutcome>(['applied', 'duplicate', 'stale', 'sandbox'])(
    '%s no genera ni una línea',
    (outcome) => {
      expect(severityFor(outcome)).toBe('normal');
    },
  );

  // Si esto dejara de ser cierto, el canal de incidentes se llenaría de renovaciones
  // de cuentas anonimizadas y el TRANSFER quedaría enterrado.
  it('solo UNO de los siete desenlaces es alerta', () => {
    const all: IngestOutcome[] = [
      'applied',
      'duplicate',
      'stale',
      'sandbox',
      'unknown_profile',
      'deleted_profile',
      'transfer_to_deleted_profile',
    ];
    expect(all.filter((o) => severityFor(o) === 'alert')).toEqual([
      'transfer_to_deleted_profile',
    ]);
  });
});
