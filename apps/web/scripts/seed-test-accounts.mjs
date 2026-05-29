/**
 * Seed de 3 cuentas de prueba en el club "Club Beta Test" para smoke
 * testing de F4 Lote B (convocatorias + cron de recordatorios).
 *
 * Usa supabase.auth.admin.createUser con email_confirm=true para evitar
 * el flujo de verificación por email (que pegaría rate limit en SMTP de
 * Supabase mientras F16 no entregue SMTP propio).
 *
 * El script es idempotente: si ya existe el auth user, el profile, el
 * membership, el player o la fila player_account, no falla. Reutiliza
 * la fila existente. Por tanto es seguro ejecutarlo varias veces.
 *
 * Cuentas creadas:
 *   1. jovimib+jugador1@gmail.com → role=jugador, player_account(Jose Milla, self)
 *   2. jovimib+familia1@gmail.com → role=jugador, player_account(Jose Milla, parent)
 *   3. jovimib+jugador2@gmail.com → role=jugador, player_account(<player2>, self)
 *
 * El segundo player ("Andrés Test") se crea si no existe y se incorpora
 * al mismo equipo activo de Jose (Alevin B).
 *
 * Documentación: docs/journey/cuentas-prueba.md
 *
 * Uso:
 *   cd apps/web && node scripts/seed-test-accounts.mjs
 *
 * Requisitos en apps/web/.env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (¡bypassa RLS, no commitear nunca!)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const BETA_TEST_SLUG = 'club-beta-test';
const PASSWORD = 'test1234';

const ACCOUNTS = [
  {
    email: 'jovimib+jugador1@gmail.com',
    full_name: 'Jugador 1 (Jose self)',
    player_match: { first_name: 'Jose', last_name: 'Milla' },
    relation: 'self',
  },
  {
    email: 'jovimib+familia1@gmail.com',
    full_name: 'Familia 1 (Jose parent)',
    player_match: { first_name: 'Jose', last_name: 'Milla' },
    relation: 'parent',
  },
  {
    email: 'jovimib+jugador2@gmail.com',
    full_name: 'Jugador 2 (Andrés self)',
    player_match: {
      first_name: 'Andrés',
      last_name: 'Test',
      create_if_missing: {
        date_of_birth: '2015-03-15',
        // Se asigna al mismo equipo activo que el otro player.
      },
    },
    relation: 'self',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Env loader
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, '../.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en apps/web/.env.local'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function die(msg, extra) {
  console.error(`✗ ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

async function findAuthUserByEmail(email) {
  // No hay endpoint directo "getByEmail", paginamos listUsers.
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) die(`listUsers fallo: ${error.message}`);
    const u = data.users.find((u) => u.email === email);
    if (u) return u;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureAuthUser({ email, full_name }) {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    console.log(`  ↻ auth user existe → ${existing.id}`);
    return existing;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error || !data?.user) die(`createUser ${email} fallo`, error);
  console.log(`  ✚ auth user creado → ${data.user.id}`);
  return data.user;
}

async function ensureProfile(userId, full_name) {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (existing) {
    console.log(`  ↻ profile existe`);
    return;
  }
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, full_name, locale: 'es' });
  if (error) die(`profile insert fallo`, error);
  console.log(`  ✚ profile creado`);
}

async function ensureMembership(profileId, clubId, role) {
  const { data: existing } = await supabase
    .from('memberships')
    .select('id, role')
    .eq('profile_id', profileId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (existing) {
    console.log(`  ↻ membership existe (role=${existing.role})`);
    return;
  }
  const { error } = await supabase
    .from('memberships')
    .insert({ profile_id: profileId, club_id: clubId, role });
  if (error) die(`membership insert fallo`, error);
  console.log(`  ✚ membership creado (role=${role})`);
}

async function ensurePlayer(clubId, { first_name, last_name }, createOpts) {
  const { data: existing } = await supabase
    .from('players')
    .select('id, first_name, last_name')
    .eq('club_id', clubId)
    .eq('first_name', first_name)
    .eq('last_name', last_name)
    .maybeSingle();
  if (existing) {
    console.log(`  ↻ player ${first_name} ${last_name} existe → ${existing.id}`);
    return existing.id;
  }
  if (!createOpts) {
    die(
      `player ${first_name} ${last_name} no encontrado y no se pidió create_if_missing`
    );
  }
  const { data, error } = await supabase
    .from('players')
    .insert({
      club_id: clubId,
      first_name,
      last_name,
      date_of_birth: createOpts.date_of_birth,
    })
    .select('id')
    .single();
  if (error) die(`player insert fallo`, error);
  console.log(`  ✚ player ${first_name} ${last_name} creado → ${data.id}`);
  return data.id;
}

async function ensureTeamMember(playerId, teamId) {
  const { data: active } = await supabase
    .from('team_members')
    .select('id')
    .eq('player_id', playerId)
    .eq('team_id', teamId)
    .is('left_at', null)
    .maybeSingle();
  if (active) {
    console.log(`  ↻ team_member activo ya existe`);
    return;
  }
  const { error } = await supabase
    .from('team_members')
    .insert({ player_id: playerId, team_id: teamId });
  if (error) die(`team_member insert fallo`, error);
  console.log(`  ✚ team_member creado`);
}

async function ensurePlayerAccount(playerId, profileId, relation) {
  const { data: existing } = await supabase
    .from('player_accounts')
    .select('id, relation')
    .eq('player_id', playerId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (existing) {
    console.log(
      `  ↻ player_account existe (relation=${existing.relation})`
    );
    return;
  }
  const { error } = await supabase
    .from('player_accounts')
    .insert({ player_id: playerId, profile_id: profileId, relation });
  if (error) die(`player_account insert fallo`, error);
  console.log(`  ✚ player_account creado (relation=${relation})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const { data: club } = await supabase
  .from('clubs')
  .select('id, name')
  .eq('slug', BETA_TEST_SLUG)
  .maybeSingle();
if (!club) die(`No se encontró club con slug=${BETA_TEST_SLUG}`);
console.log(`Club: ${club.name} (${club.id})\n`);

// Equipo donde añadir el player2. Tomamos el team activo del player1 (Jose).
const { data: jose } = await supabase
  .from('players')
  .select('id')
  .eq('club_id', club.id)
  .eq('first_name', 'Jose')
  .eq('last_name', 'Milla')
  .maybeSingle();
if (!jose) die('Jose Milla no existe en Beta Test');
const { data: joseTeams } = await supabase
  .from('team_members')
  .select('team_id')
  .eq('player_id', jose.id)
  .is('left_at', null);
if (!joseTeams?.length) die('Jose no tiene team activo');
const activeTeamId = joseTeams[0].team_id;
console.log(`Team activo de Jose: ${activeTeamId}\n`);

// Procesa cada cuenta.
for (const acc of ACCOUNTS) {
  console.log(`▶ ${acc.email}`);
  const user = await ensureAuthUser(acc);
  await ensureProfile(user.id, acc.full_name);
  await ensureMembership(user.id, club.id, 'jugador');
  const playerId = await ensurePlayer(
    club.id,
    acc.player_match,
    acc.player_match.create_if_missing
  );
  if (acc.player_match.create_if_missing) {
    await ensureTeamMember(playerId, activeTeamId);
  }
  await ensurePlayerAccount(playerId, user.id, acc.relation);
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación final
// ─────────────────────────────────────────────────────────────────────────────

console.log('─── Verificación ───');
for (const acc of ACCOUNTS) {
  const u = await findAuthUserByEmail(acc.email);
  const { data: m } = await supabase
    .from('memberships')
    .select('role, club_id')
    .eq('profile_id', u.id)
    .eq('club_id', club.id)
    .single();
  const { data: pa } = await supabase
    .from('player_accounts')
    .select('player_id, relation, players(first_name, last_name)')
    .eq('profile_id', u.id);
  console.log(`\n${acc.email}`);
  console.log(`  user_id: ${u.id}`);
  console.log(`  membership: ${m?.role} en ${m?.club_id}`);
  for (const r of pa ?? []) {
    console.log(
      `  player_account: ${r.players?.first_name} ${r.players?.last_name} (${r.relation})`
    );
  }
}
console.log('\n✓ seed completado');
