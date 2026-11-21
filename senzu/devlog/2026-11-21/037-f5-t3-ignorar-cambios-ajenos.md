# 037 — F5-T3: cambios ajenos en el worktree y envío terminado en la actividad

- **Fecha/hora:** 2026-11-21 21:18
- **Tipo:** fix
- **Mejora a:** 021, 036
- **Tarea:** F5-T3
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Prueba de Peterson (captura): el panel funciona como se diseñó (cabecera, pestañas, modos, subagente da79a8f6 con lo que se le envió, contexto y respuesta, «Send result to main» entregado, actividad).
- Fallo 1: el subagente aparecía con «changed: .corvusmem/, senzu/», que escriben los hooks globales del usuario en su worktree; el worktree se conservaba y el principal perdió tiempo comprobando que no había nada. Nuevo ajuste `dispatch.ignoreChanges` (rutas relativas, carpetas con «/», sin «..» ni absolutas): esos cambios no cuentan como trabajo; si son los únicos, el worktree se retira (con `--force`, solo en ese caso) y la rama se borra si no tiene commits.
- Fallo 2: la actividad se quedaba en «Sending 1 held message(s)…». La interfaz avisa al panel (`onSendSettled`) cuando el envío termina: «Sent 1 message to the agent.» o el motivo del rechazo.

## Commits
- `7641588` feat: ignore other tools' files in worktrees and report finished sends

## Verificación
```
$ npm test → ℹ pass 316 · ℹ fail 0   (worktree real con git: solo ruido → retirado; ruido + trabajo → conservado con solo el trabajo; validación de rutas)
$ npx tsc --noEmit → 0 · npm run lint → 0 fallos · claude plugin validate ./plugins/cmc → ✔
```

## Pendiente
- Peterson: añadir en su config.json `"dispatch": { "ignoreChanges": [".corvusmem/", "senzu/"] }` si esas carpetas las escriben solo sus hooks.
- F5-T6: pasos del subagente en vivo y escribirle.
