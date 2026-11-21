# 023 — F3-T5: derivar desde el prompt y ver los agentes

- **Fecha/hora:** 2026-11-21 02:57
- **Tipo:** feature
- **Mejora a:** 015, 021, 022
- **Tarea:** F3-T5
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Prefijo `>>` en el hook `UserPromptSubmit`: `>> tarea` arranca un segundo agente (fork) y `>> --pack tarea` uno con el paquete de contexto (se usa el `transcript_path` que da el hook). El prompt se bloquea con un recibo: id del agente, cómo recibe el contexto, y si trabaja en su worktree o en la misma carpeta.
- Palabras de control nuevas (`lib/agent-control.ts`): `;;agents`, `;;log <id>`, `;;cancel <id>`, `;;dispatch N [--pack]` (deriva un mensaje retenido; sale de la cola solo cuando el agente ha arrancado). Gramática estricta, como las de la cola.
- `lib/agents-view.ts`: recibo, listado (id, estado, duración, dónde trabaja, tarea) y log (pasos recientes o respuesta final).
- CLI: `cmc dispatch [--pack] <tarea>`, `cmc agents`, `cmc log <id>`, `cmc cancel <id>`. Para derivar sin hook, el registro de sesiones guarda ahora la ruta del transcript.
- `/cmc:agents` (sin argumentos, como `/cmc:queue`).
- Indicador: `✉ 2 held · ⚙ 1 agent`. El registro mantiene `agents/active.json` con el número de agentes activos, porque el módulo del motor no puede listar carpetas.
- **Fallo que destapó la prueba real, corregido:** la «respuesta final» guardada era la del último `result`, y los hooks `Stop` del propio usuario (aquí Senzu y Corvusmem) hacían seguir al agente; su respuesta a la tarea quedaba sustituida por la respuesta al hook. Ahora se guarda el texto del agente anterior al primer «Stop hook feedback».

## Commits
- `134a2dd` feat(dispatch): dispatch from the prompt with >> and manage agents

## Decisiones (resumen; detalle en DECISIONES.md)
- D-028 `/cmc:dispatch N` se sustituye por la palabra de control `;;dispatch N` (mismo motivo que D-011) (ver DECISIONES.md#dev-022).

## Verificación
```
$ npx tsc --noEmit → exit 0 · npm run lint → 43 modules checked, 0 failed
$ npm test → tests 192 · pass 192 · fail 0     (tres veces seguidas; 22 tests nuevos)

Sesión real (claude -p con el plugin, modelo haiku), `>>` escrito a mitad del paso 1:
  4.9s  TYPED   >> Without using any tool, reply with the single word heron.
  8.9s  NOTICE  Dispatched to agent df6a6755: it inherits this conversation. ";;agents" shows how it goes. This folder is not a git repository, so the agent works in this same folder, next to the session.
 10.6s  TOOL    sleep 5; echo step2          ← el principal sigue
 23.4s  AGENT   step1, step2, step3
 23.7s  NOTICE  1 dispatched agent: df6a6755 running 15s same folder Without using any tool, reply with the single word heron.
Respuesta del derivado (texto antes del hook Stop del usuario): «heron»

Modo paquete real (`>> --pack …`): el derivado respondió «La primera petición de la otra sesión fue ejecutar con Bash … sleep 5; echo step1 …», correcto, a partir del resumen.
active.json al terminar: {"active":0}
```

## Desviaciones
- La tarjeta pedía `/cmc:dispatch 2`: es `;;dispatch 2` (D-028). `/cmc:agents` sí existe, sin argumentos.
- El agente derivado carga la configuración del usuario: sus otros plugins y hooks corren dentro (en la prueba, los Stop de Senzu y Corvusmem le hicieron una pregunta extra y respondió en castellano). Es lo esperable; el README lo dice.
- Si cmc está instalado para el usuario, el derivado también lo carga: su `SessionStart` lo registra como sesión abierta en la misma carpeta, y mientras corre `cmc hold` desde otra terminal verá dos sesiones y pedirá `--session`. Pendiente: marcar las sesiones de agentes derivados y no ofrecerlas.
- El indicador con agentes no se ha visto en pantalla (fila B6 del guion manual).
- La cancelación en macOS/Linux sigue sin probar.

## Próximos pasos
- F3-T6: devolver el resultado del derivado a la cola.
