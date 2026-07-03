# Known Issues

Cosas detectadas mientras se trabaja en otra cosa. No mezclar en su PR original; abordar en su propio PR.

## Auditoría de permisos (2026-06-26) — CERRADA

Barrido sistemático de **todas las acciones × roles** (asistencia, convocatorias, alineaciones, calendario/eventos, sesiones, ejercicios, jugadas, partido/estadísticas, valoraciones, informes de desarrollo+campaña+objetivos, jugadores/plantilla, capabilities, cuerpo técnico, mensajería, anuncios) buscando:
- el patrón **"rol de CLUB (`memberships.role`) vs rol de EQUIPO (`team_staff.staff_role`)"** — helpers RLS que gateaban "principal" por el rol de club, bloqueando a un principal de equipo cuyo rol de club es ayudante;
- **sobre-exposición** (un rol ve/hace algo indebido) y **sub-exposición** (un rol no puede algo que debería).

**Resultado:** solo **2 instancias vivas** del patrón club-vs-equipo (asistencia y eventos); el resto de helpers de equipo (alineaciones, sesiones, ejercicios, jugadas, convocatorias) ya miraban `team_staff` correctamente. Todo lo detectado quedó **arreglado** (abajo). **No reabrir esta auditoría ni re-preguntar lo ya decidido.**

### Arreglado

| Hallazgo | Causa | Cierre |
|---|---|---|
| Bug asistencia | `user_can_record_attendance` usaba rol de club | → `user_is_principal_of_team` (PR #223) |
| Bug eventos | `user_can_manage_event` usaba rol de club | → `user_is_principal_of_team` (PR #224) |
| F14.9 capabilities cross-team | un principal podía editar caps de ayudante de otro equipo | → `user_is_principal_of_assistant_team` + `capabilities_update`/`_select` por equipo (PR #225) |
| F14.10 events SELECT abierto | cualquier miembro listaba eventos de cualquier equipo | → policy `events_select` con aislamiento por equipo; ratios de familia preservados vía `user_is_team_member_account` (PR #226) |

**F14.9 y F14.10 dejan de ser deuda de F14** (resueltos; ver entradas marcadas RESUELTO abajo).

### Decisiones de negocio cerradas (NO son bugs — NO tocar)

- **Gestión de plantilla** (`players`/`team_members`): es función de **CLUB** — admin/coord/principal-de-club ∪ capability `can_manage_squad`. Confirmado, se queda como está.
- **Informes de desarrollo**: los redacta **cualquier staff del equipo** (principal **y** ayudante, vía `user_is_team_staff` en `user_can_create_development_reports`). Confirmado, se queda como está.

### Deuda menor pendiente (no bloqueante)

- **Gates de UI por lista de roles** (`post-partido` `STAFF_ROLES`, `capabilities` `ROLES_THAT_CAN_EDIT_CAPS`): migrar a RPC para evitar divergencia UI↔RLS. Severidad **cosmética** (la verdad la pone la RLS). Limpieza **oportunista** al tocar esas pantallas.
- **Borde `left_at`** en `events_select`: la familia de un jugador que causó baja deja de ver/contar ratios de esa temporada; si en el futuro se necesita, relajar el helper de familia a "miembro en esa temporada". (Detalle en F14.10 abajo.)

## Activas

### `announcements` UPDATE/DELETE — gobernado por rol de CLUB, no contempla al principal del equipo (deuda menor)
- **Detectado en**: 2026-06-27, barrido del fix de edición de sesiones por staff del equipo (PR #236, Opción A).
- **Contexto**: tras alinear sesiones con "staff del equipo ∪ owner ∪ admin", se revisaron otros write-paths de recursos de equipo. En `announcements`, el **INSERT** (`announcements_insert_managers`) **sí** reconoce al principal del equipo vía `team_staff` (rama `EXISTS team_staff … staff_role='entrenador_principal'`), pero **UPDATE/DELETE** (`announcements_update_author_or_manager` / `announcements_delete_author_or_manager`) usan **`user_role_in_club(club_id) IN (admin_club, coordinador, entrenador_principal)`** — es el **rol de CLUB**, no `team_staff`. Efecto: un entrenador con rol de club `entrenador_ayudante` que es **principal de su equipo** puede crear y editar **sus propios** anuncios (rama `author_profile_id = auth.uid()`), pero **no moderar** (editar/borrar) los anuncios de **otros** en su equipo. Bajo impacto.
- **Patrón**: el mismo "owner∪admin/rol-de-club sin contemplar `team_staff`" que se arregló en sesiones (PR #236) y antes en asistencia (#223) / eventos (#224). Aquí queda como **deuda menor** a decidir: ¿el principal/ayudante del equipo debe poder moderar los anuncios de su equipo? Si sí, alinear las policies UPDATE/DELETE con una rama `user_is_staff_of_team(team_id)` (solo para anuncios con `team_id` no nulo; los globales siguen admin/coord).
- **Referencia**: policies `announcements_update_author_or_manager` / `announcements_delete_author_or_manager` (`supabase/migrations/20260605000001_announcements_global_and_team_staff_rls.sql` y posteriores). **NO arreglado** (solo anotado).

### F13.10/F14.10 — revalidar ratios de familia si se cierra `events_select` por equipo ✅ RESUELTO (2026-06-26)
- **Detectado en**: 2026-06-25, cierre de F13.10 (subfase H-4, stats como ratio).
- **Contexto**: los **denominadores** de las estadísticas de la ficha de desarrollo se cuentan desde `events` del equipo. El riesgo era que al cerrar `events_select` (F14.10) la familia dejara de poder contarlos.
- **Resuelto en** (PR #226): la nueva policy `events_select` incluye una rama `user_is_team_member_account(team_id)`, así que la familia sigue viendo (y contando) los eventos del equipo de su hijo **sin** necesidad de RPC. **Verificado en vivo** (familia real Infantil B: total_matches=3, total_trainings=6 ≠ 0; equipo ajeno = 0). No se tocó `loadFichaStats` ni la UI. Borde `left_at` anotado en F14.10 abajo.
- **Referencia**: `loadFichaStats` en `apps/web/src/app/[locale]/(authenticated)/jugadores/[playerId]/informes/queries.ts`; spec [13.10 §6](../specs/13.10-informes-desarrollo.md); F14.10 abajo.

### Nav — aplicar el patrón "hub" al resto del menú (reducir el sidebar)
- **Detectado en**: 2026-06-17, cierre de F11 (al montar el hub "Entrenamientos" en F11.6 → reorg).
- **Contexto**: en F11 se introdujo el patrón **hub** (una entrada en el sidebar → página que agrupa sub-áreas como tarjetas): "Entrenamientos" reúne Ejercicios + Asistencia y dejará sitio a Sesiones (F12). El sidebar plano sigue largo en el resto del menú.
- **Plan**: una **pasada de nav** que aplique el mismo patrón hub a otras áreas afines para compactar el sidebar, **antes de F12** (que añadirá Sesiones bajo Entrenamientos). Solo presentación/IA de navegación, sin modelo ni permisos.
- **Referencia**: hub `entrenamientos` en `apps/web/src/app/[locale]/(authenticated)/entrenamientos/`, `nav-config.ts`.

### InviteStaffDialog — el form no resetea estado entre invitaciones consecutivas
- **Detectado en**: 2026-05-29, cierre de F2 (revisión post-lote-D).
- **Síntoma**: al invitar a un segundo miembro del staff sin cerrar el dialog, el banner del envío anterior sigue visible y los inputs no se limpian.
- **Causa**: `useActionState` retiene el último estado; el componente no escucha el `success` para limpiar fields ni cerrar el dialog.
- **Impacto**: UX, no funcional. La invitación se envía correctamente.
- **Plan**: pulido en un sub-task de F3 o cuando se vuelva a tocar `/equipos/[teamId]`. ≤30 min de trabajo.

### CSV import — funcionalidades fuera de alcance (F2.9)
- **Detectado en**: 2026-05-29, spec 2.9 §3 "Fuera de alcance".
- **Síntoma**: el wizard de `/plantilla/importar` no soporta: `medical_notes` (sensible), fotos, vinculación tutor (`player_accounts`), update masivo, asignación a múltiples equipos, mapping de columnas configurable.
- **Razonado**: dato sensible (medical), flujo individual mejor (fotos/tutor), conflicto operativo (update masivo desde CSV), complejidad UI (mapping).
- **Plan**: decidir al cerrar Ola 1 si Ola 2 (app nativa) incorpora alguna. Si una sale necesaria antes (típicamente "update masivo del dorsal por temporada"), abrir spec aparte y meter en F11 o F12.

### Email rate limit de Supabase free (HTTP 429) bloquea testing
- **Detectado en**: 2026-05-28, durante el testing de signup/invitaciones de Fase 1.
- **Síntoma**: el SMTP integrado de Supabase impone ~2-4 emails/hora en el plan free. Signup, invitaciones y reset password fallan con HTTP 429 al superarlo.
- **Confirmado en F2**: durante el debug del bug de invitation accept flow (PR #15) el rate limit bloqueó pruebas reales por email. Workaround usado: aceptar invitaciones vía token directo de tabla `public.invitations` + Confirm email OFF en Supabase Auth Settings.
- **Solución definitiva**: SMTP propio (Brevo o Resend). Tracked como subfase **F16.0** en `plan-maestro.md`.
- **Plan**: convivir con la limitación durante F3–F15; resolver al arrancar **Fase 16** antes de invitar al primer club.

### Ventana de deploy mismatch al aplicar migraciones de RLS antes del merge
- **Detectado en**: 2026-05-27 ~15:48 UTC, durante el fix de Bug 1 (clubs INSERT RLS).
- **Observado**: tras el merge del PR #4 a las 15:48:29 UTC, Postgres logs muestran un INSERT en clubs fallido — el último intento de un user antes de que Vercel terminara de redesplegar el código actualizado.
- **Causa raíz**: el patrón de trabajo aplica las migraciones al remoto **antes** de mergear el PR. Entre el momento en que la migración cambia el schema/policies y el momento en que Vercel redespliega el código nuevo hay una ventana (típicamente 1–3 min) en la que la BD tiene la lógica nueva y el runtime el código viejo.
- **Impacto**: efímero, confuso al diagnosticar porque el error no se reproduce tras el redeploy.
- **Plan**: por ahora aceptar y documentar. Revisar al cerrar Fase 14 (Beta cerrada con primer club) o cuando el tráfico justifique más complejidad.

### Onboarding action podría ejecutarse con memberships ya existentes (race)
- **Detectado en**: 2026-05-27, análisis del Bug 1.
- **Escenario hipotético**: user abre `/onboarding` y en paralelo otra pestaña acepta una invitación (crea membership). Vuelve a la primera y submite el form. La función `create_club_with_admin` raise `already_in_a_club`, el action lo mapea y el form lo muestra.
- **Estado tras F2**: F2 no tocó este flow directamente. Sigue funcionando vía error tipado, no es bloqueante.
- **Posible mejora**: redirigir a `/` desde el action cuando vea `already_in_a_club`. Coste 5 minutos.
- **Plan**: arreglar cuando se vuelva a tocar `/onboarding` (probable: F3 al introducir la primera "creación de evento" cross-club).

### Next.js 16 — deprecación de `middleware.ts` a favor de `proxy.ts`
- **Detectado en**: Fase 0 (subfase 0.5). Sigue activo tras F2 (el warning aparece en cada build).
- **Mensaje**: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
- **Impacto**: solo warning de build, no rompe. La convención cambia de nombre en Next.js 16+; la API es la misma.
- **Plan**: renombrar `apps/web/src/middleware.ts` → `apps/web/src/proxy.ts` cuando next-intl haya actualizado sus docs/ejemplos a la nueva convención, para no divergir innecesariamente.

### Sentry — slug del proyecto (`SENTRY_PROJECT`) requiere verificación operativa en Vercel
- **Detectado en**: 2026-05-28, durante el debug de `feat/auth-email-password`.
- **Estado tras F2**: el SDK server inicializa correctamente (validado en PR #11/#12 — logs `[sentry][server-init]` aparecen y los `Sentry.captureException` desde server actions llegan al dashboard, confirmado durante el debug del accept flow en PR #15). Sigue pendiente la parte operativa:
  - `NEXT_PUBLIC_SENTRY_DSN` en Vercel Production debe apuntar al DSN del proyecto correcto.
  - `SENTRY_PROJECT` debe ser `javascript-nextjs` para que el upload de source maps funcione.
  - Cualquier cambio en env vars requiere **redeploy**.
- **Plan**: revisar al cerrar **F15 (observabilidad)** junto con el setup de alertas. Hasta entonces, verificación manual cuando se sospeche.

### Formato pre-existente del repo no pasa `pnpm format:check`
- **Detectado en**: 2026-05-28, durante el PR de `feat/auth-email-password` (ADR-0004).
- **Causa raíz**: el repo no tiene husky pre-commit ni `pnpm format:check` en CI; cambios merged desde Fase 0 y Fase 1 acumularon formato inconsistente.
- **Impacto**: no rompe build ni CI actual. Incomoda cualquier futuro PR cuyo autor corra `pnpm format` localmente y termine con diff espurio.
- **Plan**:
  - PR aparte tipo `chore: pnpm format global tras Fase 2` que aplique prettier a todo el árbol sin mezclar con feature.
  - Opcional: añadir `pnpm format:check` al workflow CI (`.github/workflows/ci.yml`).
  - Opcional: husky pre-commit con `lint-staged`.

### F11B — diferidos de la pizarra táctica (no pendientes de F11B)
- **Detectado en**: 2026-06-17, cierre de F11B. Decisiones de alcance tomadas durante el build; F11B se cierra completa, esto queda como backlog (no bloquea).
- **Export PNG del modo ONCE REAL**: el "Descargar imagen" (11B.3) funciona en blanco/ejercicio (SVG puro → canvas). En el once real los chips son **HTML/CSS** sobre `<MatchFieldEditor>` y las fotos de jugador son **signed URLs cross-origin** → **taint del canvas** al rasterizar. **Vía futura**: servir las fotos con cabeceras **CORS** + `crossorigin` en el `<img>` (o `html-to-image`/proxy), o re-render server-side del once. Mientras, el botón de export **no aparece** en once-real.
- **Grosor de trazo variable (D3)** → backlog. v1 usa grosor fijo. Ampliaría el contrato (`width?` en flecha/linea), como hizo `color?`.
- **Goma fina por trazo (D4)** → backlog. v1 ofrece "Limpiar todo" + borrar-seleccionado; falta una goma que borre un trazo al tocarlo.
- **Picker de evento en la pizarra standalone**: hoy al once real se entra **solo** desde la alineación (F6) / directo (F7) vía `?event=`. Un **selector de partido** desde `/pizarra` (como el picker de ejercicio de 11B.1) queda pendiente.
- **Referencia**: `docs/specs/11B.0-pizarra-tactica.md`, `apps/web/src/components/match/pitch-editor.tsx` (`<PitchBoard>` `showExport`), `apps/web/src/app/[locale]/(authenticated)/pizarra/`.

### F12 — diferidos del planificador de sesiones (no pendientes de F12)
- **Detectado en**: 2026-06-20, cierre de F12. Decisiones de alcance tomadas durante el build (D1–D6); F12 se cierra completa, esto queda como backlog (no bloquea).
- **Selector "evento vinculado" + desvincular explícito en el EDITOR de sesión (D2/D6)**: hoy la sesión se vincula a un entrenamiento **desde el evento** (12.8/12.8a: crear desde el evento o vincular una existente). Falta el camino inverso en el editor de la sesión (elegir/quitar el evento vinculado). Desvincular hoy solo ocurre **implícitamente** al borrar el evento (`ON DELETE SET NULL`).
- **Sync de `session_date` al reprogramar el evento (D5)**: al vincular se **copia** la fecha del evento a la sesión; si luego se mueve el entrenamiento, la fecha de la sesión **no se re-sincroniza** (quedan desfasadas hasta editar a mano).
- **Planificar sesión en trainings de CATEGORÍA / CLUB (D3)**: hoy "Planificar sesión", el badge (12.9) y la alerta <48h (12.8b) solo aplican a trainings **de equipo** (`team_id` no nulo). Los entrenamientos de categoría/club quedan fuera.
- **Diagramas en el PDF de sesión (D6)**: el PDF (12.5) imprime los ejercicios con sus campos pero **sin** representación gráfica del diagrama ("(sin diagrama)"). Rasterizar el diagrama al PDF queda como follow-up.
- **Estructura de bloques configurable por club (D1 → F17)**: el catálogo de tipos de bloque y el esqueleto sembrado son **fijos en core** (`SESSION_BLOCK_TYPES` / `DEFAULT_SESSION_SKELETON`). Permitir que cada club defina su propia estructura → F17.
- **pgTAP fuera de CI (F15.8, ya logueado)**: la RLS de `sessions` (12.1) se verificó con pgTAP **contra el remoto**, no en CI — ver la entrada F15.8 más abajo.
- **Referencia**: `docs/specs/12.0-planificador-sesiones.md`, `packages/core/src/sessions/`, `apps/web/src/app/[locale]/(authenticated)/sesiones/` + `calendario/_components/plan-session-dialog.tsx`.

## Planificadas en plan-maestro

> Entradas que dejan de ser "deuda activa" porque han pasado a subfase concreta del plan-maestro con horas presupuestadas. El detalle del plan vive en [plan-maestro.md](plan-maestro.md); aquí solo el cross-reference al issue original para no perder el rastro de por qué entró al plan.

### F13 — Animación por frames de la jugada (el diagrama de F11 = un frame) ✅ RESUELTO (2026-06-27)
- **Issue original** (2026-06-15, spec 11.0 §4.2 / cierre F11 2026-06-17): el diagrama del ejercicio (F11) es una **escena estática**. El contrato de `@misterfc/core` se diseñó **frame-extensible**: cada elemento tiene `id` ESTABLE y su posición es separable (`elementAnchors`), de modo que F13 pueda envolver la escena en frames e interpolar posiciones por `id` entre frames. El `Diagram` estático de F11 equivale a **un frame**.
- **Resuelto en**: **F13 cerrada (2026-06-27)** — pizarra de jugadas animada por frames entregada (contrato `play`/`frames` + `sceneAtTime`, editor por frame, reproducción). El modelo/scope lo redefinió ADR-0019 / JR #229–#232 (banco del club + ciclo + `team_plays`). Reusa `<DiagramView>`/`<PitchEditor>`.
- **Referencia**: `docs/specs/11.0-biblioteca-ejercicios.md` §4.2 ("Frame-extensibilidad (F13)") + `elementAnchors` en `packages/core/src/diagram/diagram.ts`; [spec 13.0](../specs/13.0-pizarra-jugadas-animadas.md) + [ADR-0019](../decisions/ADR-0019-jugadas-banco-club-aprobacion.md).

### F14.9 — RLS capabilities cross-team ✅ RESUELTO (2026-06-26)
- **Issue original** (2026-05-28, F2.7): el policy `capabilities_update` aceptaba admin/coord/principal del **club** sin filtrar por equipo. Un entrenador principal del Equipo A podía modificar caps de un ayudante asignado solo al Equipo B.
- **Resuelto en** (PR #225, auditoría de permisos): helper `user_is_principal_of_assistant_team(membership_id)` (security definer, excluye la auto-edición) + recreación de `capabilities_update` **y** `capabilities_select` (admin/coord ∪ principal del equipo del ayudante). UI por RPC. pgTAP (T3/T3b/T7/T8…). Sin cambio de modelo. Detalle en la sección **Auditoría de permisos**.
- **Referencia**: `docs/specs/2.7-capabilities-ui.md` §8, `supabase/migrations/20260807000000_fix_capabilities_update_cross_team.sql`.

### F14.10 — RLS events team-isolation ✅ RESUELTO (2026-06-26)
- **Issue original** (2026-05-29, spec 3.0 §4.6): la policy `events_select_member` abría SELECT a cualquier miembro autenticado del club. Un jugador del Equipo A podía listar via API eventos del Equipo B. El filtrado "jugador ve solo eventos de su equipo" era **UX, no seguridad**. Decisión deliberada de Ola 1.
- **Resuelto en**: migración `20260808000000_events_select_team_isolation.sql` (policy `events_select` con 4 ramas: admin/coord → club; `team_id IS NULL` → cualquier miembro; eventos de equipo → `user_is_staff_of_team`; eventos de equipo → familia/jugador vía `user_is_team_member_account`). pgTAP en `rls_events.sql` (R1a–R1g, R17). Los conteos de la ficha de desarrollo (ratios H-4) se preservan sin RPC porque la familia ve los eventos del equipo de su hijo vía `user_is_team_member_account`.
- **Borde pendiente (left_at)**: la visibilidad usa **miembro ACTIVO** (`team_members.left_at IS NULL`). Un jugador que causó baja deja de ver los eventos de ese equipo, y su familia deja de poder contar los denominadores de un informe de una **temporada pasada/cerrada**. Aceptable v1. Si en el futuro la familia debe ver ratios de temporadas pasadas, **relajar** el branch de familia a "miembro en esa temporada" (p.ej. helper que mire `team_members` del `team` de esa temporada sin exigir `left_at IS NULL`, o que acote por la temporada del informe). Probado en R17.
- **Referencia**: `docs/specs/3.0-calendario-eventos.md` §4.6, `supabase/migrations/20260808000000_events_select_team_isolation.sql`.

### F15.8 — pgTAP no se ejecuta en CI
- **Issue original** (2026-06-12, cierre de F9): el CI (`.github/workflows/ci.yml`) corre typecheck · lint · test · build pero **no ejecuta pgTAP**. Además, el sandbox de desarrollo no puede arrancar Docker (`no-new-privileges`, sin root), así que `pnpm db:test` tampoco corre localmente. Los tests pgTAP de funciones/RLS de BD (`supabase/tests/*.sql`) quedan **escritos pero sin ejecución automática**; su validación efectiva ocurre solo al aplicar la migración contra el remoto.
- **Impacto**: medio y **creciente**. La superficie de funciones SECURITY DEFINER no testeadas en pipeline crece con cada bug/feature de BD (p.ej. Bug 2·2a #106, 2c #107, **2b #116** con su guarda del último admin — todos con pgTAP escrito y sin correr en CI).
- **Planificado en**: **F15.8** (1–2 h). Job CI con Postgres+pgTAP en contenedor que corra `supabase/tests/*.sql`, o paso programado contra staging. Sin cambio de modelo.
- **Vigente en F11** (2026-06-17): el pgTAP de RLS de `exercises` (`supabase/tests/rls_exercises.sql`) sigue el mismo patrón — escrito y **verificado aplicando la migración contra el remoto**, no en CI. Otra instancia que se beneficiará del job de F15.8.
- **Referencia**: `plan-maestro.md` F15.8, `fase-9-summary.md` (limitación de verificación).

---

## Resueltas

### F11.9 — Capabilities UI plana → agrupada por dominio — resuelto en PR #157 (2026-06-17)
- **Issue original** (2026-05-29, spec 4.0 §D4): la lista plana de capabilities en `/equipos/[teamId]/staff/[membershipId]/capabilities` degradaba UX al crecer (12 switches tras F6/F8/F10/F11).
- **Fix**: `CAPABILITY_DOMAINS` en `@misterfc/core` (5 dominios: Entrenamientos —incluye asistencia, casa con el nav—, Partidos, Calendario, Jugadores/Plantilla, Comunicación) + panel renderizado por dominio con cabeceras. Conceder/revocar **idéntico** (mismo toggle, misma RLS). Test puro: cada capability aparece exactamente una vez. **Sin modelo, sin nueva capability, sin tocar permisos.**
- **De propina**: se añadieron los labels i18n de `can_mark_attendance` y `can_manage_callups`, que **no existían en ninguna locale** (el panel plano los mostraba sin texto).
- **Referencia**: `docs/specs/2.7-capabilities-ui.md` §8, `docs/specs/4.0-asistencia-convocatorias.md` §D4.

### Tiros no se atribuían por jugador (la columna salía 0) — resuelto en PR #140 (2026-06-15)
- **Detectado en**: 2026-06-15, durante F7.x (vista de estadísticas del partido). Era entrada activa ("revisar entre F7.x y F11").
- **Síntoma**: en la tabla por jugador la columna de **tiros** salía **0 por jugador**, mientras que el **panel de agregados de equipo sí contaba tiros** (a favor/en contra).
- **Causa raíz**: **captura**, no consolidación. El tiro se registraba *por ubicación, sin `player_id`* (`registerFieldEvent`). La consolidación (`consolidateMatch`) ya mapea `shot`→jugador, pero descarta los eventos sin `player_id` → 0 por jugador. El agregado de equipo (`aggregateMatchTeamStats` sobre `match_events`) contaba bien porque opera sobre los eventos crudos por `side`.
- **Fix**: el tiro pasa a registrarse **tocando al jugador** (ver ítem siguiente, mismo PR) → lleva `player_id` y la consolidación materializa `match_player_stats.shots` por jugador. **Sin tocar la consolidación ni BD** (los CHECK ya admiten `player_id` en own-side). **Solo de aquí en adelante**: los tiros ya guardados sin jugador siguen a 0 por jugador (el total de equipo sigue correcto); re-cerrar no los recupera.
- **Tests**: `consolidation.test.ts` (+2): cuenta `shots` por jugador con `player_id`; un tiro sin `player_id` no se atribuye a nadie (guarda de la causa).

### Click en el campo innecesario para falta / fuera de juego / tiro — resuelto en PR #140 (2026-06-15)
- **Detectado en**: 2026-06-15, durante F7.x (al revisar el directo de F7). Era entrada activa ("revisar entre F7.x y F11").
- **Síntoma**: en el directo, falta / fuera de juego / tiro pedían un **click en el campo** (posición x/y) que no aportaba.
- **Fix**: tiro/offside/falta se registran **al tocar al jugador**, sin click en el campo. core: `PLAYER_FIELD_EVENT_TYPES` + `registerPlayerFieldEventSchema` (player_id, sin coords) y `registerFoulSchema` con coords opcionales; web: nueva acción `registerPlayerFieldEvent` (sin lógica de tarjetas) y `registerFoul` inserta coords `?? null`; cliente: tiro/offside/falta por toque de jugador, eliminado `pendingFoul`/`completeFoul`/banner. **Córner SIN cambios** (botón a favor/en contra, sin jugador ni posición). Sin BD (los CHECK ya admiten coords nulas).
- **Tests**: `schemas/__tests__/match-event.test.ts` (nuevo, 9): tiro/offside con jugador y sin coords; rechazo de corner/foul/goal y de `player_id` ausente; falta con/sin coords y rechazo de kind/coords inválidos.

### Convocatoria — los jugadores del banquillo no quedaban marcados como convocados — resuelto en PR #132 (2026-06-14)
- **Detectado en**: 2026-06-14. Era entrada activa hasta el cierre de F10.
- **Síntoma**: al lanzar la convocatoria, los titulares aparecían como convocados y los descartados como descartados, pero el **banquillo** (ni titulares ni descartados) no se contaba como convocado.
- **Causa raíz**: doble fuente de verdad. El contador de "Gestión de partidos" contaba filas explícitas `callup_decisions.decision='called_up'`, mientras el resto del app usa la definición canónica derivada `convocados = roster − descartados` (`groupRosterByCallup`). El banquillo no suele tener fila explícita → se infra-contaba.
- **Fix**: el contador de la lista (`loadCallupMatches`) deriva con `groupRosterByCallup` sobre el roster vigente del evento (intersecando los descartados con el roster); el resumen del detalle se muestra siempre que haya roster (antes se ocultaba con `decisions.size === 0`). Sin tocar datos/modelo: las convocatorias ya lanzadas se ven correctas al instante. Las filas explícitas `called_up` se conservan para el sync alineación↔convocatoria.
- **Tests**: `callup-sync.test.ts` (+3): banquillo cuenta, descartado del roster no, descartado fuera del roster no resta.
- **Reaparición (variante del editor de campo) — resuelto en PR #255 (2026-07-02)**: la **misma clase** de bug, esta vez al **lanzar la convocatoria desde el editor de alineación** — el marcador **por jugador** del banquillo volvía a depender de una fila `called_up` cruda en vez del derivado. Fix: lector canónico `effectiveCallupDecision` (sin fila = convocado; solo `discarded` resta), reusado por `groupRosterByCallup`. Esta variante es lo que el backlog de F13B llamaba erróneamente "no-convocatorias **H-5**" (no era una feature, era este bug). Con #255 queda **cerrada**.

### Directo — córner/falta "a favor" aparecían fijos en "Últimos eventos" — resuelto en PR #130 (2026-06-14)
- **Detectado/resuelto**: 2026-06-14 (no llegó a registrarse como entrada activa; constancia aquí).
- **Síntoma**: el panel "Últimos eventos" de la pantalla de directo (F7) mostraba fijo "córner a favor" y "falta a favor".
- **Causa raíz**: eran **botones de captura** colocados dentro de la columna "Últimos eventos" (entre el título y la lista), por lo que parecían entradas falsas permanentes. No eran datos ni mock; la lista en sí arrancaba vacía.
- **Fix (solo UI)**: se movieron los botones "córner a favor" / "falta a favor" a la **paleta de eventos propios**, junto a penalty/tarjetas. La columna "Últimos eventos" queda solo con título + lista (arranca en `no_events_yet` y se puebla con eventos reales). Los "en contra" siguen en la columna del rival.

### Alineación — la ficha del jugador mostraba solo el apellido — resuelto en PR #129 (2026-06-14)
- **Detectado/resuelto**: 2026-06-14 (no llegó a registrarse como entrada activa; constancia aquí).
- **Síntoma**: en la preparación de la alineación la ficha del jugador mostraba solo el apellido (o el nombre si no había apellido), en vez de "Nombre Apellido".
- **Fix**: nuevo helper puro `formatPlayerNameNatural` en `@misterfc/core` (orden natural, frente a `formatPlayerName` que es "Apellido, Nombre" de listado; maneja huecos sin espacios sobrantes); el `shortLabel` del editor de alineación lo reusa. Solo UI, con Vitest. El layout del chip ya truncaba.

### Amistosos (y torneos) no eran gestionables como los oficiales — resuelto en PR #131 (2026-06-14)
- **Detectado/resuelto**: 2026-06-14 (no llegó a registrarse como entrada activa; constancia aquí).
- **Síntoma**: los partidos amistosos (y de torneo) no aparecían en "Gestión de partidos" ni se podían gestionar (alineación, directo), pese a que `events.type` incluye `match`/`friendly`/`tournament`.
- **Causa raíz**: filtros de `type` fijados a `'match'` de forma inconsistente (la capa de directo ya admitía `'friendly'`; el resto no; `'tournament'` quedaba fuera en todos lados).
- **Fix (solo ampliar filtros)**: constante/guard compartidos `MANAGEABLE_MATCH_TYPES` / `isManageableMatchType` en `@misterfc/core` como fuente única, usados en los 5 puntos del recorrido (lista, detalle, alineación, directo loader+acción, enlace del calendario). Sin BD/migraciones/modelo; los partidos ya creados se gestionan al instante. Con Vitest del guard.

### F4b — redirect 308 `/mi-plantilla` → `/mis-equipos` retirado (2026-05-30, chore/diferida-a-plan)
- **Issue original** (2026-05-29, F4 Lote B): `apps/web/next.config.ts` mantenía un par de redirects 308 desde `/[locale]/mi-plantilla` para no romper bookmarks o links externos a la ruta vieja. Plan original: borrar a partir de 2026-06-28 tras 30 días de gracia.
- **Decisión 2026-05-30**: ejecutar ahora en lugar de esperar. App en beta cerrada con piloto único, sin bookmarks externos a la URL antigua, riesgo de breakage = 0.
- **Cómo se retiró**: borrado del bloque `redirects()` en `apps/web/next.config.ts` + verificación con `git grep mi-plantilla` de que no quedan referencias internas.

### Bug F2.7 latente — server action `toggleCapability` fallaba para todos los roles con 42501 — resuelto en fix/capabilities-admin-grant
- **Detectado en**: 2026-05-29, smoke test de F3 (`can_manage_calendar`). El user reportó que admin_club no podía activar la capability.
- **Síntoma reportado**: "no tengo permisos para activarlo" al pulsar el switch desde `/equipos/[teamId]/staff/[membershipId]/capabilities`.
- **Causa raíz** (no específica de `can_manage_calendar`): el server action usa `supabase.from('capabilities').upsert(..., { onConflict: ... })`. PostgREST lo traduce a `INSERT ... ON CONFLICT DO UPDATE`. PostgreSQL evalúa la policy INSERT WITH CHECK para todas las filas en el INSERT path, también cuando habrá conflict + UPDATE. La migración F1.7 solo creó policy UPDATE para `capabilities` (comentario explícito: "INSERT/DELETE solo vía trigger SECURITY DEFINER"). Resultado: el UPSERT fallaba con 42501 para CUALQUIER rol, no solo admin.
- **Por qué no se cazó en F2.7**: el pgTAP `rls_capabilities_update.sql` usa `UPDATE` plano, no UPSERT — distinto code path. El smoke manual de F2.7 (asumido como exitoso) probablemente no llegó a tocar realmente este flujo.
- **Aprendizaje (lección transversal)**: cuando una server action use `.upsert(..., { onConflict })`, asegurarse de que la tabla tiene policy INSERT compatible con el rol esperado, no solo UPDATE. El comentario "INSERT solo vía trigger" en RLS y el `.upsert()` en código son contradictorios — uno de los dos miente. Documentado en `docs/architecture/rls-policies.md` si llega el momento de añadirlo (gancho para F14 cuando se haga la auditoría de RLS).
- **Fix aplicado**: defensa en profundidad en dos capas.
  - **App**: `toggleCapability` cambiado de `.upsert()` a `.update()` plano. La fila siempre existe porque el trigger `ensure_assistant_capabilities` la siembra al crear membership ayudante + backfill F3.1 para `can_manage_calendar`. Si rows_affected = 0, devuelve 'forbidden' explícito.
  - **BD**: nueva policy `capabilities_insert_managers` con el mismo predicate que la UPDATE (admin_club + coordinador + entrenador_principal del club al que pertenece la membership). Por si un futuro cambio vuelve a UPSERT.
- **Tests añadidos**: `supabase/tests/rls_capabilities_upsert.sql` con 7 casos cubriendo el code path INSERT ON CONFLICT (U1–U7) — admin/coord/principal pueden, ayudante propio/jugador/admin-cross-club no, capability libre rechazada por CHECK.
- **Migración**: `supabase/migrations/20260530000002_capabilities_insert_policy.sql`.

### Botón "Cerrar sesión" ausente en `/onboarding` — resuelto en F2.0 (PR #10)
- **Detectado en**: 2026-05-28, al cierre de Fase 1.
- **Síntoma**: un usuario autenticado sin club quedaba atrapado en `/onboarding` sin forma evidente de cambiar de cuenta.
- **Fix**: `/onboarding` queda fuera del route group `(authenticated)` y usa `OnboardingShell` con header minimal (brand + `LogoutButton`). El server action `signout` limpia también la cookie `active_club_id`.

### Sentry server-side no captura excepciones — resuelto en PR #11 + validado en PR #12 (2026-05-28)
- **Detectado en**: 2026-05-28, debug de invitaciones en `feat/auth-email-password`.
- **Síntoma**: en Vercel logs sólo aparecía `[sentry][edge-init]`, nunca `[sentry][server-init]`. Errores de server actions no llegaban a Sentry.
- **Fix**: PR #11 corrigió la carga del `sentry.server.config.ts` desde `instrumentation.ts` (runtime hint correcto) y PR #12 validó en producción que las `Sentry.captureException` desde server actions llegan al dashboard. El log `[invite][accept]` añadido en PR #15 confirmó retrospectivamente que el flujo es ahora observable end-to-end.
- **Pendiente residual**: la verificación de slug y DSN sigue en "Activas" como ítem operativo (no técnico).

### Log `[invitations][invite-email]` no aparece — superseded por la instrumentación de PR #15 (2026-05-29)
- **Detectado en**: 2026-05-28, debug de invitaciones.
- **Resolución**: la observabilidad del flujo entero de invitaciones se rehízo en PR #15 con prefijo `[invite][accept]` y heartbeats `pre-X` / `post-X` alrededor de cada `await`. Los Sentry tags `feature: 'invitations', step: 'accept-<step>'` cubren cada paso. El logging antiguo de `invitations/actions.ts` mantiene su prefijo `[invitations][invite-email]` y ahora sí se ve en Vercel logs (gracias al fix de Sentry server-side de PR #11/#12).

### Bug latente F2.4 — `player_accounts` RLS bloqueaba al invitee tutor — cazado preventivamente en PR #15 (2026-05-29)
- **Detectado en**: 2026-05-29, durante el repro local del fallo de invitation accept para staff (F2.6).
- **Síntoma observado**: `team_staff` falló con SQLSTATE 42501 (RLS) en el `attachToClub` del invitee.
- **Síntoma latente equivalente**: la policy `player_accounts_write_admin` (F1.7) solo permitía admin/coord. El comentario en `20260528180000_invitations_player_link.sql:19` asumía erróneamente que cubría también al aceptante. F2.4 nunca se había probado con un email virgen aceptando — habría fallado igual.
- **Fix**: migración `20260529000000_team_staff_insert_invitee.sql` añade DOS policies aditivas (`team_staff_insert_invitee` y `player_accounts_insert_invitee`) con el patrón calcado de `memberships_insert_bootstrap_or_admin`: el user puede insertar SU fila si existe invitación pendiente vigente que coincida en (membership/profile, email, token vigente).
- **Validación**: repro con puppeteer-core contra dev local. Ver `fase-2-summary.md` para la trace completa de pasos.
