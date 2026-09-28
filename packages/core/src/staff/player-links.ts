import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import { formatPlayerName } from '../utils/name';

type DbClient = SupabaseClient<Database>;

/**
 * W-5 — VINCULAR UN JUGADOR a alguien que ya está en el club: hijo o tutelado, sin
 * pasar por una invitación por correo.
 *
 * Tres reglas vivían en `apps/web` y ninguna la ejecutaba nadie: quién puede
 * hacerlo, a quién se le puede vincular, y qué significa cada fallo de la escritura.
 * Aquí bajan juntas porque la ficha nativa pide exactamente las tres.
 *
 * ── EL PERMISO REAL, ENTERO (la policy `player_accounts_write_admin`) ────────
 * La policy es `for all to authenticated` y admite DOS ramas:
 *
 *   exists (select 1 from players p
 *             where p.id = player_accounts.player_id
 *               and user_role_in_club(p.club_id) = any (array['admin_club','director']))
 *   or exists (select 1 from team_members tm
 *                where tm.player_id = player_accounts.player_id
 *                  and tm.left_at is null
 *                  and user_coordinates_team(tm.team_id))
 *
 * O sea: el COORDINADOR también escribe, pero solo con los jugadores de los equipos
 * que coordina. Y `canLinkPlayers` deja fuera al coordinador A PROPÓSITO, que no es
 * lo mismo que por error:
 *
 *   · `players_select_member` deja a CUALQUIER miembro del club leer TODOS sus
 *     jugadores (`user_role_in_club(club_id) is not null`, medido: ninguna migración
 *     posterior la estrecha). Así que la lista de candidatos que le llegaría al
 *     coordinador sería el club entero, mientras que su INSERT solo pasa para un
 *     subconjunto. Ofrecerle eso es ofrecerle sobre todo errores 42501 — el mismo
 *     fallo que W-2b quitó de la web, pero por jugador en vez de por equipo.
 *   · Darle su subconjunto es posible y es trabajo: pide cruzar `team_members` con
 *     los equipos que coordina, igual que `coordinatedTeamIds` en W-3. Hoy no se
 *     hace, y por eso no se le ofrece NADA en vez de ofrecérselo mal.
 *
 * Esa decisión ya estaba escrita —y bien— en `cuerpo-tecnico/[membershipId]/page.tsx`.
 * Lo que NO estaba bien son otros dos comentarios de la web, que decían que la policy
 * «es de admin_club/director» sin más: eso induce a construir el candado equivocado,
 * y este PR los corrige.
 *
 * ── SIN ENDPOINT, y a diferencia de W-2/W-3 ─────────────────────────────────
 * `player_accounts` es una tabla y su gate es la RLS, así que la app escribe con su
 * propia sesión igual que la web con su cookie: las dos llegan a PostgREST como el
 * usuario y las dos pasan por la misma policy. Es lo que ya hacen ocho módulos de
 * core (asistencia, convocatorias, anuncios, alineaciones, seguidores…).
 *
 * Un route handler aquí no añadiría ningún candado: el de W-2 coge el bearer,
 * construye un cliente RLS-scoped —nunca admin— y llama a core, sin revalidar nada
 * ni tocar el service-role. Se midió al empezar W-5.
 */

/** Las relaciones que se pueden ELEGIR al vincular. `self` no está: ver abajo. */
export type PlayerLinkRelation = 'parent' | 'guardian';

export const PLAYER_LINK_RELATIONS: readonly PlayerLinkRelation[] = [
  'parent',
  'guardian',
];

/**
 * Lo que puede traer una fila YA existente, que no es lo mismo que lo que se puede
 * elegir. La columna es `text not null check (relation in ('self','parent','guardian'))`.
 *
 * `self` significa «la cuenta del propio jugador» y nace por otro camino
 * (`inviteSelfForPlayer`). Aparece aquí porque un miembro del club puede ser además
 * jugador adulto con cuenta propia, y entonces su ficha tiene esa fila. No se ofrece
 * y no se acepta al escribir, pero se LEE y hay que saber pintarla.
 */
export type LinkedPlayerRelation = PlayerLinkRelation | 'self';

/** Un jugador ya vinculado a esta persona. */
export type LinkedPlayer = {
  linkId: string;
  playerId: string;
  fullName: string;
  relation: LinkedPlayerRelation;
};

/** Un jugador al que todavía se la puede vincular. */
export type PlayerLinkCandidate = { playerId: string; fullName: string };

export type MemberPlayerLinks = {
  linked: LinkedPlayer[];
  candidates: PlayerLinkCandidate[];
};

/**
 * ¿Puede este rol vincular jugadores a un miembro del club?
 *
 * Estaba escrito a mano en TRES sitios de `apps/web` (la ficha del miembro, la lista
 * de jugadores y la ficha de un jugador) y viajaba por prop a dos diálogos más. Como
 * los tres decían lo mismo, nadie notaba que la regla no la ejecutaba ningún test.
 *
 * NO es el permiso de asignar equipos (ahí el coordinador SÍ entra) ni el de editar
 * la identidad (que lo imponen dos RPC). Son tres decisiones distintas que hoy
 * coinciden en dos roles, y tienen que poder cambiar por separado.
 */
export function canLinkPlayers(role: Role | null | undefined): boolean {
  return role === 'admin_club' || role === 'director';
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esRelacionOfrecible(v: unknown): v is PlayerLinkRelation {
  return (
    typeof v === 'string' &&
    (PLAYER_LINK_RELATIONS as readonly string[]).includes(v)
  );
}

function esRelacionLeida(v: unknown): v is LinkedPlayerRelation {
  return v === 'self' || esRelacionOfrecible(v);
}

/**
 * Hijos y tutelados de un miembro, y a quién más se le puede vincular.
 *
 * Bajada de `cuerpo-tecnico/queries.ts`. Las exclusiones de la lista de candidatos no
 * son cosmética, cada una evita un desenlace concreto:
 *   · los YA vinculados a ESTA persona → chocarían con `UNIQUE (player_id, profile_id)`;
 *   · los suprimidos por RGPD (`erased_at`) → no se ofrece un dato que se borró;
 *   · las bajas del club (`left_club_at`) → vincular a un tutor con quien ya se fue
 *     no es un alta, es un enredo.
 *
 * Que un jugador tenga VARIOS tutores sí es normal: no se descarta a los que ya
 * tienen otra cuenta vinculada.
 *
 * `linked` se filtra por club en memoria y no en la consulta porque el club está en
 * `players`, no en `player_accounts`: la fila es de la PERSONA, no de su papel en el
 * club. Si mañana deja de ser entrenadora, sigue siendo la madre.
 *
 * Lo que devuelve depende de quién pregunta, y eso lo decide la RLS
 * `player_accounts_select_self_or_staff`, no esto: admin_club, director y los dos
 * entrenadores ven los vínculos de todo el club; el coordinador, solo los de los
 * jugadores de sus equipos. Quien la llame desde una pantalla que alcance un
 * coordinador tiene que saber que su lista viene recortada — hoy la ficha nativa no
 * lo es (el área 'direction' es solo admin_club y director).
 */
export async function getMemberPlayerLinksFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    /** El PERFIL del miembro, no su membresía: `player_accounts` guarda profile_id. */
    profileId: string;
  },
  onError?: (err: unknown) => void,
): Promise<MemberPlayerLinks> {
  type FilaVinculo = {
    id: string;
    player_id: string;
    relation: string;
    players: {
      id: string;
      first_name: string;
      last_name: string | null;
      club_id: string;
    };
  };

  const { data: rawLinks, error: errLinks } = await supabase
    .from('player_accounts')
    .select(
      'id, player_id, relation, players!inner(id, first_name, last_name, club_id)',
    )
    .eq('profile_id', params.profileId);
  if (errLinks) onError?.(errLinks);

  const linked: LinkedPlayer[] = ((rawLinks ?? []) as unknown as FilaVinculo[])
    .filter((r) => r.players.club_id === params.clubId)
    .filter((r) => esRelacionLeida(r.relation))
    .map((r) => ({
      linkId: r.id,
      playerId: r.player_id,
      fullName: formatPlayerName(r.players.first_name, r.players.last_name),
      relation: r.relation as LinkedPlayerRelation,
    }))
    .sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }),
    );

  const yaVinculados = new Set(linked.map((l) => l.playerId));

  const { data: rawPlayers, error: errPlayers } = await supabase
    .from('players')
    .select('id, first_name, last_name')
    .eq('club_id', params.clubId)
    .is('erased_at', null)
    .is('left_club_at', null);
  if (errPlayers) onError?.(errPlayers);

  type FilaJugador = { id: string; first_name: string; last_name: string | null };
  const candidates: PlayerLinkCandidate[] = (
    (rawPlayers ?? []) as unknown as FilaJugador[]
  )
    .filter((p) => !yaVinculados.has(p.id))
    .map((p) => ({
      playerId: p.id,
      fullName: formatPlayerName(p.first_name, p.last_name),
    }))
    .sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }),
    );

  return { linked, candidates };
}

export type LinkPlayerError =
  | 'player_invalid'
  | 'relation_invalid'
  | 'cross_club'
  | 'already_linked'
  | 'forbidden'
  | 'generic';

export type LinkPlayerResult = { ok: true } | { ok: false; error: LinkPlayerError };

/**
 * LA ESCRITURA. Seis desenlaces con nombre, dos de ellos deducidos de códigos de
 * Postgres — que es exactamente el motivo de que no pueda haber una segunda copia:
 * una copia acierta en los cuatro primeros y falla en los dos últimos.
 *
 *   · 42501 → `forbidden`: lo dice la RLS, no esto. Aquí no se recomprueba el
 *     permiso, igual que en W-1/W-2: `canLinkPlayers` solo sirve para no OFRECER lo
 *     que el servidor va a rechazar. Un segundo candado sería una copia más.
 *   · 23505 → `already_linked`: el `UNIQUE (player_id, profile_id)`.
 *
 * `relation` se valida ANTES del INSERT, y no es un adorno: la columna acepta `self`
 * y el CHECK no lo impediría. Un `self` escrito por aquí significaría «la cuenta del
 * propio jugador» en la fila de otra persona, y eso no lo arregla nadie después. La
 * web lo cortaba con un Zod que ahora delega aquí; si esta comprobación desaparece,
 * el hueco no lo tapa nada.
 *
 * La membresía se lee para sacar el PERFIL y el club. Si no se ve, `forbidden`: quien
 * no alcanza la membresía tampoco tiene por qué saber si existe.
 */
export async function linkPlayerToMember(
  supabase: DbClient,
  params: { membershipId: string; playerId: string; relation: unknown },
): Promise<LinkPlayerResult> {
  if (!UUID_RE.test(params.playerId)) return { ok: false, error: 'player_invalid' };
  if (!esRelacionOfrecible(params.relation)) {
    return { ok: false, error: 'relation_invalid' };
  }
  const relation = params.relation;

  const { data: membership } = await supabase
    .from('memberships')
    .select('id, profile_id, club_id')
    .eq('id', params.membershipId)
    .maybeSingle();
  if (!membership) return { ok: false, error: 'forbidden' };

  const { data: player } = await supabase
    .from('players')
    .select('id, club_id')
    .eq('id', params.playerId)
    .maybeSingle();
  if (!player) return { ok: false, error: 'player_invalid' };
  if ((player.club_id as string) !== (membership.club_id as string)) {
    return { ok: false, error: 'cross_club' };
  }

  const { error } = await supabase.from('player_accounts').insert({
    player_id: params.playerId,
    profile_id: membership.profile_id as string,
    relation,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') return { ok: false, error: 'forbidden' };
    if (code === '23505') return { ok: false, error: 'already_linked' };
    return { ok: false, error: 'generic' };
  }
  return { ok: true };
}
