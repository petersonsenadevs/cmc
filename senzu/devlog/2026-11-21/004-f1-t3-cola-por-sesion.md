# 004 — F1-T3: cola por sesión en el core

- **Fecha/hora:** 2026-11-21 01:16
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F1-T3
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `lib/queue.mjs`: `addMessage`, `listMessages` y `drainMessages` (todos o por id) sobre `queue.jsonl` en la carpeta de la sesión.
- Cada operación corre bajo un cerrojo (`queue.lock`, un directorio creado con `mkdir`, que es atómico) y reescribe el fichero con temporal + renombrado. Un cerrojo de más de 10 s se considera de un proceso muerto y se retira.
- Fichero dañado: se conservan los mensajes legibles, el original se aparta como `queue.corrupt-<marca>.jsonl` y la operación devuelve un `warning`.
- `lib/paths.mjs`: directorio de datos (argumento explícito o `CLAUDE_PLUGIN_DATA`) y carpeta de sesión; el id de sesión se valida antes de usarlo como nombre de carpeta.
- `lib/errors.mjs`: `CmcError` con código estable y mensaje apto para el usuario.

## Commits
- `31a1670` docs(devlog): close F1-T2
- `0ac8c05` feat(queue): add per-session held-message queue

## Decisiones (resumen; detalle en DECISIONES.md)
- D-009 cerrojo por directorio en vez de «renombrar y leer» (ver DECISIONES.md#dev-004).

## Verificación
```
$ npm test
ℹ tests 13 · pass 13 · fail 0
  ✔ never hands a message to two drainers running at the same time (1935.6546ms)
$ npm run lint
lint: 7 modules checked, 0 failed
```
- El test de concurrencia lanza 2 procesos que añaden 60 mensajes cada uno y 3 que vacían a la vez: los 120 se entregan una sola vez. Repetido tres veces seguidas, en verde.

## Desviaciones
- Archivos extra: `lib/errors.mjs` y `test-support/queue-worker.mjs`. El ayudante vive fuera de `test/` porque `node --test` ejecuta como test todo `.mjs` que haya dentro.
- Los tests de `paths` van en `test/queue.test.mjs`.

## Próximos pasos
- F1-T4: capturar los mensajes con prefijo en `UserPromptSubmit`.
