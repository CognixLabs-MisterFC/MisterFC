# Known Issues

Cosas detectadas mientras se trabaja en otra cosa. No mezclar en su PR original; abordar
en su propio PR.

> **PODADO EL 2026-10-07.** Tenía 283 líneas y 37 secciones, y la mayoría eran entradas
> ya marcadas `✅ CERRADO` / `✅ RESUELTO` acumuladas desde mayo —el apartado «Resueltas»
> solo, dieciséis—. Peor: **una era falsa**. «F15.8 — pgTAP no se ejecuta en CI» y su
> gemela de la sección «Activas» decían que las suites de `supabase/tests/` solo se
> validan a mano contra el remoto, y el CI tiene un job `pgTAP · RLS (BD efímera)` por PR
> desde F15-B. Un fichero de incidencias que afirma lo contrario de lo que hace el CI
> manda a mirar al sitio equivocado, que es exactamente lo que este fichero existe para
> evitar.
>
> Queda lo que sigue siendo verdad: **tres deudas vivas** y **dos lecciones** que aplican
> a cualquier PR. Lo borrado está en el historial de git (`git log -p` sobre este
> fichero) si alguna vez hace falta.

---

## Deuda viva

### `announcements` UPDATE/DELETE — gobernado por rol de CLUB, no contempla al principal del equipo (deuda menor)
- **Detectado en**: 2026-06-27, barrido del fix de edición de sesiones por staff del equipo (PR #236, Opción A).
- **Contexto**: tras alinear sesiones con "staff del equipo ∪ owner ∪ admin", se revisaron otros write-paths de recursos de equipo. En `announcements`, el **INSERT** (`announcements_insert_managers`) **sí** reconoce al principal del equipo vía `team_staff` (rama `EXISTS team_staff … staff_role='entrenador_principal'`), pero **UPDATE/DELETE** (`announcements_update_author_or_manager` / `announcements_delete_author_or_manager`) usan **`user_role_in_club(club_id) IN (admin_club, coordinador, entrenador_principal)`** — es el **rol de CLUB**, no `team_staff`. Efecto: un entrenador con rol de club `entrenador_ayudante` que es **principal de su equipo** puede crear y editar **sus propios** anuncios (rama `author_profile_id = auth.uid()`), pero **no moderar** (editar/borrar) los anuncios de **otros** en su equipo. Bajo impacto.
- **Patrón**: el mismo "owner∪admin/rol-de-club sin contemplar `team_staff`" que se arregló en sesiones (PR #236) y antes en asistencia (#223) / eventos (#224). Aquí queda como **deuda menor** a decidir: ¿el principal/ayudante del equipo debe poder moderar los anuncios de su equipo? Si sí, alinear las policies UPDATE/DELETE con una rama `user_is_staff_of_team(team_id)` (solo para anuncios con `team_id` no nulo; los globales siguen admin/coord).
- **Referencia**: policies `announcements_update_author_or_manager` / `announcements_delete_author_or_manager` (`supabase/migrations/20260605000001_announcements_global_and_team_staff_rls.sql` y posteriores). **NO arreglado** (solo anotado).
- **2026-10-07**: Jose decide que **sí se arregla** — el principal del equipo tiene que
  poder editar y borrar los anuncios de su equipo. Va en su propio PR, con migración y
  pgTAP, inmediatamente después de esta limpieza. Esta entrada se borra al mergearlo.

### Next.js 16 — deprecación de `middleware.ts` a favor de `proxy.ts`
- **Detectado en**: Fase 0 (subfase 0.5). Sigue activo tras F2 (el warning aparece en cada build).
- **Mensaje**: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
- **Impacto**: solo warning de build, no rompe. La convención cambia de nombre en Next.js 16+; la API es la misma.
- **Plan**: renombrar `apps/web/src/middleware.ts` → `apps/web/src/proxy.ts` cuando next-intl haya actualizado sus docs/ejemplos a la nueva convención, para no divergir innecesariamente.
- **Sigue vivo el 2026-10-07**: `apps/web/src/middleware.ts` existe y el aviso sale en
  cada build. La migración a `proxy.ts` sigue esperando a que next-intl mueva sus
  ejemplos, y el candado de la contraseña vive en ese fichero, así que no es un `git mv`
  a ciegas.

### El repo no pasa `pnpm format:check`
- **Detectado en**: 2026-05-28 (PR de `feat/auth-email-password`). **Medido otra vez el
  2026-10-07: sigue igual y a mayor escala — 884 ficheros** con diferencias de formato.
- **Causa**: no hay `husky`/`lint-staged` ni `format:check` en el CI, así que el formato
  nunca se ha impuesto. El `lint` sí está y pasa: esto es solo Prettier.
- **Impacto**: ninguno en build ni en CI. Muerde a quien corra `pnpm format` en local y se
  encuentre 884 ficheros tocados en su rama.
- **Plan**: si se decide arreglar, un PR `chore` que **solo** corra `pnpm format`, sin
  mezclar con nada — un diff de 884 ficheros encima de código revisable es ilegible — y
  en el mismo PR añadir `format:check` al CI. Mientras no esté en CI, esto se queda así.

---

## Lecciones que valen para cualquier PR

### Lección F1B — recrear una policy "copia fiel" NO es copia fiel si cambia un helper de privilegio ✅ CERRADO (fix #280)
- **Detectado en**: 2026-07-06, aceptación de invitación de director rota en preview (F1B-3c+d).
- **Qué pasó**: F1B-2 (`20260824000000`) recreó la policy `memberships_insert_bootstrap_or_admin` con el comentario "aceptación de invitación INTACTA (copia fiel)", pero en la rama de aceptación **sustituyó el helper `SECURITY DEFINER public.current_user_email()` por un subquery inline `(select email from auth.users where id = auth.uid())`**. El rol `authenticated` **no tiene SELECT sobre `auth.users`** → al evaluar la policy bajo la sesión del invitado se lanzaba `permission denied for table users`, abortando el INSERT de la membership de **cualquier** invitado no-admin (director, coordinador, entrenador_*, jugador). Roto todo el onboarding por invitación. **Fix #280**: migración aditiva que vuelve a `current_user_email()` (diff de una sola línea).
- **Por qué el pgTAP de F1B-2 no lo cazó**: probaba la **lógica de permisos** (quién puede qué), no el **contexto de ejecución del invitee** (rol `authenticated` + claims). Un subquery a `auth.users` es legal para `postgres`/`service_role` pero no para `authenticated` → solo falla bajo el rol correcto.
- **Reglas (aplican a CUALQUIER recreación de policy):**
  1. **Verificar diff línea a línea** contra la versión vigente al recrear una policy "idéntica"; un `drop/create` que se cree fiel puede no serlo.
  2. **No sustituir helpers de privilegio (`SECURITY DEFINER`) por subqueries directas a `auth.*`** dentro de una policy evaluada como `authenticated`. Usar `public.current_user_email()` / `auth.uid()`, nunca `select … from auth.users`.
  3. **Los tests RLS de auto-inserción deben correr bajo el rol/claims reales del actor** (`set local role authenticated` + `request.jwt.claims`), no como superusuario, para que un acceso ilegal a `auth.*` falle el test. Cubierto ahora por `supabase/tests/rls_f1b_director_role.sql` §5.
- **Referencia**: `supabase/migrations/20260826000000_f1b2_fix_invite_accept_permission_denied.sql`; suite `supabase/tests/rls_f1b_director_role.sql`.

### La BD efímera del CI se cae si un test provoca un 42501 de una función `SECURITY DEFINER` con cláusula `SET` bajo `SET LOCAL ROLE` (2026-09-10)
- **Detectado en**: BC-1 (PR #563), primer paso de la suite pgTAP en CI.
- **Síntoma**: `psql: server closed the connection unexpectedly` y, a partir de ahí, `FATAL: the database system is in recovery mode` en los **60 tests siguientes**. Parece que fallan 61 tests; en realidad falla uno y los demás son daño colateral de que el backend se llevó por delante al servidor.
- **Patrón que lo dispara** (reproducido dos veces, mismo punto, ~0,68 s):
  ```sql
  set local role authenticated;
  begin
    perform public.una_funcion_security_definer_con_set_search_path(...);  -- sin EXECUTE
  exception when insufficient_privilege then ok := true; end;
  ```
- **No reproduce contra producción** (PostgreSQL 17.6 en el pooler): el ensayo completo pasó tres veces. La BD efímera del CI es la imagen `supabase/postgres` que fija `supabase/config.toml` (`major_version = 17`, minor por detrás). Apunta a un fallo de gestión de la pila de GUC al abortar la subtransacción, corregido en un 17.x posterior.
- **Cómo se evita**: no provocar el error. La aserción que de verdad interesa —"este rol no tiene EXECUTE"— se comprueba en el catálogo con `has_function_privilege(rol, 'esquema.func(args)', 'EXECUTE')`, que además es más directa y no depende del runtime. Así quedó el bloque [10] de `supabase/tests/bc1_account_deletion.sql`.
- **Ojo**: capturar `insufficient_privilege` de un **UPDATE** normal (privilegio de columna o RLS) **sí** es seguro; el bloque [9] del mismo test lo hace y pasa. Lo que tumba el backend es la combinación con la función `SECURITY DEFINER` que lleva `SET`.
