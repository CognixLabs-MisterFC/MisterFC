# ADR-0009 — F6 y F7 separadas pero comparten `<MatchFieldEditor>`

- **Status**: Accepted
- **Date**: 2026-05-29
- **Deciders**: Iker Milla
- **Related**: F6 (Alineaciones y planificación del partido), F7 (Toma de datos en directo del partido), [plan-maestro.md §Fase 6](../journey/plan-maestro.md), specs 6.3 / 6.7 / 6.8 / 6.9.

## Context

El plan original separaba F6 ("Editor de alineaciones") y F7 ("Toma de datos en directo") como fases distintas. Ambas necesitan, sin embargo, un mismo artefacto visual: un campo de fútbol SVG con jugadores como chips, drag&drop para colocarlos en posiciones y feedback visual de selección/hover. F6 lo usa para planificar la alineación; F7 lo usa como lienzo sobre el que arrastrar eventos (gol, tarjeta, falta) hacia los jugadores o sobre el césped.

Hay tres caminos posibles:

1. **Mezclarlas en una fase única**. Construir F6 + F7 en un solo lote para que el componente nazca con las dos necesidades en mente.
2. **Duplicarlas**. Que F6 tenga su editor de campo y F7 tenga el suyo, evolutivos independientes.
3. **Separarlas pero compartir el componente**. F6 entrega un `<MatchFieldEditor>` reutilizable; F7 lo monta y le superpone su capa de cronómetro/timeline/eventos.

Restricciones que pesan en la decisión:

- F6 y F7 tienen **contextos operativos opuestos**: F6 es planificación calma (en casa antes del partido, varios minutos por decisión); F7 es operación en directo (banda del campo, tablet apaisada, gestos rápidos, sin segunda oportunidad). Una sesión y otra demandan UX diferente sobre el mismo lienzo.
- El riesgo técnico de F7 (drag&drop táctil sobre iPad, performance del SVG con muchos eventos, edición de timeline) es **medio-alto**; el de F6 es **bajo-medio**. Mezclarlas en una fase difumina el riesgo y dificulta lotear la entrega.
- Cada fase necesita su propio **deliverable verificable** para el primer club piloto: F6 entrega una alineación reusable; F7 entrega registro completo del partido. Si se construyen juntas, ninguna se entrega sola.

## Decision

Mantener F6 y F7 como **fases separadas y secuenciales**, con F6 entregando explícitamente el componente `<MatchFieldEditor>` como **fundación reutilizable**. F7 reusa el componente sin tener que rehacerlo, y añade encima su capa propia (cronómetro, paleta de eventos, timeline editable).

API del componente diseñada en F6 con F7 ya en mente:

- Props para overlays externos (hijos absolutos posicionables sobre el campo).
- Eventos `onPlayerHover`, `onPlayerClick`, `onFieldClick(x, y)` expuestos.
- Sin lógica de "eventos de partido" dentro — el componente solo conoce jugadores y posiciones.
- Soporte para modo "lineup edit" (drag&drop interno) y modo "live overlay" (drag&drop desde fuera + cursor de coordenadas).

F6 NO es de un solo uso. Su subfase 6.3 ("Editor visual con drag & drop") es donde nace el componente, y las subfases 6.6 a 6.9 (importar convocatoria, banquillo, cambios programados, notas tácticas) lo enriquecen alrededor sin romper la API que F7 consumirá.

## Consequences

**Positivas**:

- Cada fase entrega un deliverable independiente y verificable con el primer club piloto. Si F7 se retrasa por riesgo táctil/performance, F6 ya está en producción y el coach al menos planifica.
- Los riesgos quedan aislados. La complejidad de F7 (timeline, edición de eventos, cronómetro) no contamina F6.
- Los contextos operativos opuestos (calma vs. directo) se diseñan con su propia capa, sin compromisos que perjudiquen a ambos.
- El componente compartido evita la duplicación que tendría la opción 2; un solo lugar concentra el bug-fix y la mejora visual del campo SVG.

**Negativas**:

- F6 paga el coste de pensar en F7 al diseñar la API del componente (props, eventos), aunque F7 todavía no exista. Si la API se queda corta, F7 obliga a un pequeño refactor (estimado <2 h, asumido).
- F7 no puede saltarse F6 — la dependencia es dura. Si por alguna razón el orden cambia, hay que rehacer planificación.

**Neutras**:

- El número de subfases de F6 aumenta de 5 a 9 (+30 min a +5 h adicionales). Está reflejado en `plan-maestro.md` §Fase 6 y §5 (Resumen de estimaciones).
- La fundación reutilizable abre puerta a la **Pizarra táctica (F13)** que probablemente reusará una variante del mismo componente. No se compromete aquí; queda como bonus.
