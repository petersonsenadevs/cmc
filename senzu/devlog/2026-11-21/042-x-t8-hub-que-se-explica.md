# 042 — X-T8: el hub se explica solo; versión y repositorio abajo a la derecha

- **Fecha/hora:** 2026-11-21 22:01
- **Tipo:** feature
- **Mejora a:** 036, 040
- **Tarea:** X-T8
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson (captura): «ahora sí pasa, pero necesito que se entienda»; abajo a la derecha, el enlace al repositorio cuando lo creemos y la versión cuando lancemos el primer tag.
- Los modos salen de la vista principal a una pestaña **Settings** (tecla 4): cada modo y cada selector con una línea que dice qué hace.
- Cada vista empieza con una línea de ayuda (qué es y qué se puede hacer) y, salvo Settings, otra con el resumen de los modos («Messages delivered when the turn ends · ;; holds for the agent · subagents get the whole conversation, sonnet…»).
- La actividad reciente bajo cada vista se llama «Latest».
- Abajo a la derecha: la versión y, cuando el manifiesto tenga `repository` (o `homepage`) https, el enlace al repositorio. Se leen de `plugin.json` al arrancar: al crear el repo y lanzar el tag basta con ponerlos en el manifiesto.

## Commits
- `3d8c677` feat(panel): make the hub explain itself, with version and repository

## Verificación
```
$ npm test → ℹ pass 340 · ℹ fail 0   (panel: Settings con ayuda por modo, resumen, versión/repositorio)
$ npx tsc --noEmit → 0 · npm run lint → 0 fallos · claude plugin validate . → ✔ Validation passed
```

## Pendiente
- Crear el repositorio y añadir `repository` a plugin.json; lanzar el primer tag (versión 1.1.0 en F5-T9).
