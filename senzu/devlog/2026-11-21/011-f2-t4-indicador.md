# 011 — F2-T4: indicador de mensajes retenidos

- **Fecha/hora:** 2026-11-21 01:37
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F2-T4
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `hooks/indicator.mjs`: módulo de hooks del motor de plugins de Claude Code (skill `plugin-authoring`). En `session.start` averigua el directorio de datos (`$.process.hookEnv()`), y cada segundo lee la cola de la sesión (`$.fs.read`) y fija la línea de estado del plugin (`$.ui.status`) a `✉ N held`; con la cola vacía la quita. Solo toca la pantalla cuando el número cambia.
- `hooks/hooks.json` declara el módulo en `modules` junto a los hooks de comando: conviven.
- El módulo no corre en Node (no tiene `node:fs`), así que no importa el core: cuenta líneas del fichero y nada más. Solo lee.
- README (sección «Indicator») y fila B6 en el guion interactivo.

## Commits
- `6a85772` docs(devlog): close F2-T3
- `0134d04` feat(indicator): pin the number of held messages under the prompt

## Decisiones (resumen; detalle en DECISIONES.md)
- D-014 el indicador es un módulo de hooks con `$.ui.status`, no la `statusLine` de `settings.json` (ver DECISIONES.md#dev-011).

## Verificación
```
$ npm test
ℹ tests 109 · pass 109 · fail 0
$ npm run lint
lint: 28 modules checked, 0 failed
$ claude plugin validate .
  ❯ ./indicator.mjs hooks: session.start
  ❯ ./indicator.mjs calls: $.clock.every, $.fs.read (via heldIn), $.process.hookEnv, $.session.id (via heldIn), $.ui.status
✔ Validation passed with warnings

$ claude -p "Reply with the single word ok." --plugin-dir . --debug-file debug.log   (registro de depuración)
hooks module cmc@inline loaded (worker, environment 1, tier user); events: session.start
plugin.register: cmc (user, cmc@inline), judged by core alone: admitted
$.fs.read (cmc): ...\cmc-inline\sessions\099a2e00-...\queue.jsonl failed: ENOENT   (una vez por segundo: cola aún sin crear → 0)
hooks module cmc@inline session.start settled in 152.9ms
```
- Los tests conducen el módulo con un motor de pega: muestra `✉ 1 held`, `✉ 2 held` y lo quita al vaciar; al reanudar con mensajes ya retenidos lo enseña desde el arranque.
- Regresión en sesión real con el módulo cargado: `;; …` + `;;end` siguen entregando (`guava`).

## Desviaciones
- **Falta la captura en pantalla con 0, 1 y 2 mensajes**: la línea de estado solo existe en la interfaz interactiva, que el agente no puede ver. Está comprobado que el módulo carga, lee la ruta correcta y llama a `$.ui.status` con el texto esperado; cómo queda pintado es la fila B6 de `docs/manual-test.md` (tarjeta F1-T6b).
- Los agentes derivados se añadirán al indicador en F3-T5.
- La lectura cada segundo deja una línea en el registro de depuración mientras no existe la cola; no afecta al uso normal.

## Próximos pasos
- F2-T5: conservar la cola tras reiniciar, reanudar o compactar.
