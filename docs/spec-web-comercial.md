# Web comercial de MisterFC (misterfc.es) — Especificación · Checkpoint A

> **Estado:** Checkpoint A. Es solo especificación: no hay código, ni cambios en Vercel, DNS o Supabase.
> **Base:** `origin/main` en `477783f5` (2026-10-14). He leído el código y he comprobado en producción, sin escribir nada, lo que se ve desde fuera (`misterfc.es`).
> **Titular:** Cognix Labs, S.L.U. · Contacto: info.cognixlabs@gmail.com
> Las rutas de código son relativas a la raíz del monorepo. Uso estas abreviaturas:
>
> - **W** = `apps/web/src/app/[locale]/(authenticated)/`
> - **WP** = `apps/web/src/app/[locale]/`
> - **N** = `apps/native/app/`

## Criterio general

- **La web solo anuncia lo que existe hoy en la app**, sea en la web o en la nativa. Cada función lleva su origen en el repo (§5). Lo que está planificado, apagado por un interruptor o es interno no se anuncia (§5.3).
- **Seguridad y protección del menor:** solo afirmaciones que se pueden comprobar en el código o la configuración del repo (§6.1). La lista de lo que **no** se puede afirmar está en §6.2.
- **Sin precios.** En §5.3 aparece un precio que existe en el código: la suscripción de las familias, hoy apagada. No sale en la web.
- **Sin nombres de clubes, logos de clubes ni opiniones** mientras no haya permiso por escrito. El apartado para mostrarlos queda preparado y oculto (§7.2).
- **Capturas:** solo de la app real con datos ficticios. Nunca nombres, caras ni fotos reales de jugadores ni de clubes reales (§9).
- **Sin superlativos sin prueba, sin cifras sin respaldo y sin testimonios**, tampoco «testimonios próximamente».
- **Vocabulario:** en castellano y valenciano no se dice «Login», sino «Acceso clubes» y «Entrar».

---

## 1. Arquitectura

### 1.1 Qué pasa hoy (medido)

| Petición                | Respuesta en producción                                                 | Código                                      |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| `GET /`                 | 307 → `/es`, según el idioma del navegador; `ca` también acaba en `/es` | next-intl, `apps/web/src/middleware.ts:73`  |
| `GET /es` sin sesión    | 307 → `/es/clubes`                                                      | `middleware.ts:144-152`                     |
| `GET /es` con sesión    | Inicio de la app según el rol                                           | `W/page.tsx` dentro de `W/layout.tsx`       |
| `GET /es/clubes`        | 200: portada «Elige tu club» con logos                                  | `WP/clubes/page.tsx`                        |
| `GET www.misterfc.es/*` | 308 → `misterfc.es`                                                     | Vercel, dominio del proyecto `misterfc-web` |

Datos de la estructura actual:

- **No hay `app/layout.tsx`.** El layout raíz es `WP/layout.tsx`. Pone `<html>` y `<body>`, la fuente Inter, `NextIntlClientProvider`, `AuthHashHandler`, `Toaster` y el registro del service worker.
- **La carcasa de la app vive solo en `W/layout.tsx`.** Es la barra lateral (`AppShell`) junto con los controles de sesión, suscripción, re-consentimiento y corte de familias.

### 1.2 Propuesta

**Un grupo de rutas propio para la web, `WP/(web)/`, con su propio layout.**

- Este layout pone la cabecera comercial, el pie y la analítica.
- No pasa por la carcasa ni por los controles de la app.
- Comparte con la app solo el layout raíz (`<html>`, fuente y proveedor de textos).

```
apps/web/src/app/[locale]/
├── layout.tsx                 (raíz actual, sin cambios)
├── (authenticated)/…          (app, sin cambios)
├── (web)/                     ← NUEVO
│   ├── layout.tsx             cabecera comercial + pie + <Analytics/>
│   ├── portada/page.tsx       portada (se sirve en /{idioma} por rewrite, §1.3)
│   ├── funciones/page.tsx
│   ├── seguridad/page.tsx
│   └── demo/
│       ├── page.tsx           formulario
│       ├── actions.ts         Server Action
│       └── gracias/page.tsx   noindex
├── legal/[slug]               (existente: se añaden aviso-legal y cookies, §10)
├── clubes/, [slug]/, signin/… (sin cambios)
```

### 1.3 Separar la portada pública del panel: un _rewrite_ en el middleware

- `/{idioma}` no puede tener dos páginas. `W/page.tsx` ya resuelve esa URL y Next no admite otra `page.tsx` en el mismo punto.
- Tampoco se puede decidir dentro del Inicio: `W/layout.tsx:26` manda a `/signin` antes de pintar nada.
- **Por eso el único cambio es en `middleware.ts:144-152`:**

```ts
// hoy:   anónimo en /{es|en|va}  → redirect /{idioma}/clubes
// nuevo: anónimo en /{es|en|va}  → rewrite /{idioma}/portada   (la URL sigue siendo /{idioma})
//        cualquiera en /{idioma}/portada → 308 a /{idioma}       (una sola URL pública)
```

- **Con sesión**, la ruta no entra en ese `if`: `/{idioma}` sigue siendo el Inicio de la app, sin cambios.
- **La recogida de `?code=` / `token_hash`** (`middleware.ts:52-71`) se ejecuta **antes** y no se toca. Un enlace de Supabase que caiga en la raíz sigue llegando a `/auth/callback`.
- **Candado de contraseña** (`:128-137`): sin cambios.
- **Las páginas comerciales** (`/funciones`, `/seguridad` y `/demo`) se pueden ver con sesión y sin ella. Solo la portada está reservada al anónimo.

### 1.4 Lo que no cambia (comprobado contra la lista cerrada)

| Debe seguir igual                                                                     | Por qué no le afecta                                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/{idioma}/invite/*`, `/abrir-invitacion/*`                                           | Rutas y redirect de `next.config.ts` sin tocar. El matcher del middleware no cambia.                                                               |
| `/auth/callback`                                                                      | Fuera del matcher (`middleware.ts:196`).                                                                                                           |
| `?code=` en cualquier ruta, también la raíz                                           | El paso 1 del middleware va antes del rewrite.                                                                                                     |
| `/{idioma}/legal/{privacidad,terminos,eliminacion-cuenta,desistimiento}` y `/legal/*` | No se tocan. Solo se **añaden** dos documentos nuevos en el mismo mecanismo (§10).                                                                 |
| `/.well-known/*`, `/api/*`                                                            | Fuera del matcher; sin cambios.                                                                                                                    |
| `/{idioma}/{slug}` y `/{idioma}/clubes`                                               | Sin cambios. Las rutas nuevas se reservan como slugs (§2).                                                                                         |
| App nativa                                                                            | Sus enlaces (`/invite/*`, `/legal/*`, `/api/*`, PDF) no se tocan. El fichero de Apple solo reclama `/invite/*`, así que la portada no abre la app. |

### 1.5 Efectos secundarios que hay que resolver en la implementación

1. **Service worker** (`apps/web/public/sw.js:39-47`): precachea `'/'`.
   - Tras el cambio, un anónimo guardaría en caché la portada en vez de `/clubes`.
   - El efecto es pequeño, porque la caché solo se usa sin conexión y solo para `/`.
   - Hay que subir `CACHE_NAME` a `misterfc-shell-v3`.
2. **PWA instalada** (`public/manifest.json`): `start_url "/"`.
   - Hoy, un entrenador con la sesión caducada abre la PWA y ve «Elige tu club». Tras el cambio vería la portada comercial.
   - Propuesta: `start_url "/clubes"`. Con sesión, `/clubes` ya manda al Inicio (`clubes/page.tsx:34-37`); sin sesión, enseña el selector. → **Pregunta 4.**
3. **Enlace «Volver» de las páginas legales** (`WP/legal/layout.tsx:43`): apunta a `/clubes`.
   - Las páginas legales no se tocan, así que se queda como está, salvo que digas lo contrario (pregunta 4).
4. **Metadatos del layout raíz** (`WP/layout.tsx:18-34`): la descripción es fija y en castellano, y no hay OpenGraph.
   - Las páginas comerciales llevan metadatos propios por idioma (§11). El layout raíz no se toca.

---

## 2. Nombres reservados para slugs de club

### 2.1 Cómo funciona hoy

- **La lista está en un único sitio:** `public.is_reserved_slug(text)`, en `supabase/migrations/20261030000000_f14j_3a_reserved_slugs_blocklist.sql:32-54`.
  - La aplican `platform_create_club`, que lanza `slug_reserved`, y `platform_propose_slug`, que se los salta.
  - No hay copia en TypeScript.
  - Para añadir palabras hace falta **una migración nueva** con `create or replace function` y la lista completa (`:17-19`).
- **Ningún test compara la lista con las carpetas reales.** Por eso se ha desfasado.

### 2.2 Palabras que se añaden

| Grupo                                      | Palabras                                                                              | Motivo                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Web comercial (nuevas)                     | `funciones`, `seguridad`, `demo`, `portada`                                           | Segmentos de `WP/(web)/` (§1.2). `portada` es el destino interno del rewrite.                |
| Web comercial (reservas defensivas)        | `precios`, `contacto`, `soporte`, `ayuda`, `blog`, `empresa`, `clientes`              | Páginas que es razonable añadir más adelante. Reservarlas ahora no cuesta nada.              |
| Ya faltan hoy (tu lista)                   | `aplicacion`, `cuenta-eliminada`, `suscripcion`, `abrir-invitacion`, `patrocinadores` | Existen como ruta (o como redirect, en el caso de `abrir-invitacion`) y no están reservadas. |
| **Ya falta hoy (no estaba en tu lista)**   | `miembros`                                                                            | Existe `W/miembros/` y no está reservada.                                                    |
| Solo si se traducen los slugs (pregunta 2) | `funcions`, `seguretat`, `features`, `security`                                       | Las variantes en valenciano e inglés.                                                        |

- `aviso-legal` y `cookies` **no** hacen falta: propongo que cuelguen de `/legal/`, y `legal` ya está reservada (§10).
- **Test nuevo, propuesto para el Checkpoint B:** un test que lea las carpetas de primer nivel de `WP/` y de `W/`, y los `source` de `redirects()` en `next.config.ts`, y falle si alguno no está en `is_reserved_slug`. Así no vuelve a desfasarse.

### 2.3 Comprobación contra los clubes existentes

- **Vista pública** (`GET misterfc.es/es/clubes`, 2026-10-14): `udfonteta`.
- **Migraciones:** `udfonteta` y `club-beta-test` (`20261056000000_f14j_5a_clubs_is_public.sql:78-79`).
- **Ninguno choca** con las palabras de §2.2.
- **Lo que falta:** comprobar en la base de datos que no hay más clubes no públicos. En este checkpoint no se toca Supabase. La consulta de solo lectura, para lanzarla cuando digas:

```sql
select slug from public.clubs
where slug = any (array['funciones','seguridad','demo','portada','precios','contacto','soporte',
  'ayuda','blog','empresa','clientes','aplicacion','cuenta-eliminada','suscripcion',
  'abrir-invitacion','patrocinadores','miembros','funcions','seguretat','features','security']);
-- esperado: 0 filas
```

---

## 3. Mapa de páginas y menú

### 3.1 Páginas

| Página                                                     | URL (es)                | Contenido                            |
| ---------------------------------------------------------- | ----------------------- | ------------------------------------ |
| Portada                                                    | `/es` (sin sesión)      | §4                                   |
| Funciones                                                  | `/es/funciones`         | §5, agrupada por áreas, con capturas |
| Seguridad y menores                                        | `/es/seguridad`         | §6                                   |
| Solicitar demo                                             | `/es/demo`              | §8                                   |
| Solicitud recibida                                         | `/es/demo/gracias`      | Confirmación (`noindex`)             |
| Aviso legal                                                | `/es/legal/aviso-legal` | §10 (nuevo)                          |
| Política de cookies                                        | `/es/legal/cookies`     | §10 (nuevo)                          |
| Privacidad, términos, eliminación de cuenta, desistimiento | `/es/legal/…`           | Existentes, sin cambios de URL       |
| Acceso clubes                                              | `/es/clubes`            | Existente (selector de clubes)       |
| 404                                                        | —                       | La actual de la app                  |

### 3.2 Slugs en los 3 idiomas: propongo **no traducirlos**

- La app no usa `pathnames` de next-intl (`apps/web/src/i18n/routing.ts`): todas sus rutas son en castellano en los tres idiomas (`/en/calendario`, `/va/jugadores`).
- **Para traducir los slugs habría que activar `pathnames` en toda la app.** Con eso activo, next-intl obliga a declarar cada ruta y su `Link` pasa a ser estricto, así que el cambio afectaría a las cientos de rutas de la app.
- **Propuesta:** `/es/funciones`, `/va/funciones` y `/en/funciones`, igual que el resto de la app. → **Pregunta 2.**

### 3.3 Cabecera

```
[MisterFC]   Funciones   Seguridad          ES · VA · EN    Acceso clubes   [ Solicitar demo ]
```

- **«Solicitar demo»** es el botón principal, relleno en verde (`#10B981`).
- **«Acceso clubes»** es un enlace discreto que lleva a `/{idioma}/clubes`. En inglés es «Club login».
- **Idioma:** el selector lleva a la misma página en el otro idioma.
- **Móvil:** logo, botón «Demo» y menú (Funciones, Seguridad, idioma, Acceso clubes).
- **Con sesión iniciada** (en `/funciones`, `/seguridad` o `/demo`), «Acceso clubes» se sustituye por «Ir a mi club», que lleva a `/{idioma}`.

### 3.4 Pie

- MisterFC, con la línea «MisterFC es un producto de Cognix Labs.».
- Contacto: info.cognixlabs@gmail.com.
- Funciones · Seguridad · Solicitar demo · Acceso clubes.
- Aviso legal · Privacidad · Cookies · Términos.
- Botones de App Store y Google Play.
- Selector de idioma.
- © año Cognix Labs.

**El CTA de demo aparece 5 veces en la portada:** cabecera, hero, después de funciones, después de seguridad y en el bloque final.

---

## 4. Portada sección a sección (borrador en castellano)

El tono es de **tú**, como la app (`messages/es.json`: «Elige tu club», «Entra a tu club»). → **Pregunta 1.**

### 4.1 Hero

- **Antetítulo:** Para clubes de fútbol base
- **Titular:** Todo tu club en un solo sitio, para que el tiempo vaya al campo
- **Subtítulo:** Equipos, entrenamientos, convocatorias, partidos y comunicación con las familias, en la web y en el móvil. Pensado para la dirección del club y para sus entrenadores.
- **CTA principal:** Solicitar una demo · **Secundario:** Ver funciones
- **Imagen:** mockup de portátil con el dashboard de dirección y móvil con la convocatoria (§9).

### 4.2 El problema (tres tarjetas)

- **Información repartida.** Hojas de cálculo, grupos de mensajería, libretas: cada equipo a su manera.
- **La dirección no ve el conjunto.** Saber cómo van la asistencia, los informes o las convocatorias de todos los equipos lleva horas.
- **Las familias, por mil canales.** Convocatorias, horarios y avisos se pierden entre mensajes.

### 4.3 Qué cambia para cada uno

- **Dirección:** el estado de todos los equipos en un panel; temporadas, equipos y cuerpo técnico; campañas de informes y anuncios a todo el club.
- **Coordinación:** los equipos que coordinas, sus plantillas, su cuerpo técnico y el seguimiento de los informes.
- **Entrenadores:** sesiones, ejercicios, convocatorias, alineaciones y toma de datos del partido desde el móvil.
- **Familias:** la app MisterFC, para responder a las convocatorias, consultar el calendario y seguir la evolución de su hijo o hija.

### 4.4 Funciones destacadas (6 tarjetas, cada una con su captura)

1. **Planifica los entrenamientos.** Biblioteca de ejercicios con diagramas, planificador semanal de sesiones y PDF para el campo. (§5, B)
2. **Convoca y alinea.** Publica la convocatoria, recibe las respuestas de las familias y prepara la alineación arrastrando jugadores. (§5, C)
3. **El partido, en directo.** Goles, tarjetas y cambios desde el móvil, incluso sin conexión; al acabar, la valoración de cada jugador. (§5, C)
4. **Informes de desarrollo.** Objetivos e informe por periodo para cada jugador, con PDF para las familias. (§5, D)
5. **Un panel para la dirección.** Censo, resultados, asistencia y alertas de todo el club. (§5, A)
6. **Comunicación ordenada.** Mensajes, anuncios y notificaciones dentro de la app, sin depender de grupos de mensajería. (§5, E)

→ CTA «Solicitar una demo» (2.º) · enlace «Ver todas las funciones».

### 4.5 Seguridad y protección del menor (resumen)

**Título:** Datos de menores, tratados como lo que son

Cinco puntos, todos de §6.1:

- Solo se entra a un club por invitación.
- Cada club solo ve sus datos: el control de acceso se aplica en la propia base de datos.
- La foto de un jugador no se muestra sin la autorización de imagen.
- Los datos de salud solo los ven quienes los necesitan, y cada consulta del personal queda registrada.
- El tutor puede descargar los datos de su hijo o pedir su supresión.

→ enlace «Cómo protegemos los datos» · CTA «Solicitar una demo» (3.º).

### 4.6 Web y móvil

- **Web**, para la dirección y los entrenadores: la planificación, los informes y la gestión del club.
- **App para iOS y Android**, para el día a día: la convocatoria, el directo del partido, los mensajes y el calendario.
- **En castellano, valenciano e inglés**, en la web y en la app.

### 4.7 Familias (apartado pequeño, §7.1)

### 4.8 Cómo empezamos (3 pasos)

1. **Demo de 30 minutos** por videollamada, con tu caso. _(La duración está pendiente: pregunta 6.)_
2. **Montamos tu club:** equipos de la temporada, importación de jugadores desde Excel y tu escudo y tus colores.
3. **Invitas a tu cuerpo técnico y a las familias**, y empezáis a usarlo.

### 4.9 Quién está detrás

MisterFC es un producto de Cognix Labs, S.L.U., con sede en Valencia. (Sin cifras ni clientes; solo datos que figuran en el aviso legal.)

### 4.10 Preguntas frecuentes (antes del CTA final)

- **¿Cuánto cuesta?** Depende del tamaño del club y de lo que necesites. Te lo contamos en la demo, sin compromiso. _(Sin cifras.)_
- **¿Las familias tienen que pagar algo?** → **Pregunta 7.** Hay una suscripción para familias construida pero apagada (§5.3); no la menciono hasta que decidas.
- **¿Tenemos que instalar algo?** La dirección y los entrenadores pueden usar la web desde cualquier navegador. Para el día a día hay app en iOS y Android.
- **¿Funciona sin conexión?** La app móvil permite consultar la información ya descargada y registrar las acciones del partido sin cobertura.
- **¿Podemos traer nuestros jugadores?** Sí, desde una hoja de Excel o CSV con nuestra plantilla.
- **¿Está en valenciano?** Sí: castellano, valenciano e inglés, en la web y en la app.
- **¿Quién puede ver los datos de los menores?** Resumen de §6.1 con enlace a Seguridad.

### 4.11 CTA final

**Título:** Te enseñamos MisterFC con los equipos de tu club.
**Texto:** Una videollamada y respondemos todas tus dudas. Solicitarla no te compromete a nada.
CTA «Solicitar una demo» (5.º).

---

## 5. Funciones reales de la app

Verificadas en el código el 2026-10-14. Roles: `admin_club` y `director` (dirección), `coordinador`, `entrenador_principal` y `entrenador_ayudante` (staff) y `jugador`, que en la práctica es la cuenta de la familia (`packages/core/src/auth/roles.ts:22-71`).

### 5.1 Por áreas

**A. Gestión del club (dirección)**

| Función                                                                                                   | Origen                                                                               |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Equipos por temporada (F5, F7, F8, F11) y categorías por edad                                             | `W/equipos/*`, `W/equipos/plantillas`, `packages/core/src/schemas/club-structure.ts` |
| Cambio de temporada: colocar a los jugadores en los equipos nuevos, gestionar pendientes y bajas          | `W/equipos/reasignacion/*`, `W/equipos/finalizar` (solo web)                         |
| Cuerpo técnico: asignar, mover, rol, contacto, exportar CSV                                               | `W/cuerpo-tecnico/*`, `N/direction/cuerpo-tecnico.tsx`                               |
| Miembros: baja y reactivación                                                                             | `W/miembros` (solo web)                                                              |
| Invitaciones a staff y dirección                                                                          | `W/invitations/*`, `src/screens/direction/invite-staff-modal.tsx` (nativa)           |
| Dashboard: censo frente a la temporada anterior, resultados, asistencia con tendencia, rankings y alertas | `W/dashboard/page.tsx`, `N/direction/dashboard.tsx`                                  |
| Campañas de evaluación: fecha límite y progreso por equipo                                                | `W/plantilla/informes`, `N/direction/pendientes-informes*.tsx`                       |
| Escudo y color del club; login propio del club en `misterfc.es/{club}`                                    | `W/ajustes/*`, `WP/[slug]`                                                           |
| Patrocinadores del club, visibles en los inicios de la app                                                | `W/patrocinadores` (gestión web), `apps/native/src/ui/club-partners.tsx`             |
| Documentos legales propios del club, versionados                                                          | `W/ajustes/documentos-legales` (solo `admin_club`)                                   |
| Importación de jugadores desde CSV o Excel, con plantillas en 3 idiomas                                   | `W/plantilla/importar`, `apps/web/public/import-templates/`                          |

**B. Entrenamientos y metodología**

| Función                                                                                                               | Origen                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Biblioteca de ejercicios con diagrama, objetivos, intensidad y espacio, y revisión (borrador → propuesto → publicado) | `W/ejercicios/*`, `supabase/migrations/20260715000001_exercises.sql:116-128` (solo web) |
| Planificador de sesiones: lista y semana, plantillas, PDF, enlazado al calendario                                     | `W/sesiones/*`, `W/sesiones/[id]/pdf` (la creación es solo web)                         |
| Pizarra táctica con exportación a imagen                                                                              | `W/pizarra` (solo web)                                                                  |
| Jugadas animadas del club, con playbook por equipo, opción de compartir con familias y pantalla completa              | `W/jugadas/*`, `N/family/jugadas.tsx` (visor)                                           |
| Asistencia a entrenamientos y estadísticas                                                                            | `W/asistencia/*`, `N/staff/asistencia*.tsx`                                             |
| Sesiones compartidas con las familias, en solo lectura                                                                | `W/mi-equipo/sesiones`, `N/family/sesion.tsx`                                           |

**C. Partidos**

| Función                                                                                                        | Origen                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Calendario: entrenamientos, partidos, torneos y amistosos, con recurrencia y cancelación                       | `W/calendario/*` (creación en web); consulta en `N/*/calendario*.tsx`                                                |
| Días festivos, con aprobación de dirección                                                                     | `supabase/migrations/20261021000000_f14f4_event_approval.sql`, `N/direction/calendario-festivos.tsx`                 |
| Convocatorias con aviso push, respuesta de la familia y recordatorio diario                                    | `W/convocatorias/*`, `N/staff/convocatoria*.tsx`, `N/family/convocatoria.tsx`, `apps/web/src/app/api/cron/reminders` |
| Alineaciones: arrastrar jugadores, banquillo, cambios previstos, formaciones propias, compartir con la familia | `W/convocatorias/[eventId]/alineacion`, `W/formaciones`, `N/staff/alineacion.tsx`                                    |
| Directo: reloj, goles, tarjetas, cambios y entrada rápida; **en el móvil funciona sin conexión**               | `W/convocatorias/[eventId]/directo`, `N/staff/directo.tsx`, `packages/core/src/match/event-queue.ts`                 |
| Post-partido: nota del 1 al 10, MVP y comentario por jugador; valoración del equipo                            | `W/convocatorias/[eventId]/post-partido`, `N/staff/post-partido.tsx`                                                 |
| Estadísticas del partido y del equipo, con PDF                                                                 | `W/convocatorias/[eventId]/estadisticas`, `W/estadisticas-equipo` (PDF solo web)                                     |
| Directos del club (todos los partidos de la semana) y seguir equipos con aviso de cada gol                     | `W/directos/*`, `apps/native/src/directo/directos-screen.tsx`                                                        |

**D. Desarrollo del jugador**

| Función                                                                                       | Origen                                                                                             |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Informes de desarrollo por periodo, con objetivos del jugador y del equipo y PDF con gráficas | `W/jugadores/[playerId]/informes/*`, `W/mi-informe`, `N/family/mi-informe.tsx` (la edición es web) |
| Ficha deportiva: temporadas, estadísticas, asistencia, evolución, valoraciones y logros       | `W/mi-ficha`, `N/family/mi-ficha.tsx`, `N/family/estadisticas.tsx`                                 |
| Notas del staff sobre el jugador                                                              | `W/jugadores/player-notes-actions.ts`                                                              |

**E. Comunicación**

| Función                                                                                  | Origen                                                                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Mensajes: individuales, de equipo y del cuerpo técnico                                   | `W/mensajes/*`, `N/*/mensaje*.tsx`                                                           |
| Anuncios del club y del equipo                                                           | `W/anuncios`, `N/*/anuncios.tsx`                                                             |
| Novedades (avisos dentro de la app) y notificaciones push, web y móvil, con preferencias | `W/novedades`, `W/perfil/notificaciones`, `packages/core/src/notifications/multi-channel.ts` |

**F. Familias** (apartado pequeño, §7.1)

| Función                                                                                                    | Origen                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| App en iOS y Android: convocatorias, calendario, ficha, informes, sesiones y jugadas compartidas, mensajes | `N/family/*`                                                         |
| Consentimientos (imagen interna, imagen en redes, datos médicos), con retirada                             | `apps/native/src/ui/consents-card.tsx`                               |
| Seguidores: la familia invita a abuelos u otros familiares a seguir al jugador                             | `W/mi-ficha/seguidores`, `N/family/seguidores.tsx`, `WP/spectator/*` |
| Descarga en PDF de los datos del menor                                                                     | `W/mi-ficha/export/[playerId]/route.ts`                              |

**G. Transversal**

| Función                                                            | Origen                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Castellano, valenciano e inglés en la web y en la app              | `apps/web/src/i18n/routing.ts:4`, `apps/native/src/locale/catalogs.ts:12` |
| App nativa iOS y Android, publicada                                | `apps/web/src/lib/family-web-cut.ts:61-64` (enlaces de tienda)            |
| Web instalable (PWA)                                               | `apps/web/public/manifest.json`                                           |
| En el móvil, la información ya descargada se consulta sin conexión | `packages/core/src/offline/write-guard.ts:2-6`                            |

### 5.2 Matices para redactar bien

- **Solo en la web:** crear eventos; ejercicios, pizarra y edición de jugadas; crear y planificar sesiones; editar informes; PDF del staff; importación, ajustes y cambio de temporada. **No decir «desde el móvil»** de nada de esto.
- **Sin conexión:** en el móvil solo se lee lo ya descargado, y la única escritura sin conexión son las acciones del directo. No decir «todo funciona sin conexión».
- **iPad:** la app nativa no está optimizada para tablet (`apps/native/app.json`: `supportsTablet: false`). En iPad se usa la web.
- **Alta del club:** no hay autoalta. El club lo crea Cognix (`WP/onboarding/page.tsx:21-26`). Encaja con «Solicitar demo».

### 5.3 No se anuncia

| Qué                                                                                                | Por qué                                                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Suscripción de las familias (precio por cuenta y año en `packages/core/src/subscription/rules.ts`) | Apagada (`SUBSCRIPTION_GATE`), y la web no lleva precios. → Pregunta 7                              |
| Corte web para familias (`FAMILY_WEB_CUT`)                                                         | Apagado. Hoy las familias también pueden usar la web; la web comercial solo dice que tienen la app. |
| Importación de partidos de la FFCV                                                                 | Herramienta interna del superadmin (`packages/core/src/ffcv/permiso.ts`).                           |
| Notificaciones por correo                                                                          | Canal desactivado (`W/perfil/notificaciones/preferences-matrix.tsx:41`).                            |
| Permisos configurables por entrenador                                                              | El sistema se eliminó (`apps/web/src/lib/messaging-permissions.ts:24`).                             |
| Confirmación de asistencia a entrenamientos por las familias                                       | No existe en el código; está en el backlog (`docs/journey/plan-maestro.md:924`).                    |
| Invitación masiva por correo desde Excel                                                           | Solo spec (`docs/specs/16.x-bulk-invite-excel.md`).                                                 |
| Traspaso de propiedad del club, cuotas y finanzas, scouting, vídeo, GPS                            | No construido o fuera del plan (`plan-maestro.md:936, 1026-1031`).                                  |
| Inteligencia artificial                                                                            | No existe; en el plan es Ola 3. No se menciona.                                                     |
| Consola de plataforma, `dev-diagram`, `dev-pitch-editor`                                           | Internas o solo de desarrollo.                                                                      |
| Que la dirección puede consultar las conversaciones                                                | Existe (modo observador y `conversation.audit_read`). Es delicado de anunciar. → Pregunta 8         |

---

## 6. Seguridad y protección del menor

### 6.1 Afirmaciones que se publican (verificadas)

| #   | Afirmación (borrador)                                                                                                                                                                                                                                                          | Evidencia                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Solo se entra a un club por invitación.** No hay registro abierto.                                                                                                                                                                                                           | Trigger `registro_no_permitido`, `supabase/migrations/20260919000000_f14d_close_open_signup.sql:36-52`; `/signup` redirige, `middleware.ts:40-49`                         |
| S2  | **Cada club solo ve sus datos:** el control de acceso se aplica en la propia base de datos, tabla a tabla, no solo en la pantalla.                                                                                                                                             | RLS activa en todas las tablas de `public` (`supabase/migrations/`); test `supabase/tests/rls_multi_tenant.sql`                                                           |
| S3  | **Cada cambio pasa más de 140 pruebas automáticas de seguridad de la base de datos** antes de publicarse.                                                                                                                                                                      | 144 ficheros en `supabase/tests/`; job `pgtap` bloqueante en `.github/workflows/ci.yml:230-376`                                                                           |
| S4  | Cada persona ve lo que le corresponde según su papel: dirección, coordinación, entrenador o familia.                                                                                                                                                                           | Roles en `20260822000000_f1b0_director_role_and_club_owner.sql:26-33`; funciones de acceso por rol en la RLS                                                              |
| S5  | **La minoría de edad se calcula cada día con la fecha de nacimiento.** Mientras el jugador es menor, sus datos sensibles (salud, consentimientos, supresión y descarga) los gestiona su tutor; a los 18 pasan al jugador.                                                      | `player_is_minor` y `user_manages_player_sensitive`, `20261067000000_mn1_cuenta_menor_helpers.sql:85-135`                                                                 |
| S6  | **Un menor no puede tener cuenta propia sin un tutor vinculado**, y el último tutor no puede desvincularse mientras el menor la tenga.                                                                                                                                         | `20261097000000_self_no_nace_sin_tutor.sql`, `20261098000000_invitacion_self_sin_tutor.sql`; test `self_no_nace_sin_tutor.sql`                                            |
| S7  | **Consentimientos separados** (imagen interna, imagen en redes, datos médicos), en un registro que no se puede editar ni borrar: retirar un consentimiento añade una entrada nueva.                                                                                            | `20260901000000_f14_1_consent_base.sql:33-39, 82-134`                                                                                                                     |
| S8  | **Sin autorización de imagen, la foto del jugador no se muestra.** Si se retira, deja de verse al momento, también en el almacenamiento de archivos.                                                                                                                           | `20261079000000_foto_sin_decision_no_se_ve.sql:53-74`; storage en `20260910000000_f14_5_season_consents.sql:110`; buckets privados; test `foto_sin_decision_no_se_ve.sql` |
| S9  | **Los datos de salud solo los ven** la dirección del club, el cuerpo técnico del equipo del jugador (y el del equipo que lo convoca, solo hasta el final del día del partido), el tutor y el propio jugador si es mayor de edad. **Siempre con el consentimiento registrado.** | `user_can_access_player_medical`, `20261094000000_promocion_caduca_medica.sql:71-103`; puerta en `get_player_medical`; test `rls_medical_consents.sql`                    |
| S10 | **Cada consulta de datos de salud por parte del personal queda registrada:** quién, cuándo y desde dónde.                                                                                                                                                                      | `get_player_medical` escribe `medical.read` en `audit_log` (`20260924000000_f14b_4_superadmin_medical_audit.sql:21-54`)                                                   |
| S11 | **El tutor puede descargar en PDF todos los datos de su hijo** y pedir su supresión, que aprueba el club.                                                                                                                                                                      | `W/mi-ficha/export/[playerId]/route.ts`; `apps/web/src/app/api/erasures/approve/route.ts`                                                                                 |
| S12 | **Cualquier usuario puede eliminar su cuenta**, desde la app o desde la web.                                                                                                                                                                                                   | `apps/native/src/ui/delete-account-card.tsx`, `W/perfil/delete-account-card.tsx`; cron diario `api/cron/account-deletions`                                                |
| S13 | Recuperar la contraseña tiene **límites de intentos**, y la invitación también.                                                                                                                                                                                                | `20261092000000_limite_envios_recuperacion.sql`, `20261074000000_r2_limite_intentos_aceptacion.sql`                                                                       |
| S14 | **En el móvil, la sesión se guarda en el almacén seguro del sistema** (Keychain y Keystore).                                                                                                                                                                                   | `apps/native/src/lib/supabase.ts:30` (`expo-secure-store`)                                                                                                                |
| S15 | Los informes de errores técnicos no incluyen correos, IP ni cookies, y **no se graban las sesiones** de uso.                                                                                                                                                                   | `apps/web/sentry.*.config.ts` (replays a 0), `apps/native/src/lib/sentry.ts:12-53`                                                                                        |
| S16 | **No guardamos datos de tarjeta:** los pagos dentro de la app los procesan Apple y Google.                                                                                                                                                                                     | `apps/native/src/subscription/purchases.ts:67`; no hay ninguna librería de pago con tarjeta                                                                               |
| S17 | **Sin publicidad ni analítica de terceros en la app.**                                                                                                                                                                                                                         | `apps/web/package.json` (sin GA ni similares); Sentry por túnel propio `/monitoring`                                                                                      |
| S18 | **Proveedores:** Supabase (base de datos y archivos), Vercel (alojamiento), Resend (correo), Sentry (errores), Expo, Apple y Google (avisos al móvil) y RevenueCat (suscripciones en la app).                                                                                  | Código: `apps/web/src/lib/email/resend.ts`, `lib/expo-push.ts`, `sentry.*`, `api/webhooks/revenuecat`                                                                     |

### 6.2 Lo que NO se publica

| Afirmación                                                               | Motivo                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «Ni siquiera nosotros vemos tus datos» / «aislamiento absoluto»          | **Falso.** El superadmin de Cognix actúa como `admin_club` en todos los clubes, datos de salud incluidos (`20260921000000_f14b_2_superadmin_chokepoint.sql:6-11`). Queda registrado (`medical.read.platform`), pero existe. → Pregunta 9 |
| Región concreta («datos en la UE», «servidores en España»)               | No consta en el repo: `vercel.json` no tiene `regions` y la región de Supabase no está en la configuración. → Pregunta 10                                                                                                                |
| «Cifrado en reposo», «copias diarias», «cifrado de campos»               | No se puede comprobar con el repo; no hay cifrado propio de campos.                                                                                                                                                                      |
| «Contraseñas robustas», «verificación en dos pasos», «bloqueo de cuenta» | No hay segundo factor. La política de contraseñas de producción no está en el repo, y en local el mínimo es 6.                                                                                                                           |
| «Verificamos la identidad o la tutela»                                   | No: la asume el club (`Documentos/misterfc-politica-privacidad.md:91`).                                                                                                                                                                  |
| «Los menores gestionan sus derechos desde los 14»                        | El código usa 18 (S5).                                                                                                                                                                                                                   |
| «Cabeceras de seguridad», «CSP»                                          | No hay (`next.config.ts` sin `headers()`). Lo apunto como tarea aparte (§12).                                                                                                                                                            |
| «Cumplimos el RGPD» o certificaciones                                    | No se afirma cumplimiento ni certificación. Se describen medidas concretas.                                                                                                                                                              |

### 6.3 Página `/seguridad`

- **Bloques:** acceso y aislamiento (S1-S4), menores (S5-S8), salud (S9-S10), derechos de las familias (S11-S12), cuentas y contraseñas (S13-S14), proveedores y privacidad (S15-S18).
- **Al final, enlace a la política de privacidad.**

---

## 7. Apartado de familias y apartado oculto de clubes

### 7.1 Familias (pequeño, en la portada y en el pie)

**Título:** ¿Eres familia de un jugador?
**Texto:** Tu club te invitará a la app MisterFC: convocatorias, calendario, mensajes y la evolución de tu hijo o hija.
**Botones** (enlaces reales, `apps/web/src/lib/family-web-cut.ts:61-64`):

- App Store: `https://apps.apple.com/es/app/misterfc/id6810337932`
- Google Play: `https://play.google.com/store/apps/details?id=com.misterfc.app`

Los distintivos oficiales «Download on the App Store» y «Disponible en Google Play» se usan según las guías de marca de Apple y Google, en cada idioma.

### 7.2 Clubes (OCULTO hasta tener permiso por escrito)

- **Componente** `ClubsShowcase` en `WP/(web)/_components/`.
- **Datos** en `apps/web/src/lib/web/showcase.ts`: una lista **vacía** de `{ nombre, logo, cita?, autor?, permisoFirmado: fecha }`.
- **Cuándo se muestra:** solo con `NEXT_PUBLIC_WEB_SHOWCASE === 'on'` **y** al menos un club con `permisoFirmado`.
  - En cualquier otro caso no se pinta nada: ni título ni hueco ni «próximamente».
  - Un test comprueba que, con la configuración por defecto, la portada no contiene el apartado.
- Los logos de clubes reales nunca se sacan de la base de datos para esto: se suben a mano cuando haya permiso.

---

## 8. Formulario de demo

Funciona como en NIDO: Server Action + Zod, campo trampa, límite por IP, Resend y página propia, sin pop-up.

### 8.1 Campos

| Campo                                | Tipo                                                              | Obligatorio |
| ------------------------------------ | ----------------------------------------------------------------- | ----------- |
| Nombre y apellidos                   | texto                                                             | sí          |
| Tu papel en el club                  | lista: Dirección / Coordinación / Entrenador o entrenadora / Otro | sí          |
| Nombre del club                      | texto                                                             | sí          |
| Municipio                            | texto                                                             | sí          |
| Número de equipos                    | lista: 1-5 / 6-10 / 11-20 / Más de 20                             | sí          |
| Correo electrónico                   | email                                                             | sí          |
| Teléfono                             | tel                                                               | no          |
| Comentario                           | textarea (máx. 500)                                               | no          |
| ☐ He leído la política de privacidad | casilla sin marcar                                                | sí          |

Son 6 obligatorios, más la casilla. No hay casilla de comunicaciones comerciales.

### 8.2 Textos

- **«¿Qué pasa después?»:** Te escribiremos al correo que nos indiques para acordar día y hora. La demo es por videollamada y dura unos 30 minutos. Solicitarla no te compromete a nada.
  - **El plazo de respuesta** solo se pone si se puede cumplir, por ejemplo «en un máximo de 2 días laborables». → **Pregunta 6.**
- **Información básica de protección de datos** bajo el botón. Responsable: Cognix Labs, S.L.U. Finalidad: atender la solicitud de demo. Base: medidas precontractuales. Destinatarios: Vercel y Resend. Conservación y derechos según §10. Enlace a la privacidad.
- **Si el envío falla:** error con el correo de contacto como alternativa.

### 8.3 Envío

- **Aviso al equipo:** a `info.cognixlabs@gmail.com` (variable `DEMO_TO`), con todos los campos y **`Reply-To` = el correo del solicitante**.
- **Remitente propuesto:** `MisterFC <demo@misterfc.es>` (variable `DEMO_FROM`). `misterfc.es` ya está verificado en Resend; hoy envía `no-reply@misterfc.es` (`apps/web/src/lib/email/resend.ts:25`).
  - ⚠️ **`misterfc.es` no tiene MX** (consulta DNS del 2026-10-14). Un correo a `demo@misterfc.es` rebotaría.
  - Por eso el **acuse lleva `Reply-To: info.cognixlabs@gmail.com`**: si el club contesta al acuse, la respuesta llega.
- **Acuse al solicitante:** en su idioma, sin publicidad. «Hemos recibido tu solicitud; te escribiremos para acordar la demo.»
- **Envío técnico:** se reutiliza `sendEmail` (`apps/web/src/lib/email/resend.ts`), que ya existe, y la misma `RESEND_API_KEY`.
  - Los eventos de este correo llegarán al webhook de Resend, que hoy solo sigue invitaciones; ese webhook los ignora con un 200 (`apps/web/src/app/api/webhooks/resend/route.ts`).
- **Límite:** 5 envíos por IP y hora, en memoria, igual que en NIDO. Es aproximado: hay un contador por instancia de la función.

### 8.4 Enlace para reservar hora

- **No va incrustado en la web**, porque los calendarios externos suelen poner cookies y obligarían a poner aviso de cookies.
- **Propuesta:** si hay herramienta de reservas, el enlace va **en el acuse por correo**. Si no, la cita se acuerda por correo, como en NIDO. → **Pregunta 5.**

### 8.5 Páginas

- `/{idioma}/demo`: formulario.
- `/{idioma}/demo/gracias`: confirmación, con `noindex`.

---

## 9. Capturas

### 9.1 Reglas

- **Solo datos ficticios, en un entorno local**, nunca en producción. `apps/web/scripts/seed-test-accounts.mjs` escribe en el Supabase **remoto**: no se usa para esto.
- **Hoy no hay datos de prueba realistas.** No existe `supabase/seed.sql`, aunque `supabase/config.toml:60-65` lo referencia.
- **Club ficticio** con nombre inventado (por ejemplo «CF Ribera Nord», tras comprobar que no existe) y escudo dibujado para la ocasión.
- **Personas:**
  - nombres y apellidos generados (combinaciones comunes, sin personas reales);
  - **ninguna foto de jugador**: sin foto, o con las iniciales que ya pinta la app;
  - sin caras en ninguna imagen.
- **Nunca `udfonteta`** ni ningún club real.

### 9.2 Cómo se generan (Checkpoint B)

1. `supabase start` local, con todas las migraciones del repo.
2. **Seed nuevo**, `supabase/seed/web-demo.sql`:
   - un club con 6 equipos de la temporada y unos 90 jugadores ficticios;
   - cuerpo técnico, ejercicios con diagrama, sesiones, convocatorias, un partido con eventos de directo, informes y mensajes.
   - **No lo carga `config.toml`.** Se aplica a mano, para que no se mezcle con los tests.
3. **Web:** script de Playwright que inicia sesión con cada rol y captura las pantallas en 1440×900 y en 390×844.
4. **App nativa:** build de desarrollo de Expo contra el Supabase local, capturas en el emulador de Android y en el simulador de iOS. → **Pregunta 11.**
5. **Mockups** de portátil y móvil; las capturas se guardan en `apps/web/public/web/capturas/` con `next/image`.

### 9.3 Lista

| #   | Captura                                         | Plataforma | Dónde se usa            |
| --- | ----------------------------------------------- | ---------- | ----------------------- |
| C1  | Dashboard de dirección                          | Web        | Hero (portátil), §4.4-5 |
| C2  | Convocatoria vista por la familia, respondiendo | Nativa     | Hero (móvil), §4.4-2    |
| C3  | Planificador semanal de sesiones                | Web        | §4.4-1, Funciones B     |
| C4  | Ejercicio con diagrama                          | Web        | Funciones B             |
| C5  | Editor de alineación                            | Web        | §4.4-2, Funciones C     |
| C6  | Directo del partido (entrada rápida)            | Nativa     | §4.4-3, Funciones C     |
| C7  | Informe de desarrollo con gráficas              | Web        | §4.4-4, Funciones D     |
| C8  | Mensajes del equipo                             | Nativa     | §4.4-6, Funciones E     |
| C9  | Ficha deportiva del jugador                     | Nativa     | Funciones D, familias   |
| C10 | Consentimientos de imagen y salud               | Nativa     | Seguridad               |
| C11 | Jugada animada                                  | Web        | Funciones B             |
| C12 | Login del club con escudo y color               | Web        | Funciones A             |

Hasta tener las capturas, cada sitio lleva un hueco con marco, igual que en NIDO.

---

## 10. Legal

> **Todo lo de este apartado queda PENDIENTE DE REVISIÓN por la abogada.** En la web se marca como en NIDO, con «Pendiente: revisión de este texto por un abogado».

### 10.1 Mecanismo

- Los textos legales se escriben en `Documentos/*.md`.
- `scripts/generar-textos-legales.mjs` los copia a `apps/web/src/content/legal/` y se pintan en `WP/legal/[slug]` (`apps/web/src/lib/legal-content.ts:13-18`).
- **Se añaden dos documentos con el mismo mecanismo**, sin tocar los cuatro actuales:
  - `Documentos/misterfc-aviso-legal.md` → `/{idioma}/legal/aviso-legal`
  - `Documentos/misterfc-politica-cookies.md` → `/{idioma}/legal/cookies`

### 10.2 Aviso legal (LSSI-CE, art. 10)

- **Titular:** Cognix Labs, S.L.U. · NIF B93996122 · Actor Antonio Ferrandis, 10, 46013 Valencia · info.cognixlabs@gmail.com.
- **Registro Mercantil** de Valencia, sección 8.ª, hoja V-237563, inscripción 1.ª, de 8 de septiembre de 2026.
- **Objeto de la web:** informar sobre MisterFC y permitir solicitar una demo. «Acceso clubes» lleva a la aplicación, que tiene sus propios términos.
- **Contenido estándar:** condiciones de uso, responsabilidad, propiedad intelectual y ley aplicable. Propongo el esquema de los textos revisados de NIDO, adaptado.

### 10.3 Política de cookies

**Cookies que pone hoy la web**, todas propias y técnicas o funcionales; ninguna de analítica ni de publicidad:

| Cookie                                     | Para qué                          | Duración real                                 | Origen                                               |
| ------------------------------------------ | --------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `sb-<ref>-auth-token` (y `-code-verifier`) | Sesión de usuario                 | 400 días, la que fija la librería por defecto | `@supabase/ssr` vía `middleware.ts:81-93`            |
| `NEXT_LOCALE`                              | Idioma                            | De sesión, o 1 año si se elige en el perfil   | next-intl; `W/perfil/actions.ts:68-72`               |
| `active_club_id`                           | Club activo                       | 1 año                                         | `apps/web/src/components/shell/actions.ts:44-49`     |
| `active_player_id`                         | Jugador seguido (seguidores)      | 1 año                                         | `apps/web/src/components/spectator/actions.ts:35-39` |
| `mfc_sidebar_collapsed`                    | Recordar la barra lateral plegada | 1 año                                         | `apps/web/src/components/shell/sidebar-toggle.tsx`   |

- **Las páginas comerciales:** un visitante anónimo solo recibe `NEXT_LOCALE` (si elige otro idioma). Vercel Web Analytics no usa cookies.
- **Sin banner**, porque todas son técnicas. La abogada debe confirmarlo, sobre todo para `mfc_sidebar_collapsed`.

### 10.4 Cambios en la política de privacidad (`Documentos/misterfc-politica-privacidad.md`)

**A. Añadir un apartado para la web comercial.** En el formulario de demo, Cognix es **responsable**, no encargado como en la app.

- **Datos:** los del formulario.
- **Finalidad:** atender la solicitud y organizar la demo; sin comunicaciones comerciales.
- **Base:** medidas precontractuales (art. 6.1.b).
- **Conservación:** **pendiente**. En NIDO son 12 meses desde el último contacto. → Pregunta 12
- **Destinatarios:** Vercel y Resend.
- **Transferencias:** las de la redacción definitiva de NIDO.
- **Analítica:** Vercel Web Analytics, solo en las páginas comerciales. **Base pendiente:** en NIDO, interés legítimo (art. 6.1.f).

**B. Contradicciones que he encontrado entre la política actual y el código**, para que las vea la abogada (no las cambio yo):

1. **Lista de quién ve los datos médicos** (§13, línea 208). No coincide con el código (S9): el código incluye al director y al jugador mayor de edad, y al coordinador solo si está asignado al equipo.
2. **Cloudflare R2** aparece como proveedor (§8), pero no se usa: los archivos están en Supabase Storage.
3. **Sentry** (§8, línea 138): la política dice que se eliminan los parámetros de la URL, pero en la web no se hace (sí en la app nativa).
4. **Cookies** (§15): las duraciones no cuadran y falta `mfc_sidebar_collapsed`.
5. **Menores** (§3, línea 51): dice «solo por invitación del tutor», pero la dirección también puede invitar al menor si ya tiene tutor.
6. **Proveedores que no aparecen:** el servicio de avisos de Expo (`apps/web/src/lib/expo-push.ts`) y los servicios de avisos web del navegador (VAPID).
7. **Nombre del titular:** `WP/legal/privacidad/page.tsx:15` dice «Cognix Labs, S.L.» y el documento dice S.L.U.
8. **`Documentos/misterfc-eliminacion-cuenta.md`:**
   - «desde los 14 años» frente a los 18 del código;
   - «copias de 7 días» y «3 años para consentimientos y auditoría» no se pueden comprobar en el repo, y el registro de consentimientos no se puede borrar.

---

## 11. SEO

- **`sitemap.xml`** (`apps/web/src/app/sitemap.ts`):
  - **Hoy:** las 4 legales en `/es`.
  - **Nuevo:** la portada, `/funciones`, `/seguridad` y `/demo` en los 3 idiomas, con alternates; y las 6 legales en `/es`, como ahora.
  - `/demo/gracias` no entra.
- **`robots.txt`:** igual; ya permite `/`.
- **hreflang:** `es`, `ca` para `/va` y `en`, con `x-default` → `/es`. Así se hizo en NIDO, porque `va` no es un código hreflang válido. → **Pregunta 3.**
- **Canonical:**
  - la portada canoniza a `/{idioma}` (nunca a `/portada`);
  - cada página comercial, a sí misma.
- **OpenGraph:** imagen por idioma, generada en el build con Inter y el logo; título y descripción por página.
- **`metadataBase`** desde `SITE_URL` (`apps/web/src/lib/site-url.ts`).
- **Páginas de acceso** (`/clubes`, `/{slug}`, `/signin`): propongo `noindex`, para que en Google salga la portada y no el selector de clubes. Es un cambio de metadatos sin efecto funcional. → **Pregunta 4.**
- **Analítica:** `@vercel/analytics`, **solo en el layout `(web)`**, para no medir la app. Hay que activarla en el panel de Vercel; eso lo haces tú.

---

## 12. Dudas y decisiones que necesito que me cierres

1. **Tratamiento:** ¿tú, como la app («Elige tu club»), o usted, como NIDO? El borrador va de tú.
2. **Slugs:** ¿se quedan en castellano en los 3 idiomas (`/en/funciones`), como el resto de la app? Es lo que propongo, porque traducirlos obliga a activar `pathnames` en toda la app (§3.2).
3. **Valenciano para buscadores:** ¿hreflang `ca` para `/va`, como en NIDO? La redirección por idioma no se toca: el navegador en `ca` sigue entrando en castellano.
4. **Acceso de entrenadores con la sesión caducada:**
   - ¿cambiamos el `start_url` de la PWA a `/clubes` (§1.5)?
   - ¿«Volver» en las páginas legales lleva a la portada o sigue en `/clubes`?
   - ¿`noindex` en `/clubes`, `/{slug}` y `/signin` (§11)?
5. **Reserva de hora:** ¿tenéis herramienta (Calendly, Google Calendar…)? Si la hay, el enlace va en el acuse por correo, no en la web.
6. **Plazo y duración de la demo:** ¿qué plazo de respuesta podéis cumplir («2 días laborables»)? ¿La demo dura 30 minutos?
7. **Coste para las familias:** la FAQ «¿Las familias tienen que pagar algo?» depende de la suscripción, que está construida pero apagada. ¿La quito, o qué respuesta damos sin cifras?
8. **Conversaciones:** ¿se anuncia que la dirección puede consultar las conversaciones del club (modo observador)? Es una garantía para las familias, pero es delicado; por defecto no lo pongo.
9. **Acceso de Cognix:** ¿decimos en Seguridad que el soporte de Cognix puede entrar a un club y que cada consulta de datos de salud queda registrada? Es verdad y verificable; callarlo no es mentir, pero «nadie más ve tus datos» sí lo sería.
10. **Región de los datos:** ¿puedes confirmar en los paneles la región de Supabase y la de las funciones de Vercel? Sin eso no se publica «datos en la UE» (§6.2).
11. **Capturas de la app nativa:** ¿vale generarlas con un build de desarrollo contra un Supabase local con datos ficticios (§9.2), o preferís otra vía?
12. **Conservación de solicitudes de demo:** ¿12 meses desde el último contacto, como en NIDO? Lo revisa la abogada.
13. **Logo:** en el repo **no hay fichero de logo** de MisterFC. La web de la app escribe «MisterFC» como texto verde (`apps/web/src/components/shell/sidebar.tsx:39`) y la nativa solo tiene el icono (`apps/native/assets/icon.png`). ¿Me pasas el logo en SVG o PNG grande? ¿O uso el icono más el nombre en texto?
14. **Verde de marca:** la web usa `#10B981` (`apps/web/src/app/globals.css`) y la app nativa `#438832` como fondo del icono (`apps/native/app.json`). ¿Cuál manda en la web comercial?
15. **Remitente:** ¿`demo@misterfc.es`, con `Reply-To` a info.cognixlabs@gmail.com porque `misterfc.es` no recibe correo (§8.3)?
16. **Tareas aparte** (no son de la web comercial, solo las anoto):
    - cabeceras de seguridad, que no hay;
    - `.env.example` incompleto (`NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, VAPID y RevenueCat);
    - la lista de slugs reservados, que solo se aplica en las RPC y no en un UPDATE directo;
    - los iconos de `manifest.json`, que no existen (`public/icons/` solo tiene un README).

---

### Anexo: resumen de comprobaciones en producción (2026-10-14, solo lectura)

| Comprobación     | Resultado                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Dominio          | `misterfc.es` (raíz `A 216.198.79.1`, Vercel); `www` → CNAME a Vercel con 308 a la raíz; nameservers de Arsys (`servidoresdns.net`) |
| Correo           | DKIM y SPF de Resend en `resend._domainkey` y `send`; `_dmarc p=none`; **sin MX en la raíz**                                        |
| Vercel           | Proyecto `misterfc-web`, equipo Cognix (Pro), raíz `apps/web`                                                                       |
| `/.well-known/*` | JSON correcto; solo reclaman `/{es,en,va}/invite/*`                                                                                 |
| Legales          | `/es/legal/{privacidad,terminos,eliminacion-cuenta,desistimiento}` → 200; `/legal/privacidad` → 308 a `/es/legal/privacidad`        |
| Raíz             | `/` → `/es` → `/es/clubes`; Accept-Language `en` → `/en`; `ca` → `/es`; pone la cookie `NEXT_LOCALE`                                |
