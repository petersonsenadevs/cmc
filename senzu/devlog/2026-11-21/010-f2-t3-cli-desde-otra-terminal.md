# 010 — F2-T3: escribir desde otra terminal con la CLI `cmc`

- **Fecha/hora:** 2026-11-21 01:34
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F2-T3
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `lib/sessions.mjs`: registro de sesiones. El hook `SessionStart` guarda `session.json` (id, carpeta, inicio, última actividad) en la carpeta de la sesión y marca el directorio de datos con `cmc.json`; `SessionEnd` la da por cerrada; el hook `Stop` anota la actividad al terminar cada turno.
- La CLI ya no necesita `--session`: busca la sesión abierta que se inició en la carpeta actual o, si no hay, en la carpeta superior más cercana. El directorio de datos lo encuentra sola, recorriendo `~/.claude/plugins/data/*` (o `CLAUDE_CONFIG_DIR`) en busca de la marca.
- Sin sesión abierta en la carpeta: lo dice y no guarda nada. Con varias: las lista y pide `--session <id>` (vale el principio del id).
- Comandos nuevos: `cmc hold <texto>` y `cmc sessions [--all]`.
- `hooks/session-register.mjs` registrado en `SessionStart` y `SessionEnd`.
- README: sección «From another terminal».

## Commits
- `4b30b66` docs(devlog): close F2-T2
- `2b6a4ab` feat(cli): hold and manage messages from another terminal

## Decisiones (resumen; detalle en DECISIONES.md)
- D-013 la CLI localiza el directorio de datos por una marca, sin escribir estado fuera de él (ver DECISIONES.md#dev-010).

## Verificación
```
$ npm test
ℹ tests 104 · pass 104 · fail 0
$ npm run lint
lint: 26 modules checked, 0 failed

$ node scripts/e2e.mjs --cli "hold reply with the word guava" --after "/cmc:release"
  9.4s  CLI        cmc hold reply with the word guava → Held (1 queued).
 21.8s  AGENT      step1, step2, step3
 23.5s  DELIVERED  /cmc:release
 23.5s  AGENT      guava
 27.1s  QUEUE      0 held after the session: []

$ node bin/cmc.mjs sessions --all
Sessions known to cmc:
  6b1ad104  closed  C:\Users\Black\AppData\Local\Temp\cmc-e2e-YpMQri
```
- En la prueba real la CLI se lanza en la carpeta de la sesión sin id ni directorio de datos, como desde una segunda terminal.

## Desviaciones
- «Pide elegir» es un listado con los ids y la indicación de repetir con `--session`, no un selector interactivo: funciona igual en scripts y no bloquea la terminal.
- Una sesión que muere sin `SessionEnd` (terminal cerrada a la fuerza) sigue figurando como abierta; el listado enseña su última actividad para distinguirla. La limpieza por antigüedad va en F2-T5.

## Próximos pasos
- F2-T4: indicador de mensajes retenidos.
