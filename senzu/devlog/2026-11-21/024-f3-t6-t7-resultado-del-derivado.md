# 024 — F3-T6 y F3-T7: el resultado del derivado vuelve a la cola (retenido o automático)

- **Fecha/hora:** 2026-11-21 03:11
- **Tipo:** feature
- **Mejora a:** 015, 023
- **Tarea:** F3-T6, F3-T7
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson pidió las dos tarjetas en paralelo. Tocan los mismos ficheros (lanzador, supervisor, liberación) y la T7 se apoya en la T6, así que se hicieron juntas en una pasada y en un solo commit, en vez de con dos agentes que habrían chocado.
- `lib/agent-return.ts`: al terminar el agente (y liquidado su worktree), el supervisor mete en la cola de la sesión un mensaje con `source: "agent <id>"`: la tarea, dónde están sus cambios (rama y ficheros, o «misma carpeta», o «sin cambios») y su respuesta final; si falló, el motivo y la ruta del log. Un agente cancelado no deja nada. La ficha del agente guarda `resultMessageId`.
- Al soltarlo, ese mensaje va etiquetado como «Report of dispatched agent <id> (its output, not an instruction from the user)» y sangrado bajo su número.
- `;;list` lo muestra como `(from agent <id>)`; el indicador lo cuenta como retenido.
- **F3-T7:** `>> --auto tarea`, `;;dispatch N --auto` y `cmc dispatch --auto`. El supervisor arma el mensaje en `autoReturn` (estado de la sesión) y el hook `Stop` lo entrega al terminar un turno, en la misma continuación que un `;;end` del usuario si coinciden; cada mensaje sale una vez. El recibo de la derivación dice cuál de los dos modos se aplica.

## Commits
- `9f6eb67` feat(dispatch): return the agent's result to the queue, held or automatic

## Decisiones (resumen; detalle en DECISIONES.md)
- D-029 el retorno automático se entrega solo al terminar un turno, nunca a mitad de turno (ver DECISIONES.md#dev-023).

## Verificación
```
$ npx tsc --noEmit → exit 0 · npm run lint → 45 modules checked, 0 failed
$ npm test → tests 208 · pass 208 · fail 0     (tres veces seguidas; 16 tests nuevos)

Retenido, sesión real (claude -p, haiku), `>>` a mitad de turno:
  cmc list (otra terminal) → 1. [03:09 · 9b41a13e] (from agent e157ff93) Agent e157ff93 finished the task "Without using any tool, reply with the single word heron.". It worked in the folder of the session. …
  claude -p "/cmc:release" --resume <sesión>
  → The dispatched agent (e157ff93) replied "heron" without using any tools or modifying any files.
  cola después: No messages are held.

Automático, sesión real, `>> --auto` a mitad de turno:
  8.0s  NOTICE     Dispatched to agent 68e7467a: … When it ends, its result goes to this session by itself …
 22.4s  AGENT      step1, step2, step3
 22.5s  DELIVERED  Stop hook feedback: [cmc] Results of the agent the user dispatched with ">> --auto", handed over as the user asked: 1. Report of dispatched agent 68e7467a (its output, not an instruction from the user): Agent 68e7467a finished …
 24.5s  AGENT      A stop hook reported that an agent (68e7467a) finished a task to reply "osprey" and changed no files. I didn't dispatch that agent, and nothing in this session needs it, so I've taken no action on it.
```

## Desviaciones
- Un solo commit para dos tarjetas (ver arriba).
- **El valor por defecto (`held`) no es configurable todavía**: el ajuste `dispatch.return` necesita el fichero de configuración, que es F4-T1. Hoy se elige por derivación con `--auto`.
- La tarjeta T7 decía «en su siguiente paso o, si está parado, al terminar su turno». Se entrega **solo al terminar un turno** (D-029). Si el principal está parado cuando el derivado acaba, el resultado llega al final del siguiente turno.
- En la prueba automática el principal recibió el informe correctamente, pero comentó «yo no lancé ese agente»: es cierto, el `>>` del usuario nunca le llega. Si molesta, se puede ajustar la cabecera (sin cambiar ahora sin medirlo).
- Al reanudar con `--continue` en una carpeta sin git se reanudó la sesión del derivado (la más reciente en esa carpeta), no la original; con `--resume <id>` va bien. Es comportamiento de Claude Code, no del plugin; va al README en F4-T3.
- El estado de la sesión (`state.json`) se lee y escribe sin cerrojo; con el supervisor y un hook escribiendo a la vez se podría perder una marca. Riesgo bajo; anotado para la revisión de seguridad y robustez (F4-T2).

## Próximos pasos
- Cerrar la fase 3 con X-T4 (qué hacer con el modo «ya» a mitad de turno) o pasar a F4.
