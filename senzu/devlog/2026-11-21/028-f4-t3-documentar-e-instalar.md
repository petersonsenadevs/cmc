# 028 — F4-T3: documentación e instalación desde el marketplace

- **Fecha/hora:** 2026-11-21 17:40
- **Tipo:** docs
- **Mejora a:** 016
- **Tarea:** F4-T3
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Licencia MIT (raíz y `plugins/cmc/`), `CHANGELOG.md`, versión 1.0.0 en manifiestos y `package.json`; la validación ya no echa en falta la licencia.
- README repasado: instalación (también en ámbito de proyecto), actualizar y desinstalar (y que desinstalar borra los datos salvo `--keep-data`), dónde queda la CLI `cmc` tras instalar (caché de plugins, con la versión en la ruta), permisos reales del derivado y su coste, ajuste `restrictTools`, y secciones nuevas «Known limits» y «Security».
- `scripts/e2e.ts`: `--project <dir>` (carpeta existente, nunca se borra) y `--installed` (usa el plugin instalado allí en vez de `--plugin-dir`).
- Instalación real en un proyecto git limpio con `--scope project` y guiones pasados; después se desinstaló.

## Commits
- `119fb8d` docs: document install, update, removal, limits and security

## Decisiones (resumen; detalle en DECISIONES.md)
- D-033 licencia MIT, elegida por el agente (Peterson prefiere que se decida y se le diga); se cambia en dos ficheros si prefiere otra (ver DECISIONES.md#dev-027).

## Verificación
```
$ claude plugin marketplace add <repo> --scope project → ✔ Successfully added marketplace: r3v3rs3 (declared in project settings)
$ claude plugin install cmc@r3v3rs3 --scope project → ✔ Successfully installed plugin: cmc@r3v3rs3 (scope: project)
$ claude plugin list → cmc@r3v3rs3 · Version: 1.0.0 · Scope: project · ✔ enabled

Guion de F1-T6 con el plugin instalado (node scripts/e2e.ts --project <proyecto> --installed):
A1  NOTICE Held (1 queued)… → AGENT step1, step2, step3 → QUEUE 1 held
A2  /cmc:release → AGENT mango → QUEUE 0 held
A3  ;;end → DELIVERED Stop hook feedback: [cmc] The user released their held message with ";;end"… → AGENT papaya
Derivación:
  NOTICE Dispatched to agent bd82feec … It works in its own git worktree (branch worktree-cmc-bd82feec). When it ends, its result waits in the queue …
  cmc agents (desde la caché del plugin) → bd82feec finished 1m 05s branch worktree-cmc-bd82feec
  cmc list → 1. … (from agent bd82feec) Agent bd82feec finished the task …
  notes.txt en la carpeta principal: sin cambios · en el worktree: «reviewed by the second agent» añadido
  claude -p "/cmc:release" --resume <sesión> → el principal recibe el informe, lo comprueba y no fusiona nada sin preguntar

$ claude plugin validate . → ✔ Validation passed
$ npm test → 241 pass · npx tsc --noEmit → 0 · npm run lint → 0 fallos
Limpieza: uninstall --scope project y marketplace remove --scope project → ✔; cmc@r3v3rs3 ya no aparece en plugin list.
```

## Desviaciones
- El derivado listó `.corvusmem/` y `senzu/` como cambios: son los hooks globales del usuario, que corren dentro del derivado y escriben en su worktree. Con ellos el worktree nunca queda «limpio». Documentado en el README.
- Sigue sin icono (aviso solo para el directorio público de plugins, fuera de alcance).
- La CLI tras instalar se invoca por la ruta de la caché (cambia con cada versión); el README sugiere un alias. `bin/` solo está en el PATH del agente dentro de Claude Code.

## Próximos pasos
- F1-T6b (Peterson): guion interactivo.
- Fase 5 (adaptadores), cuando Peterson lo decida.
