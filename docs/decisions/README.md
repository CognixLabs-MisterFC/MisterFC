# ADRs — Architecture Decision Records

Decisiones técnicas con impacto significativo en la arquitectura, el stack o las restricciones del producto.

## Reglas

- **Inmutables**: una vez mergeado un ADR a `main`, su contenido no se modifica.
- **Supersede**: si una decisión cambia, crear un ADR nuevo (`ADR-NNNN`) con `Status: Accepted, supersedes ADR-XXXX` y actualizar el ADR original a `Status: Superseded by ADR-NNNN`.
- **Numeración secuencial**: `ADR-0000`, `ADR-0001`, etc.
- **No se borran**: incluso los superseded son histórico valioso.

## Cómo crear un ADR

1. Copia `_template.md` a `ADR-NNNN-titulo-kebab-case.md`.
2. Rellena Status, Context, Decision, Consequences, Alternatives considered.
3. Commit en una rama con prefijo `docs:` y PR como cualquier otro cambio.

## Índice

| ADR  | Título                                          | Status   |
| ---- | ----------------------------------------------- | -------- |
| 0000 | Stack técnico                                   | Accepted |
| 0001 | Supabase como backend                           | Accepted |
| 0002 | Modelo de roles y capabilities                  | Accepted |
| 0003 | Monorepo y Ola 2 RN                             | Accepted |
| 0004 | Email + contraseña como método de autenticación | Accepted |
| 0005 | Estrategia de recurrencia en eventos            | Accepted |
| 0006 | Componente de calendario propio                 | Accepted |
| 0014 | `club_settings`: configuración por club en tabla dedicada | Accepted |
| 0015 | F8: descope de entrenamientos y valoración colectiva (Opción B) | Accepted |
| 0016 | Librería de gráficos del cliente: recharts | Accepted |
| 0017 | Temporada en el equipo; categoría como plantilla permanente | Accepted |
