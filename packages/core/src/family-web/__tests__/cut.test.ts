import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { decideFamilyWebCut, evaluateFamilyWebCutFromClient } from '../cut';

/**
 * Lo que se protege aquí son las TRES razones por las que alguien sigue navegando, que
 * la pantalla no puede distinguir por su cuenta y que significan cosas muy distintas:
 *
 *   · cut_off     → el interruptor está apagado. Es el estado de HOY.
 *   · unreadable  → no se pudo leer quién es. No se cierra, y se avisa.
 *   · staff       → es suya la web y no se toca.
 *
 * Si las tres colapsan en «no cerrado», el día que la lectura empiece a fallar en masa
 * nadie se entera: el corte deja de aplicarse y el síntoma es que no pasa nada.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

function makeClient(res: RpcResult) {
  const calls: string[] = [];
  const sb = {
    rpc: (fn: string) => {
      calls.push(fn);
      return Promise.resolve(res);
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, calls };
}

/** Una fila de `my_subscription_status()` tal y como la devuelve el SQL. */
const fila = (requires: boolean) => ({
  data: [
    {
      requires_subscription: requires,
      has_access: !requires,
      state: requires ? 'none' : 'staff_free',
      access_until: null,
      billing_issue: false,
    },
  ],
  error: null,
});

describe('decideFamilyWebCut', () => {
  it('con el interruptor APAGADO no cierra ni a una familia', () => {
    expect(decideFamilyWebCut(false, true)).toEqual({ closed: false, reason: 'cut_off' });
  });

  it('encendido, la familia va a la app', () => {
    expect(decideFamilyWebCut(true, true)).toEqual({ closed: true });
  });

  it('encendido, el staff conserva la web', () => {
    expect(decideFamilyWebCut(true, false)).toEqual({ closed: false, reason: 'staff' });
  });

  // «No se pudo leer» NO es «es familia». Cerrar por error le enseña a un entrenador una
  // pantalla que le dice que se descargue la app de familia; abrir por error le deja a
  // una familia la web durante una carga de página, y eso no abre ninguna puerta: el
  // corte es producto, no autorización, y la RLS sigue donde estaba.
  it('una lectura fallida DEJA PASAR', () => {
    expect(decideFamilyWebCut(true, null)).toEqual({
      closed: false,
      reason: 'unreadable',
    });
  });

  it('apagado gana sobre todo lo demás, incluida una lectura fallida', () => {
    expect(decideFamilyWebCut(false, null)).toEqual({ closed: false, reason: 'cut_off' });
  });
});

describe('evaluateFamilyWebCutFromClient', () => {
  // Con el interruptor apagado no se pregunta nada. Importa: hoy el corte está apagado
  // en producción, así que esta rama es la que corre en TODAS las cargas de página.
  it('apagado: NO llega a preguntar a la base de datos', async () => {
    const { sb, calls } = makeClient(fila(true));
    const d = await evaluateFamilyWebCutFromClient(sb, { enabled: false });
    expect(d).toEqual({ closed: false, reason: 'cut_off' });
    expect(calls).toEqual([]);
  });

  it('encendido: lee my_subscription_status y cierra a la familia', async () => {
    const { sb, calls } = makeClient(fila(true));
    const d = await evaluateFamilyWebCutFromClient(sb, { enabled: true });
    expect(d).toEqual({ closed: true });
    expect(calls).toEqual(['my_subscription_status']);
  });

  it('encendido: el staff sigue navegando', async () => {
    const { sb } = makeClient(fila(false));
    const d = await evaluateFamilyWebCutFromClient(sb, { enabled: true });
    expect(d).toEqual({ closed: false, reason: 'staff' });
  });

  it('la RPC en error deja pasar y AVISA', async () => {
    const { sb } = makeClient({ data: null, error: { message: 'boom' } });
    const vistos: unknown[] = [];
    const d = await evaluateFamilyWebCutFromClient(sb, {
      enabled: true,
      onUnreadable: (raw) => vistos.push(raw),
    });
    expect(d).toEqual({ closed: false, reason: 'unreadable' });
    expect(vistos).toHaveLength(1);
  });

  // `my_subscription_status()` devuelve exactamente una fila para cualquier sesión
  // válida (SU-2). Cero filas solo puede significar que algo fue mal, y eso NO es
  // «no es familia»: es una lectura que no se pudo hacer.
  it('cero filas es ilegible, no «es staff»', async () => {
    const { sb } = makeClient({ data: [], error: null });
    const vistos: unknown[] = [];
    const d = await evaluateFamilyWebCutFromClient(sb, {
      enabled: true,
      onUnreadable: (raw) => vistos.push(raw),
    });
    expect(d).toEqual({ closed: false, reason: 'unreadable' });
    expect(vistos).toHaveLength(1);
  });

  it('sin onUnreadable no revienta', async () => {
    const { sb } = makeClient({ data: null, error: { message: 'boom' } });
    const d = await evaluateFamilyWebCutFromClient(sb, { enabled: true });
    expect(d).toEqual({ closed: false, reason: 'unreadable' });
  });
});
