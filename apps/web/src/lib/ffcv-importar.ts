/**
 * EL BOTÓN DE CALENDARIO QUE DA DE ALTA LOS PARTIDOS FEDERADOS — lado servidor.
 *
 * ── POR QUÉ ESTO SON RUTAS Y NO UNA SERVER ACTION ───────────────────────────────────
 * Importar los quince equipos son ~458 llamadas a la FFCV, y la FFCV corta a las 60 por
 * minuto (#769): el suelo son SIETE MINUTOS Y MEDIO. Una invocación de Vercel no vive
 * tanto —en el plan Pro el techo son 300 s—, así que no cabe en un solo viaje. La forma
 * acordada con Jose es que el NAVEGADOR mande: pulsa una vez y la página hace dieciséis
 * viajes, uno de preparación y uno por equipo, con la barra avanzando. Cada viaje son
 * ~29 llamadas, unos 35 s, muy dentro del techo.
 *
 * Se eligen route handlers y no Server Actions por una razón concreta y no por gusto: el
 * `maxDuration` de un handler es inequívoco y está en su propio fichero, mientras que el
 * de una action depende del segmento que la invoca. Con 35 s por viaje y 15 s de techo
 * por defecto, equivocarse ahí es que la importación muera a mitad.
 *
 * ── EL CATÁLOGO DE CAMPOS VIAJA, Y ESO ES DELIBERADO ────────────────────────────────
 * El catálogo son 23 páginas (2.213 campos, 214 KB el mapa nombre→dirección). Si cada
 * viaje lo descargara, serían 345 llamadas en vez de 23 y la importación pasaría de 7 a
 * 13 minutos. Así que lo descarga el viaje de preparación y lo devuelve; el navegador lo
 * guarda y lo manda en cada viaje. Que pase por el cliente no abre nada: quien pulsa es
 * admin o director y ya puede escribir cualquier dirección a mano en cualquier evento.
 *
 * ── LA PUERTA ───────────────────────────────────────────────────────────────────────
 * Dos cierres, y el segundo es el que manda:
 *   1. Aquí se exige admin_club o director del club activo. Es para no gastar 458
 *      llamadas a la FFCV por alguien que no va a poder escribir.
 *   2. La RLS. El INSERT va con el cliente del USUARIO, nunca service-role, y
 *      `user_can_manage_event` decide. Un no autorizado se queda en 42501.
 * Y de ahí sale lo que Jose pidió: los eventos los firma QUIEN PULSA
 * (`created_by = su profile`), no un perfil «Importador FFCV» ni el service-role.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  activeSeasonLabel,
  importarEquipoConDireccionesFromClient,
  prepararImportacionFromClient,
  type EquipoParaImportar,
  type PreparacionFfcv,
  type ResumenEquipo,
  type Database,
} from '@misterfc/core';
import { resolveUserFromRequest } from '@/lib/resolve-user';

/**
 * El tiempo que se le da a un viaje antes de rendirse, por debajo del `maxDuration` de
 * 300 s de las rutas.
 *
 * Los 50 s de margen no son por gusto: la paciencia del cliente ante un 503 llega a
 * ~101 s por llamada, y sin este freno DOS cortes en un viaje se pasan del techo y
 * **Vercel mata la invocación**. Una invocación muerta no devuelve nada —ni qué equipo
 * falló, ni por qué—, mientras que rendirse a tiempo devuelve un fallo con nombre que la
 * barra sabe pintar. Más vale un «este equipo no se pudo leer» que un silencio.
 */
const MARGEN_MS = 250_000;

export type ErrorFfcv =
  | 'unauthorized'
  | 'forbidden'
  | 'no_active_season'
  | 'invalid'
  | 'not_found'
  | 'ffcv';

type Contexto = {
  /** El cliente del USUARIO, RLS-scoped. Nunca admin: la RLS es el cierre que manda. */
  supabase: SupabaseClient<Database>;
  clubId: string;
  season: string;
  actorProfileId: string;
};

/**
 * Identidad + puerta de dirección + temporada activa.
 *
 * La temporada sale de la fila `seasons` con `status='active'`, NO del reloj: es la
 * fuente de verdad del club (Rework C5) y `currentSeason()` solo sugiere un label.
 * Importar en la temporada equivocada crearía 390 eventos en equipos que no juegan.
 */
export async function contextoFfcv(
  req: Request,
): Promise<{ ok: true; ctx: Contexto } | { ok: false; error: ErrorFfcv }> {
  const auth = await resolveUserFromRequest(req);
  if (!auth) return { ok: false, error: 'unauthorized' };
  // El botón es de la web: sin shell no hay club activo y no hay nada que importar.
  if (!auth.shell) return { ok: false, error: 'forbidden' };

  const rol = auth.shell.activeClub.role;
  if (rol !== 'admin_club' && rol !== 'director') return { ok: false, error: 'forbidden' };

  const clubId = auth.shell.activeClub.club.id;
  const { data, error } = await auth.supabase
    .from('seasons')
    .select('label, status')
    .eq('club_id', clubId);
  if (error) return { ok: false, error: 'no_active_season' };
  const season = activeSeasonLabel(data ?? []);
  if (!season) return { ok: false, error: 'no_active_season' };

  return {
    ok: true,
    ctx: {
      supabase: auth.supabase,
      clubId,
      season,
      actorProfileId: auth.shell.user.id,
    },
  };
}

/** Viaje 1 de 16: los equipos del club y el mapa de direcciones. */
export async function prepararFfcv(
  req: Request,
): Promise<{ ok: true; datos: PreparacionFfcv } | { ok: false; error: ErrorFfcv; detalle?: string }> {
  const c = await contextoFfcv(req);
  if (!c.ok) return { ok: false, error: c.error };

  const r = await prepararImportacionFromClient(
    c.ctx.supabase,
    { clubId: c.ctx.clubId, season: c.ctx.season },
    { vencimientoMs: Date.now() + MARGEN_MS },
  );
  if (!r.ok) return { ok: false, error: 'ffcv', detalle: r.detalle };
  return { ok: true, datos: r.datos };
}

/**
 * Viajes 2 a 16: los partidos de UN equipo.
 *
 * El `teamId` que llega del navegador NO se usa para construir nada: se vuelve a leer el
 * equipo de la base y se busca entre los importables de ESTE club y ESTA temporada. Así
 * un teamId de otro club no importa nada, aunque la RLS lo pararía igual.
 */
export async function importarEquipoFfcv(
  req: Request,
  cuerpo: { teamId: unknown; direcciones: unknown },
): Promise<{ ok: true; resumen: ResumenEquipo } | { ok: false; error: ErrorFfcv; detalle?: string }> {
  const c = await contextoFfcv(req);
  if (!c.ok) return { ok: false, error: c.error };

  if (typeof cuerpo.teamId !== 'string' || cuerpo.teamId.length === 0) {
    return { ok: false, error: 'invalid' };
  }
  const direcciones = mapaValido(cuerpo.direcciones);
  if (direcciones === null) return { ok: false, error: 'invalid' };

  const preparado = await prepararEquipos(c.ctx);
  if (!preparado.ok) return { ok: false, error: 'ffcv', detalle: preparado.detalle };

  const equipo = preparado.equipos.find((e) => e.teamId === cuerpo.teamId);
  if (!equipo) return { ok: false, error: 'not_found' };

  const resumen = await importarEquipoConDireccionesFromClient(
    c.ctx.supabase,
    { equipo, direcciones, actorProfileId: c.ctx.actorProfileId },
    { vencimientoMs: Date.now() + MARGEN_MS },
  );
  return { ok: true, resumen };
}

/** Solo los equipos: este viaje NO vuelve a descargar el catálogo (lo trae el navegador). */
async function prepararEquipos(
  ctx: Contexto,
): Promise<{ ok: true; equipos: EquipoParaImportar[] } | { ok: false; detalle: string }> {
  const { data, error } = await ctx.supabase
    .from('teams')
    .select(
      'id, name, club_id, ffcv_team_code, ffcv_season_code, ffcv_competition_code, ffcv_group_code',
    )
    .eq('club_id', ctx.clubId)
    .eq('season', ctx.season)
    .order('name');
  if (error) return { ok: false, detalle: String(error.message ?? error) };

  const equipos: EquipoParaImportar[] = [];
  for (const t of data ?? []) {
    if (
      !t.ffcv_team_code ||
      !t.ffcv_season_code ||
      !t.ffcv_competition_code ||
      !t.ffcv_group_code
    ) {
      continue;
    }
    equipos.push({
      teamId: t.id,
      clubId: t.club_id,
      nombre: t.name,
      ffcvTeamCode: t.ffcv_team_code,
      ffcvSeasonCode: t.ffcv_season_code,
      ffcvCompetitionCode: t.ffcv_competition_code,
      ffcvGroupCode: t.ffcv_group_code,
    });
  }
  return { ok: true, equipos };
}

/** El mapa que manda el navegador: solo string→string. Cualquier otra cosa se rechaza. */
function mapaValido(valor: unknown): Record<string, string> | null {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof v !== 'string') return null;
    salida[k] = v;
  }
  return salida;
}
