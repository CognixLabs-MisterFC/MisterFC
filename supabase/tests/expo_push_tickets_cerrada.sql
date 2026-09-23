-- La cola de tickets de Expo (`expo_push_tickets`, migración 20261096000000) está
-- CERRADA al cliente: la escribe el emisor y la lee el cron, los dos con
-- service_role. Un token de push identifica un dispositivo; no hay ninguna razón
-- para que un cliente lea la cola de nadie, ni la suya.
--
-- Cubre:
--   [1] La tabla existe con sus cuatro columnas — ancla POSITIVA. Sin ella, todo lo
--       de abajo saldría verde por el motivo equivocado si la tabla no estuviera.
--   [2] RLS ACTIVA y CERO policies. Las dos cosas: la RLS sin policies cierra, pero
--       una policy añadida de rebote la abriría sin que nadie se enterase.
--   [3] Ni `anon` ni `authenticated` tienen NINGÚN privilegio, TRUNCATE incluido.
--       El TRUNCATE importa aparte: no pasa por RLS, así que una tabla "cerrada"
--       con ese grant por defecto se puede vaciar entera.
--   [4] La FK a `notifications` es ON DELETE CASCADE: borrar el aviso se lleva su
--       cola. Sin eso quedarían tickets apuntando a una notificación que no existe
--       y el cron los reabriría contra nada.
--
-- Estilo: aserciones con raise exception. Privilegios con has_*_privilege, NUNCA
-- provocando el 42501 (tumba la BD efímera del CI). Transaccional.
\pset pager off
\set ON_ERROR_STOP on

begin;

-- [1] Ancla positiva: la tabla y sus columnas.
do $$
declare
  v_cols text[];
begin
  if to_regclass('public.expo_push_tickets') is null then
    raise exception 'FALLO [1]: public.expo_push_tickets no existe';
  end if;

  select array_agg(column_name::text order by column_name)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'expo_push_tickets';

  if v_cols is distinct from array['created_at','notification_id','ticket_id','token'] then
    raise exception 'FALLO [1]: columnas inesperadas: %', v_cols;
  end if;
end $$;

-- [2] RLS activa y sin policies.
do $$
declare
  v_rls boolean;
  v_policies int;
begin
  select relrowsecurity into v_rls
    from pg_class where oid = 'public.expo_push_tickets'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'FALLO [2]: expo_push_tickets sin RLS';
  end if;

  select count(*) into v_policies
    from pg_policy where polrelid = 'public.expo_push_tickets'::regclass;
  if v_policies <> 0 then
    raise exception 'FALLO [2]: expo_push_tickets tiene % policies; debe tener 0', v_policies;
  end if;
end $$;

-- [3] Cero privilegios para anon y authenticated. TRUNCATE incluido a propósito.
do $$
declare
  v_role text;
  v_priv text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(v_role, 'public.expo_push_tickets', v_priv) then
        raise exception 'FALLO [3]: % tiene % sobre expo_push_tickets', v_role, v_priv;
      end if;
    end loop;
  end loop;
end $$;

-- [4] La FK a notifications borra en cascada.
do $$
declare
  v_action char;
begin
  select confdeltype into v_action
    from pg_constraint
   where conrelid = 'public.expo_push_tickets'::regclass
     and contype = 'f'
     and confrelid = 'public.notifications'::regclass;

  if v_action is null then
    raise exception 'FALLO [4]: no hay FK de expo_push_tickets a notifications';
  end if;
  if v_action <> 'c' then
    raise exception 'FALLO [4]: la FK a notifications no es ON DELETE CASCADE (confdeltype=%)', v_action;
  end if;
end $$;

select 'expo_push_tickets_cerrada OK' as resultado;

rollback;
