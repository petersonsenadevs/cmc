# 021 — F3-T3: el agente derivado trabaja en su propio worktree

- **Fecha/hora:** 2026-11-21 02:43
- **Tipo:** feature
- **Mejora a:** 015
- **Tarea:** F3-T3
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- `plugins/cmc/lib/worktree.ts`: nombra el worktree del agente (`cmc-<id>`, rama `worktree-cmc-<id>`), lo localiza, lista lo que el agente cambió y lo liquida al terminar.
- `dispatch()`: en un repositorio git el agente recibe `--worktree cmc-<id>` (lo crea Claude Code, D-017) y se guarda el commit de partida; sin git trabaja en la misma carpeta, sin la opción. `worktree: null` desactiva el aislamiento.
- Al terminar el agente (supervisor) o al cancelarlo, `recordWorktree` anota en su ficha la rama, la ruta y los ficheros cambiados. Sin cambios: se retiran el worktree y la rama. Con cambios, confirmados o no: se conserva.
- Claude Code deja el worktree **bloqueado** («claude session cmc-<id> (pid N)») cuando la sesión termina. Se levanta solo ese bloqueo, y solo si el proceso ya no existe; cualquier otro bloqueo se respeta. Nunca se fuerza un borrado.

## Commits
- `be3811d` feat(dispatch): isolate each dispatched agent in its own git worktree

## Decisiones (resumen; detalle en DECISIONES.md)
- D-027 se levanta el bloqueo que deja la sesión terminada del propio agente (ver DECISIONES.md#dev-021).

## Verificación
```
$ npx tsc --noEmit → exit 0 · npm run lint → 38 modules checked, 0 failed
$ npm test → tests 161 · pass 161 · fail 0   (tres veces seguidas; 15 tests nuevos)

Prueba real (claude -p, modelo haiku) en un repositorio git temporal con notes.txt:
[edits]      dispatched 792d31cd, worktree cmc-792d31cd
             state=finished branch=worktree-cmc-792d31cd changedFiles=["notes.txt"]
             file in the worktree:    "The project codename is HERON.\r\nreviewed by the second agent\r\n"
             file in the main folder: "The project codename is HERON.\n"
[only reads] dispatched 239fbdcd, worktree cmc-239fbdcd
             state=finished branch=null changedFiles=[] worktreePath=null
$ git worktree list
  <repo>                                 [main]
  <repo>/.claude/worktrees/cmc-792d31cd  [worktree-cmc-792d31cd]      (sin «locked»)
```

## Fallos que destaparon las pruebas (corregidos)
1. Los ficheros cambiados se leían mal: la salida de `git status` se recortaba y un nombre con espacios llegaba entre comillas. Ahora se usa la salida separada por NUL (`-z`).
2. En la primera prueba real el worktree limpio no se retiraba: git se negaba por el bloqueo que deja Claude Code. De ahí D-027.
3. Un script de edición escribió un byte nulo literal dentro de `worktree.ts`; el fichero se reescribió y el separador se construye ahora con `String.fromCharCode(0)`.

## Desviaciones
- El worktree lo crea Claude Code, no el plugin (ADR 002); este módulo lo nombra, lo localiza y lo limpia.
- Los worktrees viven en `<repo>/.claude/worktrees/`: en el repositorio del usuario aparece `.claude/` como carpeta sin seguimiento si no la tiene en `.gitignore`. Va al README en F4-T3.
- El worktree del agente salió con finales de línea CRLF (ajuste `autocrlf` de git en esta máquina), no por el plugin.
- Solo probado en Windows.

## Próximos pasos
- F3-T4: paquete de contexto ligero.
