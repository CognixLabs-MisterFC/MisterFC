# ADR-0021 — El borrado de cuenta es anonimización, y lo impone el esquema

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Iker Milla, Jose
- **Related**: [BC.0 — Borrado de cuenta](../specs/BC.0-borrado-de-cuenta.md), migración `20260912000000_f14_7_erasure` (derecho al olvido del jugador), migraciones `20261049`/`20261050` (baja de miembros)

## Context

Apple bloquea la publicación en App Store (Guideline 2.1 / 5.1.1 v): una app que da acceso a cuentas
debe permitir **iniciar el borrado de la cuenta desde dentro de la app**. Hoy MisterFC no tiene nada
parecido: lo único que existe es la supresión RGPD de los datos del **jugador** (F14-7), que deja
intacta la cuenta del tutor.

Al diseñar el borrado apareció la pregunta obvia: ¿se borra la fila de `auth.users` o se anonimiza?
La respuesta no es una preferencia de estilo. **El esquema ya la ha decidido.**

`public.profiles.id` referencia `auth.users(id)` con `ON DELETE CASCADE`. Borrar el usuario de auth
borra su fila de `profiles`. Y sobre `profiles` cuelgan **52 claves foráneas**, de las cuales cinco son
`ON DELETE RESTRICT` y una veintena `NO ACTION`:

| Tabla | Columna | FK |
|---|---|---|
| `audit_log` | `actor_profile_id` | RESTRICT |
| `messages` | `sender_profile_id` | RESTRICT |
| `announcements` | `author_profile_id` | RESTRICT |
| `team_messages` | `sender_profile_id` | RESTRICT |
| `staff_messages` | `sender_profile_id` | RESTRICT |
| `consents` | `tutor_profile_id` | NO ACTION |
| `erasure_requests` | `requested_by` | NO ACTION |
| `events`, `evaluations`, `training_attendance`, `callup_responses`, … | `created_by` / `recorded_by` / … | NO ACTION |

Consecuencia comprobable: `supabase.auth.admin.deleteUser(uid)` sobre un usuario que haya escrito **un
solo mensaje** o tenga **una sola línea de auditoría** falla con violación de FK. No es un caso raro:
todo usuario real de MisterFC tiene ambas cosas.

Las salidas alternativas se estudiaron y se descartaron:

1. **Repuntar las FK a un perfil centinela "usuario eliminado"** y entonces sí borrar la fila. Colapsa a
   todos los borrados en una misma identidad: dos personas distintas en un mismo hilo pasarían a ser la
   misma, y `conversations.coach_profile_id` (CASCADE) se llevaría los hilos por delante.
2. **Aflojar las FK a `SET NULL`.** Rompe el `NOT NULL` de las columnas de autoría y destruye la
   trazabilidad que `audit_log` existe para garantizar (LOPDGDD art. 32).
3. **Romper el CASCADE de `profiles.id → auth.users`.** Radio de impacto enorme sobre el signup y sobre
   `handle_new_user`, para ganar exactamente nada.

Hay además un motivo legal que apunta en la misma dirección: `consents` es append-only y es la prueba
de quién consintió qué y cuándo; el histórico deportivo del menor tiene un responsable de tratamiento
(el club) distinto del titular de la cuenta.

## Decision

**El borrado de cuenta se implementa como anonimización irreversible, no como `DELETE`.**

1. La fila de `public.profiles` **sobrevive**, vaciada de PII: `full_name`, `avatar_url`, `phone` y
   `date_of_birth` a `NULL`, y una marca `deleted_at`. La app pinta "Usuario eliminado" desde i18n
   (es/en/va) cuando `deleted_at` no es nulo — el literal **no** se guarda en la base.
2. La fila de `auth.users` **también sobrevive**, pero se **neutraliza** con la Admin API desde
   servidor: email a un dominio no enrutable, contraseña aleatoria, teléfono y metadatos vacíos, ban
   permanente. Sin login, sin recuperación de contraseña, sin correo al que enviar nada.
3. Lo que sí se borra de verdad: `player_accounts`, `expo_push_tokens`, `push_subscriptions`,
   `notification_preferences`, `notifications`, `team_follows`, `player_spectators`, los estados de
   lectura de chat, y el objeto del avatar en Storage.
4. Lo que se conserva íntegro y por decisión explícita: `consents` (con su `ip` y su `user_agent`), los
   cuerpos de `messages` / `team_messages` / `staff_messages` / `announcements`, `audit_log`,
   `erasure_requests` y toda la autoría del histórico deportivo.

El borrado se **inicia** siempre desde la app y **el acceso cesa en el acto**; lo que puede quedar
pendiente es la supresión de los datos del **menor**, que exige decisión del club. Plazo máximo
**30 días naturales**, pasados los cuales la cuenta se anonimiza igual (ver spec BC.0 §5).

## Consequences

- **Positivas**
  - Es la única opción que el esquema admite sin cirugía mayor, y además es la correcta: preserva la
    prueba de consentimiento y la trazabilidad de auditoría.
  - `memberships.left_at` (migraciones `20261049`/`20261050`) ya corta el acceso de forma probada y
    **reversible**: el arrepentimiento sale gratis.
  - El resultado es indistinguible de un borrado para el usuario y para el revisor de Apple: no puede
    volver a entrar y no queda ningún dato personal suyo.

- **Negativas**
  - Sobreviven datos que un lector ingenuo llamaría personales: la `ip` de `consents` y el contenido de
    los mensajes que el propio usuario escribió. Es una decisión consciente (Jose, 2026-09-10) y **debe
    quedar escrita en la política de privacidad**; si no está escrita, no está justificada.
  - "Borrado" es un término que aquí significa anonimización. Los textos de la app y el legal tienen
    que decirlo sin eufemismos.
  - Queda una fila en `auth.users` por cada cuenta borrada. Crece sin límite, aunque sin PII.

- **Neutras**
  - Las columnas de autoría siguen apuntando a un perfil válido, así que ningún informe ni ninguna
    consulta histórica se rompe.
  - Si algún día Supabase permitiera borrar de verdad, la decisión se podría revisar: el estado
    `completed` de `account_deletion_requests` marca exactamente qué filas serían candidatas.
