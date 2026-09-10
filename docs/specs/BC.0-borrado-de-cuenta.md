# BC.0 — Borrado de cuenta

> **Estado**: BC-1 (SQL) entregado · resto pendiente
> **Dispara**: Apple Guideline 2.1 / 5.1.1(v) — bloqueo de publicación en App Store.
> **Decisión de fondo**: [ADR-0021 — anonimización forzada por el esquema](../decisions/ADR-0021-anonimizacion-forzada-por-el-esquema.md)

## 1 · Problema

MisterFC da acceso a cuentas, así que Apple exige poder **iniciar el borrado de la cuenta desde dentro
de la app**. Hoy no existe: lo único parecido es la supresión RGPD del **jugador** (F14-7), que deja la
cuenta del tutor intacta. Verificado también que no hay ningún `deleteUser`, `delete_account` ni
equivalente en todo el repo.

## 2 · Decisiones de producto (Jose, 2026-09-10)

1. **No se puede borrar la cuenta si eres el único tutor de un jugador activo** — pero el usuario debe
   poder resolverlo **sin depender de nadie**: la misma pulsación genera la solicitud de supresión de
   ese jugador.
2. **El borrado es por anonimización**, no borrado total (ver ADR-0021).
3. **`consents` no se toca en absoluto**, `ip` y `user_agent` incluidos. El blindaje append-only queda
   intacto.
4. **Los mensajes se conservan con su contenido**, atribuidos a un usuario eliminado. Decisión
   consciente: **el texto legal debe decirlo**.
5. **El histórico deportivo del jugador se conserva con su nombre** (estadísticas, convocatorias,
   asistencia, valoraciones): no es dato de la cuenta del tutor.
6. **Plazo: 30 días naturales.** La cuenta se anonimiza pase lo que pase, apruebe o rechace el club.
7. **Cancelable en cualquier momento** hasta que el job ejecute el borrado. Sin ventana más corta.
8. **`admin_club` puede borrarse.** No se bloquea a nadie: se escala al superadmin de plataforma, y
   Jose designa nuevo admin.
9. **Nombre visible**: "Usuario eliminado", en es/en/va, sin ningún resto.
10. **Se avisa** al club y al otro tutor del jugador.
11. **Botón en Perfil**, al final, en **nativa y web**.

"Jugador activo" = `players.erased_at is null AND players.left_club_at is null`.

## 3 · Qué se borra y qué sobrevive

### Se borra
`player_accounts` · `expo_push_tokens` · `push_subscriptions` · `notification_preferences` ·
`notifications` · `team_follows` · `player_spectators` (como espectador) ·
`team_chat_participation` · `team_conversation_reads` · `staff_conversation_reads` ·
objeto de Storage `profile-avatars/<profile_id>/*`.

Los tokens de push y las suscripciones se borran **en el momento de la solicitud**, no al completar: si
no, seguiríamos notificando a alguien que ya ha pedido irse.

### Se anonimiza
| Tabla | Qué |
|---|---|
| `auth.users` | Admin API: email no enrutable, contraseña aleatoria, teléfono y metadatos vacíos, ban permanente |
| `profiles` | `full_name`, `avatar_url`, `phone`, `date_of_birth` → `NULL`; `deleted_at` marcado |
| `memberships` | `left_at` en la solicitud; `phone` y `contact_email` → `NULL` al completar |
| `invitations` | `email` de las filas dirigidas al usuario; las pendientes se invalidan |
| `clubs` | `owner_profile_id` → `NULL` si era el dueño (para que un nuevo admin lo tome) |

### Se conserva
`consents` íntegro · cuerpos de `messages`, `team_messages`, `staff_messages`, `announcements` ·
`conversations` · `audit_log` · `erasure_requests` · toda la autoría del histórico deportivo
(`events.created_by`, `evaluations.created_by`, `training_attendance.recorded_by`, `sessions`,
`exercises`, `plays`, `lineups`, `match_events`, `development_reports`, …).

## 4 · Casos

| Caso | Qué pasa |
|---|---|
| Único tutor de un hijo, no de otro | Se genera solicitud **solo** del hijo del que es único tutor. Del otro se borra el `player_accounts` y se queda con el tutor restante. N hijos bloqueantes → N solicitudes, una pulsación. |
| También cuerpo técnico | No bloquea. `left_at` en todos sus clubes: deja de ser entrenador. Su material y sus evaluaciones se conservan atribuidos a "Usuario eliminado". |
| `admin_club` / dueño del club | No bloquea (decisión 8). Se avisa al superadmin y se libera `clubs.owner_profile_id`. |
| Jugador adulto (`relation='self'`) | Es "único tutor de sí mismo" → la solicitud es la supresión de su propia ficha. F14-7 ya conserva nombre de pila e histórico. Mismo camino, sin excepciones. |
| Sin ningún jugador vinculado | Sin bloqueo y sin solicitud: **se completa en el acto**. Es el caso que se graba para Apple. |
| Tutor en varios clubes | La solicitud va solo al club del hijo; el corte de acceso es global. |
| Dos tutores se borran a la vez | El primero no bloquea; el segundo ya es único y genera solicitud. Se resuelve con `pg_advisory_xact_lock` por jugador dentro de la transacción. |

## 5 · Máquina de estados

```
                 request_account_deletion()
   [sin solicitud] ─────────────────────────► [pending]
                                                │  │
       cancel_account_deletion()  ◄─────────────┘  │
                                                   │  finalize_account_deletion()
                                                   ▼
                                              [completed]
```

**En t=0, sin depender de nadie**: `left_at` en todas sus memberships activas (el acceso cae por los
helpers ya construidos), se borran push/preferencias/notificaciones, se crean las N solicitudes de
supresión y se fija `deadline_at = now() + 30 días`.

**Mientras tanto**: puede autenticar, pero todas sus memberships están de baja, así que cae en el
dead-end "sin club" que ya existe (web `/onboarding`, nativa estado `none`). Ahí se pinta el estado del
borrado, la fecha límite y el botón **Cancelar**. No se banea en t=0 justamente para que pueda entrar a
cancelar o a consultar.

**Se completa** cuando (a) no quedan solicitudes pendientes — el club aprobó o rechazó — o (b) llega la
fecha límite. Lo que ocurra antes. Un rechazo del club no salva la cuenta: el rechazo es sobre el dato
del menor, no sobre el derecho del titular.

**Cancelar** revierte **exactamente** las memberships que la solicitud tocó
(`affected_membership_ids`), nunca una baja que el club hubiera dado antes por su cuenta.

Y distingue el origen de cada supresión (`erasure_requests.created_by_account_deletion`):

- las que **nacieron** del borrado se retiran (pasan a `cancelled`);
- las que el tutor ya había pedido **por su cuenta** son independientes: siguen pendientes y
  el club las decidirá igual. Solo se les suelta el enlace, para no dejarlas colgando de un
  borrado cancelado.

Ambas cuentan como bloqueantes mientras el borrado está en curso: una supresión pendiente del
único hijo impide completar la cuenta venga de donde venga.

## 6 · Reparto en PRs

| PR | Qué | Migración |
|---|---|---|
| **BC-1** | SQL: modelo + motor + pgTAP | ✅ dos ficheros |
| BC-2 | `packages/core`: lecturas, acciones, mapeo de errores | — |
| BC-3 | Servidor: finalizador con service_role + route handlers | — |
| BC-4 | Web: Perfil + confirmación + pantalla "borrado en curso" | — |
| BC-5 | Nativa: mismo flujo · **deja la app enseñable a Apple** | — |
| BC-6 | Cron de 30 días (`vercel.json` + `CRON_SECRET`) | — |
| BC-7 | Avisos: club, otro tutor, superadmin | — |
| BC-8 | Legal, consola de plataforma, notas de revisión Apple | — |

Orden aprobado: 1 → 2 → 3 → 4 → 5, y después 6 → 7 → 8.

## 7 · Vídeo para Apple

Se graba el caso "sin jugadores bloqueantes", que se completa entero de forma síncrona:
entrar → Perfil → tarjeta **Eliminar mi cuenta** → confirmación explícita → sesión cerrada →
**volver a intentar entrar con las mismas credenciales y que rebote**. Ese último plano es el que
cierra la revisión. Hace falta preparar una cuenta de prueba en ese estado para las notas de revisión.

## 8 · Fuera de alcance (pero con sitio reservado)

La suscripción anual de 3 €/familia llega después. BC-1 deja el hueco
`account_deletion_requests.entitlement_suspended_at` y no lo usa. Cuando se diseñe, hay cuatro cosas
que ya se saben:

1. El flujo de borrado **debe informar de que borrar la cuenta no cancela la suscripción** y remitir a
   Ajustes → Suscripciones (lo exige Apple).
2. El entitlement no puede colgar solo de `profiles`: la tabla debe tener como clave propia el
   identificador de la tienda (`original_transaction_id` / purchase token) con FK a `profiles`
   `NO ACTION`.
3. Al completar el borrado hay que **desvincular** ese identificador, o un "Restaurar compras" con el
   mismo Apple ID resucitaría una cuenta borrada.
4. Los webhooks servidor-a-servidor (renovación, reembolso) van a seguir llegando para cuentas
   borradas: no deben romper ni resucitar nada.
