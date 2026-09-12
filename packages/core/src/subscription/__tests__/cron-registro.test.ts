import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SU-6b — CENSO de los crons: todo endpoint `/api/cron/*` tiene que estar en
 * `vercel.json`.
 *
 * Un cron que existe y no está registrado NO falla: responde 200 si alguien lo llama, no
 * aparece en ningún log y simplemente no corre nunca. Con dos crons se veía; con el
 * tercero ya no, y este de la suscripción es justo uno de los que nadie echaría de menos
 * hasta que una familia se quedara sin aviso o una fila mintiera un mes.
 *
 * Mismo criterio que el censo de layouts de SU-5: lo que se vigila es "el segundo sitio
 * que se olvida", y se vigila leyendo el árbol de verdad, no una lista a mano.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'apps/web/vercel.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro la raíz del repo subiendo desde ${process.cwd()}`);
}

describe('censo de crons', () => {
  const root = repoRoot();
  const cronsDir = join(root, 'apps/web/src/app/api/cron');
  const vercel = JSON.parse(readFileSync(join(root, 'apps/web/vercel.json'), 'utf8')) as {
    crons?: { path: string; schedule: string }[];
  };
  const registered = new Set((vercel.crons ?? []).map((c) => c.path));

  const routes = readdirSync(cronsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(cronsDir, e.name, 'route.ts')))
    .map((e) => e.name);

  it('hay crons que censar', () => {
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it.each(routes)('/api/cron/%s está registrado en vercel.json', (name) => {
    expect(registered.has(`/api/cron/${name}`), `/api/cron/${name} no está en vercel.json`).toBe(
      true,
    );
  });

  it('no hay registrado ningún cron que no exista', () => {
    for (const path of registered) {
      const name = path.replace('/api/cron/', '');
      expect(routes, `${path} está en vercel.json pero no existe el route`).toContain(name);
    }
  });

  // Los tres a horas distintas: comparten función serverless y secreto, y solaparlos
  // hace que un fallo de uno se lea como fallo del otro.
  it('no hay dos crons a la misma hora', () => {
    const schedules = (vercel.crons ?? []).map((c) => c.schedule);
    expect(new Set(schedules).size).toBe(schedules.length);
  });

  // El cron de la suscripción va DESPUÉS del de borrado de cuenta: ese anonimiza y
  // desengancha entitlements, y así esta pasada ya los ve fuera de la lista.
  it('el cron de suscripción corre después del de borrado de cuenta', () => {
    const hour = (path: string) =>
      Number((vercel.crons ?? []).find((c) => c.path === path)?.schedule.split(' ')[1]);
    expect(hour('/api/cron/subscriptions')).toBeGreaterThan(hour('/api/cron/account-deletions'));
  });
});
