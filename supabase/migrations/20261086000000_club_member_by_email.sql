-- ¿Este correo ya es de alguien de mi club?
--
-- ── POR QUÉ HACE FALTA UNA FUNCIÓN ─────────────────────────────────────────
--
-- Al dar de alta un jugador se pide el correo del tutor y se manda SIEMPRE una
-- invitación, sin preguntar. Si ese correo ya es de un miembro del club, la
-- invitación no tiene sentido: la persona está dentro y lo que hay que hacer es
-- vincularle el jugador (BUG 3 · B-1, ya en producción).
--
-- Para no mandarla hay que poder contestar "¿este correo es de alguien de este
-- club?", y eso NO se puede consultar desde la app: `public.profiles` NO TIENE
-- COLUMNA DE CORREO (comprobado). El correo de login vive solo en
-- `auth.users.email`, que ningún cliente de la app puede leer. Los otros correos
-- del esquema son otra cosa: `memberships.contact_email` es un contacto que
-- teclea el club, `invitations.email` es un destino de invitación y
-- `players.invite_email` es el correo de un tutor que todavía no ha entrado.
--
-- Por eso una función SECURITY DEFINER, hermana de `current_user_email()`.
--
-- ── QUÉ CONTESTA, Y QUÉ NO ─────────────────────────────────────────────────
--
-- Devuelve 0 o 1 fila. Una fila = ese correo es de un MIEMBRO VIVO DE ESTE CLUB,
-- y trae lo justo para que la pantalla pueda decir de quién se trata y llevar a
-- su ficha: membership, perfil, nombre y rol de club.
--
-- Cero filas es la ÚNICA respuesta para todo lo demás, y a propósito: da igual
-- que el correo no exista, que exista pero sin cuenta en este club, o que sea de
-- alguien de otro club. Desde fuera no se distinguen. La función NO devuelve
-- correos: los recibe y contesta sobre el club de quien pregunta.
--
-- ── QUIÉN PUEDE PREGUNTAR ──────────────────────────────────────────────────
--
-- El mismo conjunto que puede CREAR un jugador, porque es el único flujo que la
-- llama: la lista de `players_insert_staff`. Si esa policy cambia, esta lista
-- cambia con ella — están escritas igual a propósito.
--
-- Es un oráculo de pertenencia acotado al propio club de quien pregunta, y eso
-- es un escalón por debajo de lo que esa gente ya puede ver: cualquier miembro
-- puede leer las membresías de su club (`memberships_select_clubmate`) con sus
-- nombres y sus contactos. Lo que aquí se añade es poder CONTRASTAR un correo de
-- login contra esa misma lista, que es exactamente lo que el alta necesita.
-- `user_role_in_club` ya trata al superadmin de plataforma como admin_club.
--
-- Sin policy nueva, sin tabla nueva.

create or replace function public.club_member_by_email(
  p_club_id uuid,
  p_email text
)
returns table (
  membership_id uuid,
  profile_id uuid,
  full_name text,
  role text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- MISMA lista que `players_insert_staff`: quien puede crear el jugador puede
  -- preguntar si el correo del tutor ya está dentro.
  if coalesce(public.user_role_in_club(p_club_id), '') not in (
    'admin_club', 'director', 'coordinador',
    'entrenador_principal', 'entrenador_ayudante'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_email is null then
    return;
  end if;

  -- `memberships` tiene UNIQUE (profile_id, club_id), así que como mucho hay una
  -- fila; el LIMIT es cinturón, no criterio.
  return query
  select m.id, m.profile_id, p.full_name, m.role
    from auth.users u
    join public.memberships m on m.profile_id = u.id
    join public.profiles p on p.id = u.id
   where lower(u.email) = v_email
     and u.deleted_at is null
     and p.deleted_at is null
     and m.club_id = p_club_id
     and m.left_at is null   -- se fue del club: hay que volver a invitarle
   limit 1;
end;
$function$;

revoke all on function public.club_member_by_email(uuid, text) from public;
revoke all on function public.club_member_by_email(uuid, text) from anon;
grant execute on function public.club_member_by_email(uuid, text) to authenticated;
grant execute on function public.club_member_by_email(uuid, text) to service_role;
