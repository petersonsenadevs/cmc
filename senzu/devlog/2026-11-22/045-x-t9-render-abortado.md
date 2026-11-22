# 045 — X-T9: el hub no imprime un error cuando el motor aborta su lectura

- **Fecha/hora:** 2026-11-22
- **Tipo:** fix
- **Mejora a:** 036
- **Tarea:** X-T9
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Contexto: Peterson pidió un artículo en inglés para dev.to con capturas del hub. Al capturar una sesión de demo (`D:\cmc-demo`, ventana propia de Windows Terminal) salió en el chat `cmc: ui.render hook skipped: threw cmc: $.process.run(node) aborted`, con ⚠ junto a `cmc:` en la barra.
- Causa: `agentsOf` (panel) llama a la CLI con `$.process.run`; el motor aborta esa llamada cuando el panel se vuelve a pintar antes de que acabe, el error subía y el render entero se descartaba.
- Arreglo: `agentsOf` guarda la última lista leída y la devuelve si la lectura falla o se aborta; el siguiente refresco la pone al día.
- Test de regresión en `test/panel.test.ts`: con `process.run` lanzando «aborted», el panel sigue pintando el subagente leído antes (falló antes del arreglo con ese mismo error).

## Commits
- ver INDEX / git log: fix(panel): keep drawing when the engine aborts a read

## Verificación
```
$ npm test → ℹ tests 344 · ℹ pass 344 · ℹ fail 0
$ npx tsc --noEmit → 0 · npm run lint → 57 modules checked, 0 failed
Demo real: el módulo se recargó en caliente («cmc: reloaded (5 hooks…)») y el hub siguió pintando.
```

## Lo que vi en la demo (pendiente, no arreglado aquí)
- Con el agente trabajando, `/cmc` queda en cola de Claude Code hasta el final del turno (entonces abre o cierra).
- El aviso de `>>` aún dice «";;list" shows it, "/cmc:release" hands it over» (redacción 1.0).
- La fila de un subagente parte sus datos (modo, modelo, esfuerzo) en una columna estrecha.

## Próximos pasos
- Capturas de la demo (hub con mensajes retenidos, subagente y su chat) y el artículo de dev.to en inglés, firmado r3v3rs3; publicar como borrador solo con aprobación de Peterson.
