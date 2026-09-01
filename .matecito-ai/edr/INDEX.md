# Development Decision Records — Índice raíz

Las decisiones están organizadas por **dominio**. Este índice te dice qué dominio mirar; el detalle de cada decisión está en el índice de su dominio.

## Cómo usar este índice

1. Identificá qué tipo de tarea estás por hacer.
2. Encontrá el dominio correspondiente abajo y abrí su `INDEX.md`.
3. Leé los EDRs relevantes antes de escribir código.
4. Si hay contradicción entre tu plan y un EDR: pará y preguntale al usuario.

## Dominios de este proyecto

(Solo se listan los dominios que tienen al menos un EDR-archivo.)

| Dominio | Qué agrupa | Índice |
|---|---|---|
| `ci` | Continuous integration workflows and checks | [ci/INDEX.md](ci/INDEX.md) |

**Leyenda de status:** `Accepted` = vigente · `Pending` = decidir más adelante · `Not Applicable` = decidido que no aplica · `Deferred` = postergado con condición.

> Para EDRs `Pending`/`Deferred`, leé la sección "Razón de omisión / aplazamiento" del archivo; para los `Not Applicable`, la razón está en la sección "No aplican" del INDEX del dominio (o "Dominios sin uso" del raíz). **No asumas que la falta de decisión es un olvido** — está documentada.

## Dominios sin uso en este proyecto

(Ninguno registrado todavía.)

## Estado y mantenimiento

- Última actualización: 2026-09-01
- **Actualizar una decisión:** editá el EDR en el lugar, sea cambio menor o de fondo. El historial lo lleva git.
- **Decisión nueva:** creá el EDR en su dominio y sumá la fila al índice de ese dominio (y, si el dominio es nuevo en el proyecto, a este índice raíz).
