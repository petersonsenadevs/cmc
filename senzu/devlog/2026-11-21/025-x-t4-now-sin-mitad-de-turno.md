# 025 — X-T4: el modo «ya» deja de entregar a mitad de turno

- **Fecha/hora:** 2026-11-21 03:18
- **Tipo:** fix
- **Mejora a:** 009, 020
- **Tarea:** X-T4
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson dejó la decisión en manos del agente («haz lo que veas con now»). Aclaró además que el modo «ya» nunca lo pidió él: lo introdujo el agente en el brief.
- Elegida la salida (b) de la tarjeta: **nada se entrega a mitad de turno**.
  - `;;now` con el agente parado: igual que antes, el prompt pasa con los mensajes y abre un turno.
  - `;;now` con el agente trabajando: arma la entrega al final del turno, como `;;end`, y lo dice («The agent is working: N held message(s) will be released when this turn ends.»).
  - `cmc release [N…]`: siempre al final del turno. Fuera `--now` y `--end`.
  - Fuera el hook `PostToolUse` (`tool-release`): un proceso de Node menos en cada herramienta del agente.
- Para saber si el agente está trabajando, el estado de la sesión guarda `turnActive`: se activa cuando un prompt llega al agente (o pasa un `;;now`) y lo apaga el hook `Stop`, salvo cuando cmc mismo continúa el turno.

## Commits
- `fd7cbbf` fix(release): never hand messages over in the middle of a turn

## Decisiones (resumen; detalle en DECISIONES.md)
- D-030 sin entregas a mitad de turno; sustituye a D-007 (en su parte de mitad de turno) y a D-012 (ver DECISIONES.md#dev-024).

## Verificación
```
$ npx tsc --noEmit → exit 0 · npm run lint → 45 modules checked, 0 failed
$ npm test → tests 211 · pass 211 · fail 0   (tres veces seguidas)

Sesiones reales (claude -p, haiku):
;;now 2 con el agente ocupado, 3 ejecuciones:
  NOTICE     The agent is working: 1 held message(s) will be released when this turn ends. Original prompt: ;;now 2
  DELIVERED  Stop hook feedback: [cmc] The user released their held message with ";;end": 1. reply with the word mango
  AGENT      mango                         (3 de 3; el otro mensaje sigue retenido)
cmc release con el agente ocupado, 3 ejecuciones:
  CLI        cmc release → 1 held message(s) will be released when the agent's turn ends.
  AGENT      guava                         (3 de 3)
;;now con el agente parado:
  DELIVERED  ;;now
  AGENT      lychee                        (1 de 1)
Antes del cambio (entrada 020): 5 de 12 obedecidas.
```

## Desviaciones
- Cambia un contrato que tenía test: un prompt normal ya no deja el disco intacto; escribe `state.json` con `turnActive`. El test se actualizó a propósito.
- La cabecera de lo entregado dice `with ";;end"` aunque el usuario escribiera `;;now` o usara la CLI: impreciso pero inofensivo; se deja.
- Si el usuario interrumpe al agente (Esc), `Stop` no se ejecuta y cmc sigue creyendo que trabaja: `;;now` espera al final del siguiente turno. `/cmc:release` sirve en ese caso; lo dice el README.

## Próximos pasos
- F4-T1: configuración.
