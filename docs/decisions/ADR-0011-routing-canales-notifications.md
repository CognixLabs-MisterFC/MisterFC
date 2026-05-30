# ADR-0011 — Routing de canales en `notifications`: eager send + cron drainer

- **Status**: Accepted
- **Date**: 2026-05-30
- **Deciders**: Iker Milla
- **Related**: F5 (Mensajería y push), F4 (Asistencia y cron de recordatorios), [plan-maestro.md §Fase 5](../journey/plan-maestro.md), spec `docs/specs/5.0-mensajeria-push.md`, ADR-0008 (Vercel Cron patrón).

## Context

F4 dejó la tabla `notifications` con `channel ∈ {in_app, push, email}` y un cron diario (`/api/cron/reminders`, `0 8 * * *` UTC) que **escribe** filas pendientes pero **no las envía** por push (solo `in_app` se materializa hoy en una campana hipotética).

F5 añade dos tipos nuevos (`new_message`, `new_announcement`) y necesita decidir **cuándo se efectúa el envío** del push real:

1. **Eager send**: el server action que crea el mensaje/anuncio inserta la fila en `notifications` Y dispara `web-push` en el mismo handler.
2. **Cron-only**: el cron diario drena todas las filas pendientes y las envía. El server action solo escribe.
3. **Cron nuevo dedicado a push**: ejecutar otro cron específico para push, separado del de recordatorios F4.

Las restricciones reales:

- Los mensajes y anuncios **requieren entrega instantánea**. Un mensaje del coach a las 22h que llega al día siguiente a las 9h es ruido — la familia ya respondió por WhatsApp.
- Los push pueden **fallar por endpoint expirado** (browser actualizado, dispositivo borrado, permisos revocados). Sin reintento, se pierde la notificación. Necesitamos una vía de retry.
- Los recordatorios de F4 (`match_callup_reminder`, `attendance_pending_reminder`) son **diarios por naturaleza** (corren en el cron de las 8h UTC). Su envío puede esperar al cron sin pérdida.
- Multiplicar crons aumenta carga operativa (más alarmas, más secretos, más config en `vercel.json`).

## Decision

**Routing híbrido**:

1. **Eager send (instantáneo)** para `new_message` y `new_announcement`:
   - El server action que crea la fila en `notifications` con `channel='push'` también llama a `sendPushToUser(user_id, payload)` en el mismo handler.
   - Si `web-push` devuelve OK → marca la fila `status='sent'` + `sent_at=now()`.
   - Si devuelve 410 Gone → marca `status='failed'` + razón `endpoint_expired` + borra la `push_subscription` afectada.
   - Si devuelve otro error transitorio → fila queda `pending` y será recogida por el cron drainer en el próximo tick.

2. **Cron drainer (respaldo)** — extiende el cron F4 existente:
   - Tras producir los recordatorios diarios (función F4, intacta), añade pasada de drenaje:
     ```sql
     SELECT * FROM notifications
     WHERE status = 'pending'
       AND channel = 'push'
       AND created_at > now() - INTERVAL '7 days'
     LIMIT 200
     ```
   - Para cada fila, intenta `web-push send`. Mismo manejo de errores que eager.
   - Filas que llevan > 7 días pendientes se ignoran (contexto obsoleto).
   - Reintentos máximos: 3 por fila (se guarda contador en `payload.retry_count`). Tras 3 → `status='failed'` permanente.

3. **Eager NO se usa para recordatorios F4**. Los `match_callup_reminder` y `attendance_pending_reminder` siguen siendo producidos por el cron y enviados por el mismo cron en su paso de drenaje. No hay tipo de notificación que necesite eager además de los dos de F5.

## Why not the alternatives

- **Eager-only (sin cron drainer)**: si el push falla porque la subscription caducó o por error transitorio de red entre Vercel y FCM/Mozilla autopush, se pierde la notificación. Sin cron de retry no hay recuperación. **Descartado**.
- **Cron-only (sin eager)**: con cron `0 8 * * *` diario, un mensaje creado a las 22h se entrega 11 horas después. Inservible. Aumentar la frecuencia del cron a cada minuto multiplica invocaciones y carga sin necesidad. **Descartado**.
- **Cron nuevo dedicado a push**: misma cadencia útil que el existente, misma autorización (`CRON_SECRET`), mismo runtime. Multiplica entradas en `vercel.json` y código duplicado por beneficio cero. **Descartado**.
- **Realtime de Supabase para mensajes**: serviría para que el cliente reciba el mensaje en tiempo real sin push, pero solo funciona con la pestaña abierta. No reemplaza push (que es justamente para cuando la app está cerrada). **Descartado** para F5; podría añadirse en Ola 2.

## Consequences

**Positivas**:
- Mensajes y anuncios se entregan **al instante** en el caso feliz (la mayoría).
- Tolerancia a fallos: el cron recupera lo que se quedó atrás.
- Sin nuevo cron, sin nueva tabla, sin nuevo secreto. Reuso máximo de F4.
- Misma autorización (`CRON_SECRET`) → menos superficie operativa.

**Negativas**:
- Server action de `sendMessage`/`createAnnouncement` ahora es más lento (debe esperar al `web-push send` antes de devolver). Mitigación: ejecutar el envío en `setImmediate` o en `after()` de Next.js si el server action se vuelve perceptiblemente lento. F5 mide y decide.
- El cron crece en LOC: dos responsabilidades (producir reminders + drenar push). Encapsulación interna lo mantiene legible.
- Sin métricas finas de "delivered vs displayed" — `status='sent'` significa "Web Push aceptó el envío", no "el user vio el push". Ola 1 acepta esa limitación.

## Operational notes

- El cron drainer corre 1×/día. Si un evento (mensaje fallido) ocurre tras la ventana de 7 días, no se reintenta. Aceptable: contexto del mensaje suele estar ya obsoleto.
- 410 Gone borra la subscription; el user verá `/perfil/notificaciones` desactivado la próxima vez y puede re-activar manualmente.
- `payload.retry_count` se incrementa en cada intento fallido del cron. Sin contar el eager fallido (que se considera intento 0).
