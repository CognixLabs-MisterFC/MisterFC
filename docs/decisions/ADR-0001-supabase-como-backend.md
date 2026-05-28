# ADR-0001 — Supabase Free como backend de Ola 1

- **Status**: Accepted
- **Date**: 2026-05-27
- **Deciders**: Iker Milla
- **Related**: ADR-0000 (stack técnico), ADR-0002 (modelo de roles), ADR-0004 (método de autenticación)

> **Nota (2026-05-28)**: este ADR menciona "magic link" como método de auth en la sección de Decision (era el método de Fase 1). El método concreto de autenticación pasa a estar gobernado por **ADR-0004 — Email + contraseña como método de autenticación**, que documenta el cambio y sus motivos. El resto de decisiones de este ADR (Postgres + RLS + Storage + Edge Functions vía Supabase Free) sigue vigente sin cambios.

## Context

Ola 1 necesita Postgres relacional con RLS granular (jerarquía club → categoría → equipo → jugador + roles + capabilities configurables), auth con magic link, almacenamiento de adjuntos (fotos de jugador, planificaciones PDF, recursos de biblioteca de ejercicios), y posiblemente funciones server-side para reportes mensuales y push notifications.

La beta cerrada arranca con **un solo club**. Se necesita que el backend sea gratuito hasta validar producto. Cuando el primer club confirme uso continuado, el coste de Supabase Pro ($25/mes) es asumible.

## Decision

Usar **Supabase Free** como backend único de Ola 1:

- Postgres gestionado (500 MB DB en el free tier, suficiente para 1 club piloto).
- Auth nativo con magic link (sin Resend ni emails transaccionales propios).
- Storage para adjuntos (1 GB free).
- Edge Functions para tareas que requieran lógica server-side (push notifications, generación de PDF cuando aplique).
- RLS estricta desde Fase 1 — toda tabla con datos sensibles tiene política activa + tests pgTAP.
- Tipos `Database` generados con `supabase gen types typescript --linked` y commiteados en `packages/core/src/supabase/database.ts`.

El cliente Supabase vive **solo** en `packages/core/src/supabase/`. `apps/web` (y `apps/native` en Ola 2) consume desde ahí, nunca instancia el cliente por su cuenta.

## Consequences

**Positivas**

- Cero coste de backend durante validación de Ola 1.
- Auth, Storage, Postgres, Edge en un único panel — operación simple.
- RLS estricta da seguridad real sin construir middleware de autorización custom.
- `packages/core` ya tiene el cliente — Ola 2 (RN) lo reusa sin tocar nada.

**Negativas**

- **Limitaciones del free tier**: 1 proyecto activo, 500 MB DB, 1 GB Storage, pausado tras 7 días de inactividad. Mitigación: pin del proyecto + alertas de uso, y plan de upgrade a Pro cuando el primer club firme.
- **Vendor lock-in moderado**: aunque es Postgres estándar, RLS policies, Edge Functions y Storage son específicos. Mitigación: la lógica está en `packages/core` y el SQL en migraciones versionadas — un eventual swap a Postgres self-hosted + servicio de auth alterno es viable pero costoso (estimación: 1–2 semanas).
- **Sin staging separado en free tier** (un solo proyecto activo). Mitigación: Fase 1 trabaja directo en el proyecto único; cuando se promueva a Pro, se crea un proyecto Staging y se introduce el flujo dev → staging → prod.

**Neutras**

- El magic link nativo de Supabase obliga a usar su UI o construir la nuestra contra su endpoint. Construimos la nuestra (componente shadcn-styled) ya en Fase 1.

## Alternatives considered

- **Firebase (Auth + Firestore + Functions + Storage)**: ecosistema maduro, pero Firestore no es relacional y RLS es expresiva pero distinta. Para nuestro modelo (jerarquía club → categoría → equipo → jugador con permisos configurables del staff técnico) el SQL + RLS de Supabase es más natural y permite queries complejas (dashboard ejecutivo, evolución multi-temporada) sin contorsiones. Descartado.
- **Postgres self-hosted + Lucia/Auth.js + S3-compatible storage**: control total pero operativamente costoso (backups, monitoring, scaling) para un single-dev. Descartado para Ola 1; reevaluable en Ola 3 si la escala lo justifica.
- **PlanetScale / Neon + Clerk + Cloudinary**: stack “best-of-breed”, pero múltiples vendors y suscripciones que pagar incluso en free tiers. Descartado por simplicidad operativa.

## Plan de migración a Pro

Disparadores para upgrade a Supabase Pro ($25/mes):

1. Primer club firma uso continuado.
2. DB supera 350 MB (70 % del free tier) o se detecta riesgo de pausa por inactividad.
3. Se necesita Point-in-Time Recovery para datos críticos.
4. Se crea proyecto Staging separado para promociones controladas a producción.
