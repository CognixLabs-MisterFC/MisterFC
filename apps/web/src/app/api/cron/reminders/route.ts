/**
 * F4.7 — Endpoint cron diario de recordatorios.
 *
 * Frecuencia: 1×/día, configurada en vercel.json a `0 8 * * *` (UTC).
 * Eso equivale a 09:00 Europe/Madrid en INVIERNO y 10:00 en verano —
 * Vercel Cron no soporta TZ. Aceptamos la deriva DST (ver ADR-0008
 * §Frecuencia y DST).
 *
 * Protección: `Authorization: Bearer ${CRON_SECRET}` — el header lo
 * setea Vercel automáticamente cuando dispara el cron. Cualquier
 * request sin el header correcto recibe 401.
 *
 * Lógica:
 *  1. Partidos en las próximas 24–48h con respuestas pendientes →
 *     emite `match_callup_reminder` (canal `in_app`) para cada user
 *     vinculado por player_accounts cuyo player aún no respondió.
 *  2. Entrenamientos del día anterior sin asistencia registrada →
 *     emite `attendance_pending_reminder` para cada entrenador del
 *     team (team_staff activo).
 *
 * Idempotencia: la UNIQUE en `notifications.dedupe_key` garantiza que
 * un mismo recordatorio no se duplique aunque el cron corra dos veces.
 * Las inserciones con conflicto se ignoran silenciosamente (ON CONFLICT
 * DO NOTHING).
 *
 * Out of scope (Lote B):
 *  - Push y email reales (F5 / F16 consumen las filas pending).
 *  - Cierre 24h antes del partido (no se decidió en spec).
 */

import { NextResponse } from 'next/server';
import {
  MATCH_SURFACE_TYPES,
  buildDedupeKey,
  callupEventIdFor,
  consolidateReminderTargets,
  createSupabaseAdminClient,
  dayBucketMadrid,
  type Json,
} from '@misterfc/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type NotificationRow = {
  user_id: string;
  type: 'match_callup_reminder' | 'attendance_pending_reminder';
  channel: 'in_app' | 'push';
  payload: Json;
  dedupe_key: string;
};

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function authorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron envía GET por defecto; aceptamos ambos para flexibilidad.
  return handle(req);
}

async function handle(req: Request): Promise<NextResponse> {
  if (!authorized(req)) return unauthorized();

  const supabase = createSupabaseAdminClient();
  const now = new Date();
  const dayBucket = dayBucketMadrid(now);

  const upcomingFromIso = now.toISOString();
  const upcomingToIso = new Date(
    now.getTime() + 48 * 3600_000
  ).toISOString();
  const yesterdayFromIso = new Date(
    now.getTime() - 36 * 3600_000
  ).toISOString();
  const yesterdayToIso = new Date(
    now.getTime() - 8 * 3600_000
  ).toISOString();

  const inserts: NotificationRow[] = [];

  // 1) Match callup reminders. F13B — amistoso también manda recordatorio de
  // convocatoria (misma superficie que el oficial).
  const { data: matchRows, error: matchErr } = await supabase
    .from('events')
    .select(
      `id, team_id, title, opponent_name, starts_at, tournament_id,
       match_callup_meta!inner(published_at)`
    )
    .in('type', MATCH_SURFACE_TYPES)
    .gte('starts_at', upcomingFromIso)
    .lte('starts_at', upcomingToIso)
    .not('match_callup_meta.published_at', 'is', null);

  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 500 });
  }

  type MatchRow = {
    id: string;
    team_id: string;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    tournament_id: string | null;
  };
  const matches = (matchRows ?? []).map((r) => r as unknown as MatchRow);

  // F13B (T-4) — los partidos de un TORNEO heredan la convocatoria de la
  // cabecera: su propia meta está vacía, así que el `!inner` de arriba los deja
  // fuera y la cabecera es type='tournament' (fuera de MATCH_SURFACE_TYPES). Los
  // recogemos aparte: sub-partidos (type='match', tournament_id no nulo) en la
  // ventana cuya CABECERA tiene la convocatoria publicada. El bucle los procesa
  // igual — `callupEventIdFor(m)` resuelve respuestas/roster contra la cabecera.
  const { data: tournMatchRows, error: tournErr } = await supabase
    .from('events')
    .select('id, team_id, title, opponent_name, starts_at, tournament_id')
    .eq('type', 'match')
    .not('tournament_id', 'is', null)
    .gte('starts_at', upcomingFromIso)
    .lte('starts_at', upcomingToIso);

  if (tournErr) {
    return NextResponse.json({ error: tournErr.message }, { status: 500 });
  }

  const tournMatches = (tournMatchRows ?? []).map(
    (r) => r as unknown as MatchRow,
  );
  const headerIds = Array.from(
    new Set(
      tournMatches
        .map((m) => m.tournament_id)
        .filter((id): id is string => id != null),
    ),
  );
  const publishedHeaders = new Set<string>();
  if (headerIds.length > 0) {
    const { data: hdrMetas } = await supabase
      .from('match_callup_meta')
      .select('event_id, published_at')
      .in('event_id', headerIds)
      .not('published_at', 'is', null);
    for (const r of hdrMetas ?? []) {
      publishedHeaders.add(r.event_id as string);
    }
  }
  const tournMatchesPublished = tournMatches.filter(
    (m) => m.tournament_id != null && publishedHeaders.has(m.tournament_id),
  );

  const allMatches = [...matches, ...tournMatchesPublished];

  // F13B — CONSOLIDACIÓN de recordatorios de torneo: un representante por ANCLA
  // de convocatoria (`callupEventIdFor` = cabecera para sub-partidos, propio id
  // para normales). Un torneo de finde tiene varios sub-partidos en la ventana →
  // sin consolidar sería 1 aviso por cruce (spam); con esto queda 1 por
  // torneo/día/usuario. De paso evita repetir roster/respuestas por cada
  // sub-partido (el insert los descartaría luego por dedupe_key). El
  // `pendingPlayerIds` es idéntico entre sub-partidos del mismo torneo (mismo
  // team_id + convocatoria única en la cabecera), así que el representante basta.
  // Los partidos NORMALES no cambian (cada uno es su propio grupo).
  const reminderTargets = consolidateReminderTargets(
    allMatches.filter((m) => m.team_id),
  );

  for (const m of reminderTargets) {
    if (!m.team_id) continue;

    // Ancla del recordatorio: la cabecera si es un sub-partido de torneo, el
    // propio evento si es un partido normal.
    const anchorId = callupEventIdFor(m);
    const isTournament = m.tournament_id != null;

    // Roster a fecha del partido (snapshot histórico — el cron tolera el
    // simple "current roster" porque a 24-48h del partido nadie está
    // moviéndose de team).
    const eventDate = m.starts_at.slice(0, 10);
    const { data: tms } = await supabase
      .from('team_members')
      .select('player_id, joined_at, left_at')
      .eq('team_id', m.team_id)
      .lte('joined_at', eventDate);

    type TM = {
      player_id: string;
      joined_at: string;
      left_at: string | null;
    };
    const rosterIds = (tms ?? [])
      .map((r) => r as unknown as TM)
      .filter((r) => r.left_at == null || r.left_at >= eventDate)
      .map((r) => r.player_id);
    if (rosterIds.length === 0) continue;

    // Responses ya emitidas. F13B — un partido de torneo lee/escribe sus
    // respuestas en la cabecera (convocatoria única) → se leen contra el ancla.
    const { data: resps } = await supabase
      .from('callup_responses')
      .select('player_id')
      .eq('event_id', anchorId)
      .in('player_id', rosterIds);
    const respondedIds = new Set(
      (resps ?? []).map((r) => r.player_id as string)
    );
    const pendingPlayerIds = rosterIds.filter((p) => !respondedIds.has(p));
    if (pendingPlayerIds.length === 0) continue;

    // Profiles vinculados por player_accounts.
    const { data: pas } = await supabase
      .from('player_accounts')
      .select('profile_id, player_id')
      .in('player_id', pendingPlayerIds);
    type PA = { profile_id: string; player_id: string };
    const profilesByPlayer = new Map<string, string[]>();
    for (const r of (pas ?? []) as PA[]) {
      const arr = profilesByPlayer.get(r.player_id) ?? [];
      arr.push(r.profile_id);
      profilesByPlayer.set(r.player_id, arr);
    }

    for (const playerId of pendingPlayerIds) {
      const profiles = profilesByPlayer.get(playerId) ?? [];
      for (const profileId of profiles) {
        // F13B — payload anclado a la CABECERA cuando es torneo (deep_link a la
        // convocatoria única) y con texto GENÉRICO del torneo (sin rival ni hora
        // de un cruce concreto: el sub-partido que "gana" el dedupe es no
        // determinista). `is_tournament` conmuta el texto del feed in-app
        // (localizado es/en/va en `home.feed`). Partido normal → ancla = su
        // propio id → payload/clave idénticos a hoy.
        const inAppPayload: Json = isTournament
          ? {
              event_id: anchorId,
              player_id: playerId,
              title: m.title,
              is_tournament: true,
              deep_link: `/convocatorias/${anchorId}`,
            }
          : {
              event_id: m.id,
              player_id: playerId,
              title: m.title,
              opponent_name: m.opponent_name,
              starts_at: m.starts_at,
              deep_link: `/convocatorias/${m.id}`,
            };
        inserts.push({
          user_id: profileId,
          type: 'match_callup_reminder',
          channel: 'in_app',
          payload: inAppPayload,
          dedupe_key: buildDedupeKey({
            type: 'match_callup_reminder',
            channel: 'in_app',
            event_id: anchorId,
            day_bucket: dayBucket,
            user_id: profileId,
          }),
        });
        // Push paralelo — el drainer al final lo procesa. El push va en es (como
        // el resto de recordatorios). Torneo → título = nombre del torneo, body
        // genérico sin rival/hora.
        const pushPayload: Json = isTournament
          ? {
              title: `Torneo: ${m.title}`,
              body: `Confirma tu disponibilidad para el torneo`,
              deep_link: `/es/convocatorias/${anchorId}`,
              tag: `match_callup_reminder:${anchorId}`,
            }
          : {
              title: m.opponent_name
                ? `Partido vs ${m.opponent_name}`
                : `Convocatoria pendiente`,
              body: `Confirma tu disponibilidad para ${m.title}`,
              deep_link: `/es/convocatorias/${m.id}`,
              tag: `match_callup_reminder:${m.id}`,
            };
        inserts.push({
          user_id: profileId,
          type: 'match_callup_reminder',
          channel: 'push',
          payload: pushPayload,
          dedupe_key: buildDedupeKey({
            type: 'match_callup_reminder',
            channel: 'push',
            event_id: anchorId,
            day_bucket: dayBucket,
            user_id: profileId,
          }),
        });
      }
    }
  }

  // 2) Attendance pending reminders.
  const { data: trainingRows, error: trErr } = await supabase
    .from('events')
    .select('id, team_id, title, starts_at')
    .eq('type', 'training')
    .gte('starts_at', yesterdayFromIso)
    .lte('starts_at', yesterdayToIso);

  if (trErr) {
    return NextResponse.json({ error: trErr.message }, { status: 500 });
  }

  type TrainingRow = {
    id: string;
    team_id: string | null;
    title: string;
    starts_at: string;
  };
  const trainings = (trainingRows ?? []).map(
    (r) => r as unknown as TrainingRow
  );

  for (const tr of trainings) {
    if (!tr.team_id) continue;

    const { count } = await supabase
      .from('training_attendance')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', tr.id);

    if ((count ?? 0) > 0) continue;

    // Coaches activos del team.
    const { data: staffRows } = await supabase
      .from('team_staff')
      .select('memberships!inner(profile_id)')
      .eq('team_id', tr.team_id)
      .is('left_at', null);
    type StaffRow = { memberships: { profile_id: string } };
    const coachIds = Array.from(
      new Set(
        (staffRows ?? []).map(
          (r) => (r as unknown as StaffRow).memberships.profile_id
        )
      )
    );

    for (const profileId of coachIds) {
      inserts.push({
        user_id: profileId,
        type: 'attendance_pending_reminder',
        channel: 'in_app',
        payload: {
          event_id: tr.id,
          title: tr.title,
          starts_at: tr.starts_at,
          deep_link: `/asistencia/${tr.id}`,
        },
        dedupe_key: buildDedupeKey({
          type: 'attendance_pending_reminder',
          channel: 'in_app',
          event_id: tr.id,
          day_bucket: dayBucket,
          user_id: profileId,
        }),
      });
      // Push paralelo — el drainer al final lo procesa.
      inserts.push({
        user_id: profileId,
        type: 'attendance_pending_reminder',
        channel: 'push',
        payload: {
          title: 'Asistencia pendiente',
          body: `Falta marcar la asistencia de ${tr.title}`,
          deep_link: `/es/asistencia/${tr.id}`,
          tag: `attendance_pending:${tr.id}`,
        },
        dedupe_key: buildDedupeKey({
          type: 'attendance_pending_reminder',
          channel: 'push',
          event_id: tr.id,
          day_bucket: dayBucket,
          user_id: profileId,
        }),
      });
    }
  }

  // Insert con on conflict do nothing (idempotente vía UNIQUE dedupe_key).
  let inserted = 0;
  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from('notifications')
      .upsert(inserts, {
        onConflict: 'dedupe_key',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted = data?.length ?? 0;
  }

  // F5.7 — Drainer de push notifications pending. Rate-limited a 100 por
  // ejecución para no saturar el cron ni el push service. Las que sobren
  // quedan para mañana.
  const drainResult = await drainPushQueue(supabase, 100);

  return NextResponse.json({
    ok: true,
    queued: inserts.length,
    inserted,
    day_bucket: dayBucket,
    matches_scanned: allMatches.length,
    reminder_targets: reminderTargets.length,
    trainings_scanned: trainings.length,
    push_drain: drainResult,
  });
}

type DrainResult = {
  scanned: number;
  sent: number;
  skipped_user_pref: number;
  failed_gone: number;
  failed_other: number;
  no_subscriptions: number;
};

async function drainPushQueue(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  cap: number,
): Promise<DrainResult> {
  const result: DrainResult = {
    scanned: 0,
    sent: 0,
    skipped_user_pref: 0,
    failed_gone: 0,
    failed_other: 0,
    no_subscriptions: 0,
  };

  const { data: pendings } = await supabase
    .from('notifications')
    .select('id, user_id, type, payload')
    .eq('channel', 'push')
    .eq('status', 'pending')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(cap);

  if (!pendings || pendings.length === 0) return result;
  result.scanned = pendings.length;

  // Importamos lazy para que la ruta no falle en build si web-push no está
  // disponible (también nos protege en tests).
  const { sendPushToUser, pushPayloadFromNotificationRow } = await import(
    '@/lib/web-push'
  );

  for (const row of pendings) {
    const payload = pushPayloadFromNotificationRow({
      payload: row.payload,
      type: row.type,
    });
    try {
      const r = await sendPushToUser(supabase, row.user_id, row.type, payload);
      result.sent += r.sent;
      result.failed_gone += r.failed_gone;
      result.failed_other += r.failed_other;

      if (r.skipped_user_pref) {
        result.skipped_user_pref += 1;
        await supabase
          .from('notifications')
          .update({ status: 'skipped', sent_at: new Date().toISOString() })
          .eq('id', row.id);
      } else if (r.skipped_no_subscriptions) {
        result.no_subscriptions += 1;
        // Lo dejamos pending — quizá el user se suscribe mañana.
      } else if (r.sent > 0) {
        await supabase
          .from('notifications')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', row.id);
      } else if (r.failed_gone > 0 && r.failed_other === 0 && r.sent === 0) {
        // Todos los endpoints estaban muertos. Marcar failed.
        await supabase
          .from('notifications')
          .update({ status: 'failed', sent_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    } catch {
      result.failed_other += 1;
    }
  }

  return result;
}
