# 038 — F5-T6: hablar con los subagentes, con la conversación como chat

- **Fecha/hora:** 2026-11-21 21:35
- **Tipo:** feature
- **Mejora a:** 015, 024, 036
- **Tarea:** F5-T6
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: «los mensajes deberían salir con lados de chat, más en orden, y haz la T6».
- **Sesión abierta:** el subagente corre con `--input-format stream-json` y el supervisor mantiene su entrada abierta. Al responder pasa a `waiting` (estado nuevo), su respuesta vuelve a la cola («Subagent X answered …», más corta que el informe final) y la sesión sigue abierta `dispatch.keepOpenMinutes` (10 por defecto, 0–240); después se cierra y se liquida el worktree como antes. Con 0 todo es como antes (un informe al terminar).
- **Conversación:** `agents/<id>/conversation.jsonl`, escrita por el supervisor en el orden en que pasan las cosas: tus mensajes (`you`), sus pasos (`step`: herramienta y objetivo), sus respuestas (`agent`), lo que dice a tus hooks tras su respuesta (`aside`) y avisos (`note`: cierre de sesión y dónde quedan sus cambios).
- **Escribirle:** `tellAgent` → con la sesión abierta, a su bandeja (`inbox.jsonl`), que el supervisor entrega al momento (trabajando, Claude Code se lo da tras el paso en curso); con la sesión cerrada, se reanuda su propia sesión (`--resume <agentSessionId>`, sin fork ni worktree nuevo) en la carpeta donde trabajó. `;;tell <id> <mensaje>`, `cmc tell <id> [--stdin] <mensaje>`.
- **Panel:** al elegir un subagente, su conversación como chat: tus mensajes a la derecha (violeta), los suyos a la izquierda (verde), sus pasos y avisos entre medias, hora en cada burbuja; «● waiting for you»; caja para escribirle; Send result to main; Stop (también esperando).
- El supervisor solo arranca como programa (importarlo en tests ya no marca el proceso como fallido).
- Tests: `test-support/setup.ts` (cargado por `npm test`) pone `CMC_KEEP_OPEN_MS=0` para que los tests que esperan a que un agente termine no esperen 10 minutos; el claude simulado lee stream-json, responde cada mensaje y termina al cerrarse su entrada.

## Commits
- `7a6fa59` feat(agents): talk to subagents in a conversation that stays open

## Verificación
```
$ npm test → ℹ pass 326 · ℹ fail 0   (test/agent-tell.test.ts: 9 con supervisor real; panel: chat y escribir)
$ npx tsc --noEmit → 0 · npm run lint → 56 modules checked, 0 failed · claude plugin validate ./plugins/cmc → ✔
Prueba real (claude, repo git temporal, --pack):
  dispatch "Reply with exactly one word: tangerine" → 8d5e1868 waiting 29s
  cmc tell 8d5e1868 "Now reply with exactly one word: mango" → Sent to agent 8d5e1868.
  conversación: you tangerine… · agent tangerine… · note (tus hooks) · aside … · you mango… · agent mango
  cola: 2 mensajes «Subagent 8d5e1868 answered …» (tangerine, mango)
```

## Pendiente
- Reanudar una sesión cerrada cuyo worktree se retiró puede no encontrar su conversación (Claude Code la guarda por carpeta); se informa como fallo.
- F5-T7 (pasar el resultado de un subagente a otro), F5-T8 (apertura automática), F5-T9 (cierre y documentación).
