import { describe, it, expect, vi } from 'vitest';
import { GOAL_PUSH_PATH, nudgeGoalPush, type NudgeCaller } from '@/directo/goal-push-nudge';

/**
 * El empujón del gol. Lo que se vigila aquí no es que el push llegue —eso es del
 * servidor— sino que esta función NO PUEDA HACER DAÑO: el gol ya está subido y
 * pintado cuando se la llama, así que ningún camino puede lanzar, y los eventos que
 * no son goles no deben generar ni una llamada.
 */

function respuesta(ok: boolean, status = ok ? 200 : 403): Response {
  return { ok, status } as Response;
}

const GOL = { id: '90f00000-0000-4000-8000-000000000001', type: 'goal' };

describe('nudgeGoalPush · a quién se empuja', () => {
  it('un gol se empuja, con su id en el cuerpo', async () => {
    const call = vi.fn<NudgeCaller>().mockResolvedValue(respuesta(true));
    expect(await nudgeGoalPush(GOL, call)).toBe('empujado');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(GOAL_PUSH_PATH, {
      method: 'POST',
      body: { goalRowId: GOL.id },
    });
  });

  it('un penalti MARCADO también es gol (igual que el WHEN del trigger)', async () => {
    const call = vi.fn<NudgeCaller>().mockResolvedValue(respuesta(true));
    const r = await nudgeGoalPush(
      { id: GOL.id, type: 'penalty', metadata: { outcome: 'scored' } },
      call,
    );
    expect(r).toBe('empujado');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('un penalti FALLADO no', async () => {
    const call = vi.fn<NudgeCaller>().mockResolvedValue(respuesta(true));
    const r = await nudgeGoalPush(
      { id: GOL.id, type: 'penalty', metadata: { outcome: 'missed' } },
      call,
    );
    expect(r).toBe('no_es_gol');
    expect(call).not.toHaveBeenCalled();
  });

  it('una tarjeta no llama a nadie: no hay push que mandar', async () => {
    const call = vi.fn<NudgeCaller>().mockResolvedValue(respuesta(true));
    expect(await nudgeGoalPush({ id: GOL.id, type: 'yellow_card' }, call)).toBe('no_es_gol');
    expect(call).not.toHaveBeenCalled();
  });

  it('un cambio tampoco', async () => {
    const call = vi.fn<NudgeCaller>().mockResolvedValue(respuesta(true));
    expect(await nudgeGoalPush({ id: GOL.id, type: 'substitution' }, call)).toBe('no_es_gol');
    expect(call).not.toHaveBeenCalled();
  });
});

describe('nudgeGoalPush · no puede hacer daño', () => {
  it('un 403 no lanza: devuelve fallo y el cron lo recoge', async () => {
    const call = vi.fn<NudgeCaller>().mockResolvedValue(respuesta(false, 403));
    await expect(nudgeGoalPush(GOL, call)).resolves.toBe('fallo');
  });

  it('la red caída no lanza', async () => {
    const call = vi.fn<NudgeCaller>().mockRejectedValue(new Error('Network request failed'));
    await expect(nudgeGoalPush(GOL, call)).resolves.toBe('fallo');
  });

  it('sin sesión no es un fallo de envío: es que no había camino', async () => {
    const call = vi.fn<NudgeCaller>().mockRejectedValue(new Error('no_session'));
    await expect(nudgeGoalPush(GOL, call)).resolves.toBe('sin_camino');
  });

  it('sin EXPO_PUBLIC_WEB_URL, lo mismo', async () => {
    const call = vi.fn<NudgeCaller>().mockRejectedValue(new Error('no_web_url'));
    await expect(nudgeGoalPush(GOL, call)).resolves.toBe('sin_camino');
  });

  it('algo que no es un Error tampoco rompe', async () => {
    const call = vi.fn<NudgeCaller>().mockRejectedValue('vaya');
    await expect(nudgeGoalPush(GOL, call)).resolves.toBe('fallo');
  });
});
