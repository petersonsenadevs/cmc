# 031 — X-T6: lo retenido llega solo al acabar el turno

- **Fecha/hora:** 2026-11-21 18:28
- **Tipo:** feature
- **Mejora a:** 006, 029, 030
- **Tarea:** X-T6
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Petición de Peterson tras su prueba: lo retenido debe enviarse al acabar el turno aunque no se haga nada, «porque ya es obvio». Retener pasa a significar «no interrumpas; dáselo al terminar, y mientras puedo cambiarlo, borrarlo o reordenarlo».
- `sendAtEnd` (nuevo ajuste, por defecto `true`): en `Stop`, los mensajes escritos por el usuario que siguen en la cola se entregan con la cabecera «[cmc] The user typed this message while you were working; cmc held it until your turn ended». Los resultados de agentes siguen su modo de retorno. Con `false`, todo como antes.
- `Stop` entrega aunque otro hook Stop esté continuando el turno (`stop_hook_active`): antes esperaba a una parada «limpia» que, con Senzu bloqueando, podía no llegar. No hay bucle: lo entregado sale de la cola.
- Recibos que dicen lo que va a pasar: «goes to the agent when its turn ends · /held to change it» con el agente trabajando; «/held or /send to send it» en reposo.
- `/send` en reposo: en la prueba de Peterson el motor rechazó el prompt («Could not send them now»). Hipótesis: el motor no acepta el prompt de un plugin mientras su comando sigue corriendo. Ahora el comando contesta «Sending…» y el envío sale 300 ms después; si el motor lo rechaza, una línea con su motivo y los mensajes siguen retenidos (D-034).

## Commits
- `e1074c6` feat: send held messages when the turn ends, by default

## Decisiones (resumen; detalle en DECISIONES.md)
- D-035: lo retenido mientras el agente trabaja se entrega solo al acabar su turno (`sendAtEnd`, por defecto). Matiza el diseño original «retenido hasta que lo sueltes» (ADR 001), que queda como `sendAtEnd: false`.
- D-036: `Stop` entrega aunque otro hook Stop esté continuando el turno; sustituye la parte «una sola continuación» de D-006.

## Verificación
```
$ npm test → ℹ pass 282 · ℹ fail 0   (test/send-at-end.test.ts nuevo; tests de liberación manual con sendAtEnd: false)
$ npx tsc --noEmit → 0 · npm run lint → 52 modules checked, 0 failed · claude plugin validate ./plugins/cmc → ✔
$ MSYS_NO_PATHCONV=1 node scripts/e2e.ts --mid ";; also say the word pineapple"
  4.4s  TYPED      ;; also say the word pineapple
  8.2s  NOTICE     Prompt dropped by a hook: cmc: held (1) · goes to the agent when its turn ends · /held to change it
 21.8s  AGENT      step1, step2, step3
 21.9s  DELIVERED  Stop hook feedback: [cmc] The user typed this message while you were working; cmc held it until your turn ended: 1. also say the word pineapple
 23.3s  AGENT      pineapple
 26.9s  QUEUE      0 held after the session: []
```

## Pendiente
- Confirmar `/send` en reposo en el terminal de Peterson (si falla, la línea dirá el motivo del motor).
- Siguiente: panel lateral con la cola y los agentes (petición de Peterson). README a actualizar con todo X-T5/X-T6.
