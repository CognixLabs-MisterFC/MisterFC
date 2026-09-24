import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import { recordInvitationDelivery } from '../delivery';

/**
 * A-2 — apuntar en la invitación el id del envío.
 *
 * Lo que de verdad se prueba aquí no es el UPDATE: es el CONTRATO de que esto NUNCA
 * tumba una invitación que ya ha salido. Los dos senders de core llaman a esto dentro
 * del `try` que envuelve el envío, y `inviteBatch` BORRA las invitaciones del grupo si
 * el envío se marca como fallido — o sea que una excepción aquí no sería un apunte
 * perdido, sería la invitación destruida por no poder apuntarla.
 */

type Captura = { error: unknown; step: string; extra?: Record<string, unknown> };

function logger() {
  const capturas: Captura[] = [];
  const log = (error: unknown, step: string, extra?: Record<string, unknown>) => {
    capturas.push({ error, step, extra });
  };
  return { log, capturas };
}

/** Cliente falso: `from(...).update(...).in(...).select(...)` → lo que se le diga. */
function cliente(respuesta: { data?: unknown; error?: unknown } | { rechaza: unknown }) {
  const update = vi.fn();
  const enIds = vi.fn();
  const select = vi.fn(() =>
    'rechaza' in respuesta
      ? Promise.reject(respuesta.rechaza)
      : Promise.resolve({ data: respuesta.data ?? null, error: respuesta.error ?? null }),
  );
  enIds.mockReturnValue({ select });
  update.mockReturnValue({ in: enIds });
  const from = vi.fn(() => ({ update }));
  return {
    admin: { from } as unknown as SupabaseClient<Database>,
    from,
    update,
    enIds,
  };
}

describe('recordInvitationDelivery', () => {
  it('apunta el id en TODAS las invitaciones del correo, no solo en el ancla', async () => {
    const { admin, from, update, enIds } = cliente({ data: [{ id: 'i1' }, { id: 'i2' }] });
    const { log, capturas } = logger();

    await recordInvitationDelivery(admin, ['i1', 'i2'], 'msg_1', log, 'paso');

    expect(from).toHaveBeenCalledWith('invitations');
    expect(update).toHaveBeenCalledWith({ delivery_message_id: 'msg_1' });
    expect(enIds).toHaveBeenCalledWith('id', ['i1', 'i2']);
    expect(capturas).toEqual([]);
  });

  it('sin invitaciones no toca la base ni se queja', async () => {
    const { admin, from } = cliente({ data: [] });
    const { log, capturas } = logger();

    await recordInvitationDelivery(admin, [], 'msg_1', log, 'paso');

    expect(from).not.toHaveBeenCalled();
    expect(capturas).toEqual([]);
  });

  it('avisa si Resend aceptó el envío pero no devolvió id', async () => {
    const { admin, from } = cliente({ data: [] });
    const { log, capturas } = logger();

    await recordInvitationDelivery(admin, ['i1'], undefined, log, 'paso');

    // No se escribe nada —no hay nada que escribir— pero SÍ se avisa: esa invitación
    // se queda sin seguimiento y es la única forma de enterarse.
    expect(from).not.toHaveBeenCalled();
    expect(capturas).toHaveLength(1);
    expect(capturas[0]!.step).toBe('paso_sin_id');
  });

  it('avisa si el UPDATE da error, y no lanza', async () => {
    const { admin } = cliente({ error: { message: 'boom' } });
    const { log, capturas } = logger();

    await expect(
      recordInvitationDelivery(admin, ['i1'], 'msg_1', log, 'paso'),
    ).resolves.toBeUndefined();
    expect(capturas).toHaveLength(1);
    expect(capturas[0]!.step).toBe('paso');
  });

  it('caza el UPDATE de CERO filas, que en PostgREST es mudo', async () => {
    // El incidente de agosto de 2026: un `.update().in()` que no casa nada no devuelve
    // error. Sin pedir la representación, el rastro se perdería sin que nadie lo supiera.
    const { admin } = cliente({ data: [] });
    const { log, capturas } = logger();

    await recordInvitationDelivery(admin, ['i1'], 'msg_1', log, 'paso');

    expect(capturas).toHaveLength(1);
    expect(capturas[0]!.step).toBe('paso_filas');
    expect(capturas[0]!.extra).toMatchObject({ esperadas: 1, tocadas: 0 });
  });

  it('caza también el caso a medias: dos hermanos y solo uno apuntado', async () => {
    const { admin } = cliente({ data: [{ id: 'i1' }] });
    const { log, capturas } = logger();

    await recordInvitationDelivery(admin, ['i1', 'i2'], 'msg_1', log, 'paso');

    expect(capturas).toHaveLength(1);
    expect(capturas[0]!.extra).toMatchObject({ esperadas: 2, tocadas: 1 });
  });

  it('NO LANZA aunque la consulta reviente: el correo ya ha salido', async () => {
    const { admin } = cliente({ rechaza: new Error('la red se fue') });
    const { log, capturas } = logger();

    await expect(
      recordInvitationDelivery(admin, ['i1'], 'msg_1', log, 'paso'),
    ).resolves.toBeUndefined();
    expect(capturas).toHaveLength(1);
    expect(capturas[0]!.step).toBe('paso_thrown');
  });
});
