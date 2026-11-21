# 018 — Decisión corregida: el plugin va en TypeScript

- **Fecha/hora:** 2026-11-21 02:08
- **Tipo:** decisión
- **Mejora a:** 017
- **Tarea:** X-T3
- **Stack:** node (plugin de Claude Code)

## Qué se hizo
- Peterson aclaró que quería TypeScript. La decisión D-022 de la entrada 017 («JavaScript sin TypeScript») salió de leer mal su respuesta; además se selló en las convenciones y se guardó en su memoria como preferencia.
- Corregido: la memoria de hechos dice ahora que quiere TypeScript; D-022 queda sustituida por D-024; tarjeta ad hoc X-T3 en el plan para la migración.
- Comprobado en esta máquina (Node 24.4.1) que Node ejecuta un `.ts` con tipos directamente, sin compilar.
- F3-T3 se detiene antes de escribir código: el módulo del worktree se hará ya en TypeScript.

## Commits
- `ca5c1a7` docs(senzu): replace the no-TypeScript decision, plan the migration

## Decisiones (resumen; detalle en DECISIONES.md)
- D-024 TypeScript ejecutado por Node, sin compilar; sustituye a D-022 (ver DECISIONES.md#dev-018).

## Verificación
```
$ node probe.ts          (fichero con `type Held = …` y funciones tipadas)
ts ok 1
$ node .claude/skills/code-quality/scripts/verify-build.mjs
  PASS  lint
  FAIL  types  (exit 1)     ← lanza tsc y aún no hay TypeScript; lo arregla X-T3
  PASS  test
  SKIP  build
```
- Sin cambios de código en esta entrada.

## Desviaciones
- X-T3 queda bloqueada: las convenciones están selladas con «sin TypeScript» y solo Peterson puede borrarlas.

## Próximos pasos
- Peterson: `rm senzu/conventions.md senzu/conventions.json`.
- X-T3: migración, y `/adoptar` de nuevo.
