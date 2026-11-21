# 017 — /adoptar: convenciones del proyecto

- **Fecha/hora:** 2026-11-21 02:05
- **Tipo:** decisión
- **Mejora a:** 002
- **Tarea:** —
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `/adoptar` en modo evidencia sobre el código real (37 módulos, 32 commits): el borrador de la entrada 002 pasa a propuesta con ejemplos del código y cinco reglas ejecutables, comprobadas contra el código actual (0 coincidencias).
- Peterson resolvió las dos decisiones abiertas: el lenguaje se queda en JavaScript sobre Node, y los adaptadores para otros agentes van después de terminar Claude Code.
- `senzu/conventions.json` creado con el sello y las cinco reglas.
- Fase F5 (adaptadores) añadida al plan, sin tarjetas todavía.

## Commits
- `84ce676` docs(senzu): seal the executable conventions and add phase 5

## Decisiones (resumen; detalle en DECISIONES.md)
- D-022 JavaScript sobre Node, sin TypeScript; D-023 primero Claude Code, adaptadores después (ver DECISIONES.md#dev-017).

## Verificación
- Las cinco reglas compilan como expresiones regulares y no encuentran nada en `plugins/`, `test/`, `test-support/` ni `scripts/`.
- `npm test` → 146 pass, 0 fail (sin cambios de código en esta entrada).

## Desviaciones
- **El sellado quedó a medias por un error de orden del agente.** Se escribió primero `conventions.json` (ya con el sello) y, a partir de ahí, el muro de Senzu impide al agente tocar cualquiera de los dos archivos. `senzu/conventions.md` sigue con el texto de la propuesta (sin la cabecera de sello y con la sección «Pendiente de decidir»). El texto sellado correcto está generado fuera del repositorio y lo tiene que copiar Peterson.
- El «types» de `verify-build` sigue en rojo: Senzu se instaló con el stack `node-api`, que lanza `tsc`, y la decisión es no usar TypeScript. Se arregla reinstalando Senzu con los comandos reales.

## Próximos pasos
- Peterson: copiar el `conventions.md` sellado.
- F3-T3: worktree del agente derivado.
