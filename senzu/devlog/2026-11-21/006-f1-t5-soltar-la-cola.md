# 006 — F1-T5: soltar la cola con `/cmc:release` y al terminar el turno

- **Fecha/hora:** 2026-11-21 01:21
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F1-T5
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `lib/release.mjs`: `formatRelease` redacta lo liberado (cabecera `[cmc] The user released their held messages with "<acción>":` y lista numerada; las líneas siguientes de un mensaje van sangradas bajo su número), `releaseAll` vacía la cola de la sesión y `handleStop` atiende el hook `Stop`.
- `commands/release.md` → `/cmc:release`: ejecuta `bin/cmc.mjs drain` pasando `${CLAUDE_PLUGIN_DATA}` y `${CLAUDE_SESSION_ID}` como argumentos (D-008), con `disable-model-invocation: true`.
- `bin/cmc.mjs`: CLI con el subcomando `drain` (`--format prompt|json`). Los errores de uso salen con código 1 y un mensaje legible.
- Modo «al terminar»: el prompt de control `;;end` (sin espacio) arma la entrega; el hook `Stop` entrega toda la cola en una sola continuación y se desarma. No hace nada con `stop_hook_active`, con la cola vacía ni si no se pidió. `;; end` con espacio es un mensaje normal.
- `lib/session-state.mjs`: `state.json` por sesión con la marca `releaseAtEnd`.

## Commits
- `f2c5dc3` docs(devlog): close F1-T4
- `65089e8` feat(release): release held messages on demand and at turn end

## Decisiones (resumen; detalle en DECISIONES.md)
- D-010 `;;end` como forma de pedir la entrega al terminar (ver DECISIONES.md#dev-006).

## Verificación
```
$ npm test
ℹ tests 48 · pass 48 · fail 0
$ npm run lint
lint: 18 modules checked, 0 failed

$ node scripts/e2e.mjs --mid ";; also reply with the word pineapple" --mid ";; and then the word mango" --after "/cmc:release"
  8.1s  NOTICE     ... Held (1 queued). Release with /cmc:release. ...
  8.1s  NOTICE     ... Held (2 queued). Release with /cmc:release. ...
 22.0s  AGENT      step1, step2, step3
 22.1s  TYPED      /cmc:release
 23.7s  AGENT      pineapple mango
 27.3s  QUEUE      0 held after the session: []

$ node scripts/e2e.mjs --mid ";; also reply with the word papaya" --mid ";;end"
  8.1s  NOTICE     ... 1 held message(s) will be released when this turn ends. Original prompt: ;;end
 22.5s  AGENT      step1 step2 step3
 22.6s  DELIVERED  Stop hook feedback: [cmc] The user released their held message with ";;end": 1. also reply with the word papaya
 24.0s  AGENT      papaya
 27.5s  QUEUE      0 held after the session: []
```
- En los dos casos el agente termina su tarea sin ver lo retenido y lo recibe al soltar, en el orden en que se escribió.

## Desviaciones
- La tarjeta decía «con el modo "al terminar" activo» sin fijar cómo se activa. El comando no sirve para eso a mitad de turno (ADR 001, hallazgo c), así que se activa con `;;end`, que F2-T2 ya preveía; el valor por defecto configurable sigue en F4-T1.
- Archivos extra: `lib/release.mjs`, `lib/session-state.mjs`.

## Próximos pasos
- F1-T6: cierre de la fase con guion de prueba.
