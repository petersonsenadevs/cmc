# 043 — F5-T8 y F5-T5: el hub se abre solo y nueva tarea desde Subagents

- **Fecha/hora:** 2026-11-21 22:10
- **Tipo:** feature
- **Mejora a:** 036, 042
- **Tarea:** F5-T8, F5-T5 (y F5-T7 fuera de alcance)
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: «hagamos la T8 y la T5 y acabemos con la T9 para subirlo y publicarlo». La T7 (pasar el resultado de un subagente a otro) queda fuera: aporta poco frente a escribir al subagente o pasar su resultado al principal (recomendación aceptada al no incluirla).
- **T8:** ajuste `panelAutoOpen` (por defecto `true`, en Settings como «Open the hub: Automatically / Only with /cmc»): el hub se abre solo cuando se retiene un mensaje más o arranca un subagente, si no está abierto ya (`$.ui.panes()`). `/cmc` lo abre o lo cierra (`$.ui.close`).
- **Carrera corregida:** al parar un subagente en espera, su supervisor podía estar guardando una respuesta y dejar el registro en `waiting` después de marcarlo `cancelled` (lo destapó un test de agent-tell que falló una de cada pocas veces). Ahora, muertos sus procesos, se vuelve a marcar `cancelled`.
- **T5:** la vista Subagents empieza con la caja «New subagent task» (`Start`), que dice con qué contexto, modelo y esfuerzo arrancará («Change it in Settings»). La vista Messages pierde el botón «Send what I typed to a subagent», que ahora tiene su sitio.

## Commits
- `6f858eb` feat(panel): open the hub by itself, and toggle it with /cmc
- `75a8189` feat(panel): start a subagent task from the subagents view

## Verificación
```
$ npm test (tres veces seguidas tras el arreglo de la carrera) → ℹ pass 342 · ℹ fail 0 (×3)
$ npm test → ℹ pass 343 · ℹ fail 0 · npx tsc --noEmit → 0 · npm run lint → 0 fallos · claude plugin validate . → ✔
```
