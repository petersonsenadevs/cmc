# 034 — F5-T1: Send entrega en el momento (canal nativo del motor) y subagente con contexto

- **Fecha/hora:** 2026-11-21 20:45
- **Tipo:** feature
- **Mejora a:** 025, 033
- **Tarea:** F5-T1
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: «cuando se pulse Send debería enviarse de inmediato, sin importar nada», y Send to subagent con contexto.
- Investigación en los tipos del motor: `$.prompt.submit` de un plugin espera a que la sesión esté parada (`wait: false`); el canal que entra en un turno en marcha es el de mensajes entre sesiones (`$.session.send`, el del SendMessage de los compañeros), que «delivered into a running turn».
- Sonda real (sin interfaz): `$.session.send` a la propia sesión → `isDelivered: false`, «no live session on this machine has id …»: una sesión `claude -p` no es «viva». La interactiva de Peterson debería serlo; está por confirmar en su terminal.
- `send --now` (CLI) y `sendMessages(..., { tryNow })`: con el agente trabajando devuelve el texto y los ids sin armar nada. La interfaz lo entrega con `$.session.send`; si el motor confirma la entrega, `take <ids>`; si no, `send` normal (al acabar el turno) y el aviso dice el motivo. Nada se pierde (D-034).
- Texto para el modelo: «[cmc] The user sends you their held message now, while you work (with "/send")».
- `release --now` sigue rechazado (`release` siempre espera al final del turno).
- Botón «To subagent»; el aviso dice el contexto que recibe: la conversación entera (`fork`, por defecto) o un resumen (`pack`).
- Arreglo en los tests del panel: un paso anterior (p54) no aplicó sus cambios al test sin avisar; añadidos ahora.

## Commits
- `bf05994` feat: send into the running turn through the engine's own channel

## Decisiones
- D-037: Send explícito con el agente trabajando entra en el turno por el canal nativo del motor (`$.session.send` a la propia sesión); si no se entrega, al final del turno. Matiza D-030, que sigue valiendo para todo lo automático y para `additionalContext`.

## Verificación
```
$ npm test → ℹ pass 297 · ℹ fail 0 · npx tsc --noEmit → 0 · npm run lint → 0 fallos · claude plugin validate ./plugins/cmc → ✔
Sonda real (claude -p): $.session.send a sí misma → {"isDelivered":false,"reason":"no live session on this machine has id …"}
```

## Pendiente
- Confirmar en el terminal interactivo de Peterson que Send con el agente trabajando entrega en el momento y que el modelo lo atiende.
- Para escribir a subagentes en marcha (F5-T6): los derivados son `claude -p` y no son sesiones vivas; vía prevista: entrada `stream-json` por stdin del supervisor (lo que hace `scripts/e2e.ts` al escribir a mitad de turno).
