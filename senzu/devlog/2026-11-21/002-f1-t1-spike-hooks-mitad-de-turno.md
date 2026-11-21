# 002 — F1-T1: los hooks a mitad de turno, medidos

- **Fecha/hora:** 2026-11-21 01:12
- **Tipo:** decisión
- **Mejora a:** —
- **Tarea:** F1-T1
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- Plugin de prueba en `spike/`: `probe.mjs` registra cada llamada de `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` y `Stop`; `drain.mjs` vacía la cola desde `/cmc-spike:release`.
- `spike/drive.mjs` conduce una sesión headless (`claude -p` con entrada y salida `stream-json`) y escribe un segundo mensaje dos segundos después de empezar la primera herramienta. Ocho ejecuciones.
- ADR `senzu/arquitectura/adr/001-captura-y-liberacion.md` con la evidencia y el diseño fijado.
- Borrador de convenciones en `senzu/conventions.md` (modo entrevista de `/adoptar`), sin sellar: falta el ok de Peterson.

## Resultados
| Pregunta | Respuesta |
|---|---|
| (a) ¿`UserPromptSubmit` salta con un mensaje de mitad de turno? | Sí, al terminar la herramienta en curso |
| (b) ¿Bloquearlo interrumpe al agente? | No: sigue con sus pasos; solo aparece un aviso de tres líneas |
| (c) ¿Un `/comando` escrito a mitad de turno se expande? | Solo al terminar el turno |
| (d) ¿`Stop` con `decision: block` entrega el `reason` y respeta `stop_hook_active`? | Sí |
| (e) ¿El `additionalContext` de `PostToolUse` llega en el mismo turno? | Llega, pero el modelo no lo obedeció |
| (f) extra: `additionalContext` de `UserPromptSubmit` con `;;now` | Funciona con una de las tres redacciones probadas |

## Commits
- `chore: set up senzu, brief and plan for the cmc plugin` y `docs(adr): record mid-turn hook behaviour and capture design` (hashes en la entrada 003, la primera escrita después de crearlos).

## Decisiones (resumen; detalle en DECISIONES.md)
- D-005 captura por prefijo en `UserPromptSubmit`; D-006 `/cmc:release` y fin de turno por `Stop`; D-007 modo «ya» con `;;now`; D-008 datos y sesión como argumentos del comando (ver DECISIONES.md#dev-002).

## Verificación
```
05:16.023 PreToolUse  Bash "sleep 5; echo step1"
05:17.899 DRIVER      send: ;; HELD-ALPHA please also say pineapple
05:21.879 PostToolUse Bash
05:22.051 UserPromptSubmit held=true prompt=";; HELD-ALPHA please also say pineapple"
05:23.328 PreToolUse  Bash "sleep 5; echo step2"
...
05:52.900 UserPromptSubmit prompt="/cmc-spike:release"
05:53.101 drain count=1
05:55.623 DRIVER      result 2: pineapple
```
- `claude plugin validate ./spike` → `✔ Validation passed`.

## Desviaciones
- La tarjeta pedía `spike/hooks.json` y `spike/log-hook.mjs`; quedaron como `spike/hooks/hooks.json`, `probe.mjs`, `drain.mjs` y `drive.mjs`.
- Todo se midió en modo headless. La interfaz interactiva no se ha conducido: el guion manual de F1-T6 repite (a), (b) y (c) en ella.
- S3 refutado para mitad de turno: el comando no se expande hasta que el turno termina.

## Próximos pasos
- F1-T2: esqueleto del plugin.
