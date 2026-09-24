import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  ingestResendDeliveryEvent,
  parseResendDeliveryEvent,
  shouldRetryDelivery,
  verifyResendSignature,
  RESEND_NON_DELIVERY_EVENTS,
} from '../delivery-webhook';

/**
 * A-2 — El webhook de entrega de Resend.
 *
 * LA FIRMA SE CONSTRUYE AQUÍ CON LA RECETA DE SVIX, no con la de
 * `verifyResendSignature`. Es deliberado: si el test firmara llamando al código que
 * verifica, los dos se equivocarían igual y el test pasaría con una receta mal escrita.
 * Lo que se prueba es que nuestra verificación case con la de ELLOS.
 */

const SECRET_B64 = 'c2VjcmV0by1kZS1wcnVlYmEtcGFyYS1zdml4';
const SECRET = `whsec_${SECRET_B64}`;
const NOW = new Date('2026-09-24T12:00:00Z');
const TS = String(Math.floor(NOW.getTime() / 1000));
const ID = 'msg_2abc';

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toBuffer(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.length);
  new Uint8Array(buf).set(b);
  return buf;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** `v1,<base64(HMAC-SHA256("<id>.<ts>." + cuerpo, base64decode(secreto)))>` */
async function firmar(
  rawBody: Uint8Array,
  id = ID,
  ts = TS,
  secretB64 = SECRET_B64,
): Promise<string> {
  const prefix = bytes(`${id}.${ts}.`);
  const signed = new Uint8Array(prefix.length + rawBody.length);
  signed.set(prefix, 0);
  signed.set(rawBody, prefix.length);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    toBuffer(b64ToBytes(secretB64)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, toBuffer(signed)));
  return `v1,${bytesToB64(mac)}`;
}

const BODY = bytes(
  JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-09-24T11:59:00.000Z',
    data: {
      email_id: '01a0d2df-e4b7-770d-8379-0bae8f88676e',
      to: ['chaodis@fasdifgjodjc.es'],
      bounce: { type: 'Permanent', subType: 'General', message: 'Invalid domain' },
    },
  }),
);

describe('verifyResendSignature', () => {
  it('acepta una firma hecha con la receta de Svix', async () => {
    const signature = await firmar(BODY);
    expect(
      await verifyResendSignature(BODY, { id: ID, timestamp: TS, signature }, SECRET, { now: NOW }),
    ).toEqual({ ok: true });
  });

  it('acepta el secreto sin el prefijo whsec_ (así lo pegan algunos paneles)', async () => {
    const signature = await firmar(BODY);
    expect(
      await verifyResendSignature(BODY, { id: ID, timestamp: TS, signature }, SECRET_B64, {
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('acepta si UNA de varias firmas vale (así rota Svix los secretos)', async () => {
    const buena = await firmar(BODY);
    const otra = await firmar(BODY, ID, TS, 'b3RybyBzZWNyZXRvIGRpc3RpbnRv');
    const signature = `${otra} ${buena}`;
    expect(
      await verifyResendSignature(BODY, { id: ID, timestamp: TS, signature }, SECRET, { now: NOW }),
    ).toEqual({ ok: true });
  });

  it.each([
    ['sin id', { id: null, timestamp: TS }],
    ['sin timestamp', { id: ID, timestamp: null }],
  ])('rechaza %s', async (_caso, parcial) => {
    const signature = await firmar(BODY);
    const res = await verifyResendSignature(
      BODY,
      { ...parcial, signature } as Parameters<typeof verifyResendSignature>[1],
      SECRET,
      { now: NOW },
    );
    expect(res).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rechaza si no viene la cabecera de firma', async () => {
    expect(
      await verifyResendSignature(BODY, { id: ID, timestamp: TS, signature: null }, SECRET, {
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rechaza un timestamp que no es un número', async () => {
    const signature = await firmar(BODY);
    expect(
      await verifyResendSignature(BODY, { id: ID, timestamp: 'ayer', signature }, SECRET, {
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'malformed_header' });
  });

  it('rechaza una entrega vieja ANTES de mirar la firma', async () => {
    const viejo = String(Number(TS) - 3600);
    const signature = await firmar(BODY, ID, viejo);
    expect(
      await verifyResendSignature(BODY, { id: ID, timestamp: viejo, signature }, SECRET, {
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'stale' });
  });

  it.each(['', 'abc', 'v1', 'v99,AAAA', 'v1,no-es-base64-!!'])(
    'rechaza la cabecera mal formada %j',
    async (signature) => {
      const res = await verifyResendSignature(
        BODY,
        { id: ID, timestamp: TS, signature },
        SECRET,
        { now: NOW },
      );
      expect(res.ok).toBe(false);
    },
  );

  it('rechaza una firma de OTRO secreto', async () => {
    const signature = await firmar(BODY, ID, TS, 'b3RybyBzZWNyZXRvIGRpc3RpbnRv');
    expect(
      await verifyResendSignature(BODY, { id: ID, timestamp: TS, signature }, SECRET, { now: NOW }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rechaza si el CUERPO cambia aunque sea un byte (por eso se firma el crudo)', async () => {
    const signature = await firmar(BODY);
    // Mismo JSON, otros bytes: es justo lo que haría un `JSON.parse` + `stringify`.
    const reserializado = bytes(JSON.stringify(JSON.parse(new TextDecoder().decode(BODY))) + ' ');
    expect(
      await verifyResendSignature(
        reserializado,
        { id: ID, timestamp: TS, signature },
        SECRET,
        { now: NOW },
      ),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rechaza si el svix-id no es el que se firmó', async () => {
    const signature = await firmar(BODY);
    expect(
      await verifyResendSignature(BODY, { id: 'msg_otro', timestamp: TS, signature }, SECRET, {
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });
});

/**
 * ── CAREO CONTRA LA LIBRERÍA OFICIAL DE SVIX ────────────────────────────────
 *
 * Los tres vectores de abajo NO están escritos a mano: salieron de `new Webhook(secreto)
 * .sign(id, fecha, cuerpo)` de la librería `svix` de npm, la misma que su documentación
 * manda usar y que Resend recomienda. Se congelaron aquí para que el repo no tenga que
 * depender de ella.
 *
 * Por qué importa más que el resto del fichero: los demás tests firman con NUESTRA
 * receta, así que si la receta estuviera mal, el test y el código se equivocarían igual
 * y pasaría en verde. Esto es lo único que dice que nuestra verificación case con la
 * firma que Resend va a mandar de verdad.
 *
 * El secreto es de usar y tirar, generado para este careo; no abre nada.
 */
const SECRETO_SVIX = "whsec_YodnUTwxTRYJhCiwy8f1WMVgFmz4Capq";

const VECTORES_SVIX = [
  {
    nombre: "bounce",
    body: "{\"type\":\"email.bounced\",\"created_at\":\"2026-09-24T11:59:00.000Z\",\"data\":{\"email_id\":\"abc\",\"bounce\":{\"type\":\"Permanent\"}}}",
    id: "msg_1e0fe1c40192cab6",
    timestamp: "1790258397",
    signature: "v1,FPDg0J0OB3lOYay/AHkj7un1D2cmn14a5x/Ps6T1S/A=",
  },
  {
    nombre: "acentos_y_emoji",
    body: "{\"type\":\"email.delivered\",\"data\":{\"email_id\":\"ñé😀\",\"subject\":\"Te han invitado — ¿vienes?\"}}",
    id: "msg_a378568facbbdcc1",
    timestamp: "1790258397",
    signature: "v1,9S7jQBQ5DgjQbfNNTLlKxYBI3sPT6YZsRBj83ytzIlA=",
  },
  {
    nombre: "vacio",
    body: "{}",
    id: "msg_e2d3388894087e36",
    timestamp: "1790258397",
    signature: "v1,VdTFxAHaN62oF0Thlr3zHl/HZddksp5xf9NH/KFkziU=",
  },
] as const;

describe('careo con la firma que genera la librería oficial de svix', () => {
  it.each(VECTORES_SVIX.map((c) => [c.nombre, c] as const))(
    'acepta el vector real %s',
    async (_nombre, c) => {
      const now = new Date(Number(c.timestamp) * 1000);
      expect(
        await verifyResendSignature(
          bytes(c.body),
          { id: c.id, timestamp: c.timestamp, signature: c.signature },
          SECRETO_SVIX,
          { now },
        ),
      ).toEqual({ ok: true });
    },
  );

  it.each(VECTORES_SVIX.map((c) => [c.nombre, c] as const))(
    'rechaza el vector %s si el cuerpo cambia un byte',
    async (_nombre, c) => {
      const now = new Date(Number(c.timestamp) * 1000);
      expect(
        await verifyResendSignature(
          bytes(`${c.body} `),
          { id: c.id, timestamp: c.timestamp, signature: c.signature },
          SECRETO_SVIX,
          { now },
        ),
      ).toEqual({ ok: false, reason: 'mismatch' });
    },
  );
});

describe('parseResendDeliveryEvent', () => {
  function evento(body: unknown): Uint8Array {
    return bytes(JSON.stringify(body));
  }

  it('saca el id del envío, el estado sin prefijo, el motivo y la fecha DEL EVENTO', () => {
    expect(parseResendDeliveryEvent(BODY)).toEqual({
      messageId: '01a0d2df-e4b7-770d-8379-0bae8f88676e',
      state: 'bounced',
      detail: 'Permanent/General: Invalid domain',
      at: '2026-09-24T11:59:00.000Z',
    });
  });

  it('la fecha es la del EVENTO, no la del correo', () => {
    const ev = parseResendDeliveryEvent(
      evento({
        type: 'email.delivered',
        created_at: '2026-09-24T11:00:00.000Z',
        data: { email_id: 'abc', created_at: '2026-09-20T08:00:00.000Z' },
      }),
    );
    expect(ev?.at).toBe('2026-09-24T11:00:00.000Z');
  });

  it('saca el motivo de un email.failed', () => {
    const ev = parseResendDeliveryEvent(
      evento({
        type: 'email.failed',
        created_at: '2026-09-24T11:00:00.000Z',
        data: { email_id: 'abc', failed: { reason: 'reached_daily_quota' } },
      }),
    );
    expect(ev).toMatchObject({ state: 'failed', detail: 'reached_daily_quota' });
  });

  it('un evento sin motivo lo deja en null, no en cadena vacía', () => {
    const ev = parseResendDeliveryEvent(
      evento({
        type: 'email.delivery_delayed',
        created_at: '2026-09-24T11:00:00.000Z',
        data: { email_id: 'abc' },
      }),
    );
    expect(ev).toMatchObject({ state: 'delivery_delayed', detail: null });
  });

  it.each([...RESEND_NON_DELIVERY_EVENTS])('ignora email.%s, que no habla de entrega', (tipo) => {
    expect(
      parseResendDeliveryEvent(
        evento({ type: `email.${tipo}`, created_at: NOW.toISOString(), data: { email_id: 'abc' } }),
      ),
    ).toBeNull();
  });

  it('REGISTRA un estado que no conocemos, en vez de tirarlo', () => {
    // Lista NEGRA, no blanca: si Resend estrena un tipo de fallo, tirarlo en silencio
    // sería reabrir justo el agujero que esta serie cierra.
    const ev = parseResendDeliveryEvent(
      evento({
        type: 'email.inventado_manana',
        created_at: NOW.toISOString(),
        data: { email_id: 'abc' },
      }),
    );
    expect(ev?.state).toBe('inventado_manana');
  });

  it.each([
    ['no es JSON', bytes('{no json')],
    ['no es de correo', bytes(JSON.stringify({ type: 'contact.created', data: { id: 'x' } }))],
    ['sin data', bytes(JSON.stringify({ type: 'email.bounced' }))],
    ['sin email_id', bytes(JSON.stringify({ type: 'email.bounced', data: { to: ['a@b.c'] } }))],
    ['email_id vacío', bytes(JSON.stringify({ type: 'email.bounced', data: { email_id: '' } }))],
  ])('devuelve null si %s', (_caso, raw) => {
    expect(parseResendDeliveryEvent(raw)).toBeNull();
  });

  it('sin fecha usa la de ahora, para que el candado de orden NO tire el evento', () => {
    const antes = Date.now();
    const ev = parseResendDeliveryEvent(
      evento({ type: 'email.bounced', data: { email_id: 'abc' } }),
    );
    expect(ev).not.toBeNull();
    expect(new Date(ev!.at).getTime()).toBeGreaterThanOrEqual(antes);
  });
});

describe('ingestResendDeliveryEvent', () => {
  const EVENTO = {
    messageId: 'abc',
    state: 'bounced',
    detail: 'Invalid domain',
    at: '2026-09-24T11:00:00.000Z',
  };

  function clienteQueDevuelve(data: unknown, error: unknown = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { cliente: { rpc } as unknown as SupabaseClient<Database>, rpc };
  }

  it('llama al SQL con los cuatro parámetros y devuelve las filas tocadas', async () => {
    const { cliente, rpc } = clienteQueDevuelve(2);
    expect(await ingestResendDeliveryEvent(cliente, EVENTO)).toEqual({ ok: true, rows: 2 });
    expect(rpc).toHaveBeenCalledWith('apply_invitation_delivery_event', {
      p_message_id: 'abc',
      p_state: 'bounced',
      p_detail: 'Invalid domain',
      p_at: '2026-09-24T11:00:00.000Z',
    });
  });

  it('cero filas NO es un error: ese id no es de ninguna invitación nuestra', async () => {
    const { cliente } = clienteQueDevuelve(0);
    const res = await ingestResendDeliveryEvent(cliente, EVENTO);
    expect(res).toEqual({ ok: true, rows: 0 });
    expect(shouldRetryDelivery(res)).toBe(false);
  });

  it('un error del SQL sí pide reintento', async () => {
    const { cliente } = clienteQueDevuelve(null, { message: 'boom' });
    const res = await ingestResendDeliveryEvent(cliente, EVENTO);
    expect(res.ok).toBe(false);
    expect(shouldRetryDelivery(res)).toBe(true);
  });
});
