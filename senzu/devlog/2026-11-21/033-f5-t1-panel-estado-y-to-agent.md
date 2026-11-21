# 033 — F5-T1: el panel dice qué hace Send, responde a cada clic y deriva a un agente

- **Fecha/hora:** 2026-11-21 18:43
- **Tipo:** fix
- **Mejora a:** 032
- **Tarea:** F5-T1
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Prueba de Peterson (captura): el panel se abre y se ve; «el clic en Send no funciona»; faltaba enviar a un subagente para no ensuciar el contexto del principal; pidió colores de marca.
- Diagnóstico con el transcript de su sesión 03ef7068: el envío automático funcionó («di piña peter» entregado al acabar el turno a las 17:38:49 y el agente respondió «piña peter»). El clic en Send llegó con el agente trabajando: solo arma la entrega al final del turno, que con `sendAtEnd` ya iba a ocurrir, y el panel no daba ninguna señal. No era un fallo del código, era falta de respuesta visible.
- El panel dice si el agente trabaja («● Agent working · held messages go to it when its turn ends» / «○ Agent idle · Send hands a message over now») y se repinta también cuando cambia el estado.
- Cada clic responde con un toast: lo que hizo o por qué no pudo.
- Botón **To agent** por fila: `cmc dispatch --message N`, el mensaje sale de la cola cuando el agente arranca y su resultado vuelve a la cola.
- Corregido: el panel buscaba `config.json` en la carpeta de la sesión; está en la raíz del directorio de datos.

## Observación (sin corregir todavía)
- Una entrega armada desde `/send` o el panel con el agente trabajando se anuncia al modelo como «released … with \";;end\"», aunque el usuario no escribió `;;end`. Se corrige al rediseñar los textos (F5-T2/T3).

## Commits
- `b3d0723` feat(panel): show what send does, give feedback and add to agent

## Verificación
```
$ npm test → ℹ pass 295 · ℹ fail 0 · npx tsc --noEmit → 0 · npm run lint → 0 fallos · claude plugin validate ./plugins/cmc → ✔
Derivación real desde la CLI (repo git temporal, haiku):
  cmc hold "Reply with exactly the word: tangerine" → Held (1 queued).
  cmc dispatch --message 1 --pack --held → Held message 1 left the queue. Dispatched to agent 6e3ccfc8 … branch worktree-cmc-6e3ccfc8
  cmc agents → 6e3ccfc8 finished 27s · cmc list → 1. (from agent 6e3ccfc8) Agent 6e3ccfc8 finished the task …
```

## Pendiente
- Prueba de Peterson con el agente parado (Send entrega al momento) y con To agent.
- Colores de marca: falta decidir la marca (pregunta a Peterson) y el design system antes de aplicarlos (F5-T2).
