# 007 — F1-T6: cierre de la fase 1 (retener y soltar)

- **Fecha/hora:** 2026-11-21 02:05
- **Tipo:** docs
- **Mejora a:** —
- **Tarea:** F1-T6
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `README.md` con el uso básico: `;; mensaje`, `/cmc:release`, `;;end` y lo que conviene saber (el aviso de tres líneas es el recibo, el comando a mitad de turno actúa al terminar, dónde se guarda la cola, qué pasa si el plugin falla).
- `docs/manual-test.md`: guion de prueba en dos partes. Parte A, tres escenarios que conduce `scripts/e2e.mjs` contra una sesión real headless. Parte B, cinco comprobaciones en la interfaz interactiva, que solo puede hacer una persona.
- Parte A ejecutada y pasada. La parte B queda en una tarjeta nueva, F1-T6b, a la espera de Peterson.

## Resumen de la fase 1
| Tarea | Resultado |
|---|---|
| F1-T1 | ADR 001: `UserPromptSubmit` se dispara a mitad de turno y bloquear no interrumpe |
| F1-T2 | Esqueleto del plugin, `npm test`, `npm run lint` |
| F1-T3 | Cola por sesión con cerrojo; sin pérdidas ni duplicados con varios procesos |
| F1-T4 | Captura por prefijo `;;`, con fallo abierto |
| F1-T5 | `/cmc:release` y entrega al terminar con `;;end` |

## Commits
- `9e41acb` docs(devlog): close F1-T5
- `be13490` docs: document basic use and the phase 1 test script

## Decisiones (resumen; detalle en DECISIONES.md)
- Ninguna nueva.

## Verificación
Guion, parte A (sesiones reales, `claude -p`, Claude Code 2.1.330, Windows 11):
```
A1  node scripts/e2e.mjs --mid ";; HELD-ALPHA please also say pineapple"
     8.5s  NOTICE  ... Held (1 queued). Release with /cmc:release. ...
    23.5s  AGENT   step1, step2, step3
    26.9s  QUEUE   1 held after the session                                   → pasa

A2  node scripts/e2e.mjs --mid ";; also reply with the word pineapple" --mid ";; and then the word mango" --after "/cmc:release"
    22.0s  AGENT   step1, step2, step3
    23.7s  AGENT   pineapple mango
    27.3s  QUEUE   0 held after the session                                   → pasa

A3  node scripts/e2e.mjs --mid ";; also reply with the word papaya" --mid ";;end"
    22.6s  DELIVERED  Stop hook feedback: [cmc] The user released their held message with ";;end": 1. also reply with the word papaya
    24.0s  AGENT   papaya
    27.5s  QUEUE   0 held after the session                                   → pasa

Extra  node scripts/e2e.mjs --mid ";; also reply with the word mango" --mid "/cmc:release"
     9.5s  NOTICE  ... Held (1 queued) ...
    23.1s  AGENT   step1, step2, step3
    25.3s  DELIVERED  /cmc:release   (el comando esperó al final del turno)
    25.3s  AGENT   mango                                                      → pasa
```
- `npm test` → 48 pass, 0 fail. `npm run lint` → 18 modules checked, 0 failed. `claude plugin validate .` → Validation passed with warnings (los mismos de la entrada 003).

## Desviaciones respecto al ADR 001
- Ninguna en el comportamiento. El ADR preveía repetir (a), (b) y (c) en la interfaz interactiva dentro de esta tarea: no se puede conducir desde el agente, así que pasa a F1-T6b.
- Aviso para la parte B: en modo headless, cada mensaje retenido produce el aviso «UserPromptSubmit operation blocked by hook…»; falta ver cómo lo pinta el terminal y si resulta molesto.

## Próximos pasos
- F1-T6b (Peterson): parte B del guion, unos cinco minutos.
- F2-T1: gestionar la cola (ver, editar, borrar y reordenar).
