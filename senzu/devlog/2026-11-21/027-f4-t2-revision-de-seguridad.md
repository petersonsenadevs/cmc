# 027 — F4-T2: revisión de seguridad y arreglos

- **Fecha/hora:** 2026-11-21 17:34
- **Tipo:** fix
- **Mejora a:** 015, 021, 022, 024, 025
- **Tarea:** F4-T2
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Revisión con la skill `security`. Pasada a fondo hecha por un subagente de solo lectura (sin las conclusiones del principal); se reanudó tras cerrarse la sesión anterior a mitad.
- Informe: `senzu/seguridad/2026-11-21-revision-cmc.md`. Ningún crítico ni alto; 3 medios y 5 bajos confirmados, 3 sospechas.
- Corregidos los 8 confirmados y 2 de las 3 sospechas, cada uno con test en `test/security.test.ts`:
  - F1: el hook `Stop` ya no puede perder mensajes ante un fallo de disco (limpia el estado antes y saca de la cola al final).
  - F2: el resumen de contexto neutraliza `<`/`>` y saltos de línea de todo lo que cita del transcript; la tarea va antes del resumen.
  - F3: el agente derivado recibe `--tools` (restricción real) además de `--allowedTools`. Nuevo ajuste `dispatch.restrictTools`.
  - F4: los ficheros ignorados por git cuentan como trabajo al liquidar el worktree.
  - F5: `state.json` se cambia bajo el cerrojo de la sesión (`updateStateWith`).
  - F6: un registro activo de antes del último arranque del equipo es `lost` y no se cancela; el `kill` de reserva en POSIX no lanza.
  - F7: se sangra tras cualquier salto de línea, también `\r` y los separadores Unicode.
  - F8: ficheros 0600 y carpetas 0700.
  - S1: un transcript de más de 4 MB se lee por cabeza y cola; S2: las reglas de herramienta no admiten comas.

## Commits
- `0fbef12` fix(security): fix the findings of the security review

## Decisiones (resumen; detalle en DECISIONES.md)
- D-032 el derivado tiene solo las herramientas configuradas (`--tools`), con `dispatch.restrictTools` para quitar la restricción a cambio de coste (ver DECISIONES.md#dev-026).

## Verificación
```
$ npx tsc --noEmit → exit 0 · npm run lint → 48 modules checked, 0 failed
$ npm test → tests 241 · pass 241 · fail 0   (tres veces; 13 tests de seguridad)
$ npm audit --audit-level=high → found 0 vulnerabilities

Prueba real, el derivado intenta usar Bash:
  command: … --permission-mode acceptEdits --tools Read,Glob,Grep,Edit,Write --allowedTools Read,Glob,Grep,Edit,Write …
  summary: NO-BASH-TOOL — Bash is disabled for this session, including in subagents …
Prueba real de worktrees con --ignored: el que edita se conserva (changedFiles ["notes.txt"]); el que solo lee se retira (worktreePath null).
```

## Desviaciones
- **Coste:** con `--tools` el prompt del derivado cambia y el fork no reutiliza la caché de la sesión: una derivación de prueba con haiku pasó de unos 0,003 $ a 0,156 $. Se deja la restricción por defecto (es lo que promete D-002) con el ajuste para quitarla.
- Error propio durante los arreglos: el hook `Stop` leía el estado nuevo en lugar del anterior y no entregaba nada; lo detectaron los tests (22 en rojo) antes del commit.
- El test de concurrencia de F5 no era concurrente (`spawnSync`); se rehízo con procesos en paralelo.
- S3 (carrera al romper un cerrojo caducado) aceptado, con el motivo en el informe.
- F8 y la parte POSIX de F6 no se han ejecutado fuera de Windows.

## Próximos pasos
- F4-T3: README e instalación desde el marketplace en un proyecto limpio.
