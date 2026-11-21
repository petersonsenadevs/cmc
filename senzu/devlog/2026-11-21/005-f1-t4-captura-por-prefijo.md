# 005 — F1-T4: captura de mensajes con prefijo

- **Fecha/hora:** 2026-11-21 01:42
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F1-T4
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `lib/capture.mjs` (`handlePrompt`): un prompt que empieza por `;;` se guarda en la cola de la sesión y se bloquea con el recibo `Held (n queued). Release with /cmc:release.`; sin prefijo, pasa intacto y no se escribe nada en disco.
- Casos límite: prefijo sin texto (aviso de uso, no guarda), mensaje de más de 20 000 caracteres (se rechaza y se explica), mensajes de varias líneas (se conservan enteros), prefijo configurable.
- `lib/hook-io.mjs` (`runHook`): envoltorio común de los hooks. Ante cualquier error propio no imprime nada y sale con 0, así que el prompt pasa; el error queda en `cmc.log` del directorio de datos (o en stderr si ni eso se puede escribir).
- `lib/log.mjs`: log JSON por líneas. El texto de los mensajes nunca se registra.
- `hooks/prompt-capture.mjs` (adaptador de 3 líneas) registrado en `hooks/hooks.json`.
- `scripts/e2e.mjs`: conduce una sesión real de `claude -p` con el plugin cargado, escribe mensajes a mitad de turno y pinta la línea de tiempo. Gasta tokens: no entra en `npm test`.

## Commits
- `8a35251` docs(devlog): close F1-T3
- `fcfb791` feat(capture): hold prefixed prompts in UserPromptSubmit

## Decisiones (resumen; detalle en DECISIONES.md)
- Ninguna nueva: aplica D-005.

## Verificación
```
$ npm test
ℹ tests 26 · pass 26 · fail 0
$ npm run lint
lint: 12 modules checked, 0 failed
$ node scripts/e2e.mjs --mid ";; HELD-ALPHA please also say pineapple"
  2.6s  TOOL       sleep 5; echo step1
  4.6s  TYPED      ;; HELD-ALPHA please also say pineapple
  8.4s  TOOL-DONE  "step1...
  8.5s  NOTICE     UserPromptSubmit operation blocked by hook: Held (1 queued). Release with /cmc:release. Original prompt: ;; HELD-ALPHA please also say pineapple
 10.0s  TOOL       sleep 5; echo step2
 16.5s  TOOL       sleep 5; echo step3
 23.5s  AGENT      step1, step2, step3
 26.9s  QUEUE      1 held after the session: ["HELD-ALPHA please also say pineapple"]
```
- El agente termina sus tres pasos, su respuesta no menciona el mensaje y este queda en la cola.

## Desviaciones
- Archivos extra: `lib/capture.mjs`, `lib/hook-io.mjs`, `lib/log.mjs` (la lógica vive en el core, el hook es solo adaptador) y `scripts/e2e.mjs`.
- Sesión real en modo headless; la interfaz interactiva, en F1-T6.

## Próximos pasos
- F1-T5: soltar la cola con `/cmc:release` y al terminar el turno.
