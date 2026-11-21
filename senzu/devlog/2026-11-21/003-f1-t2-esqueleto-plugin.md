# 003 — F1-T2: esqueleto del plugin

- **Fecha/hora:** 2026-11-21 01:20
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F1-T2
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `.claude-plugin/plugin.json` (nombre `cmc`, versión 0.1.0, autoría), `hooks/hooks.json` vacío, `package.json` con `"type": "module"`, `npm test` (`node --test`) y `npm run lint`.
- `scripts/lint.mjs`: `node --check` sobre cada `.mjs`. Sustituye a ESLint y a `tsc`, que no aplican: el proyecto no tiene dependencias ni TypeScript.
- `test/smoke.test.mjs`: el manifiesto se puede leer y cada hook registrado apunta a un fichero que existe.
- `README.md` inicial y `.gitattributes` (finales de línea LF).

## Commits
- `168f66b` chore: set up senzu, brief and plan for the cmc plugin
- `7bfbaf3` docs(adr): record mid-turn hook behaviour and capture design
- `2c09371` feat(plugin): add cmc plugin skeleton

## Decisiones (resumen; detalle en DECISIONES.md)
- Ninguna nueva.

## Verificación
```
$ npm test
✔ plugin skeleton (2.0516ms)
ℹ tests 2 · pass 2 · fail 0
$ npm run lint
lint: 2 modules checked, 0 failed
$ claude plugin validate .
✔ Validation passed with warnings
```
- Avisos de la validación: `CLAUDE.md` en la raíz del plugin no se carga como contexto (es el de Senzu, no del plugin); faltan `LICENSE` e icono, que solo exige el directorio público y van en F4-T3.

## Desviaciones
- El `git init` ya estaba hecho (entrada 001).
- La licencia no se ha fijado: la decide Peterson en F4-T3.
- La raíz del repositorio es la raíz del plugin, así que una instalación se llevaría también `senzu/` y `.claude/`. Se resuelve en F4-T3 (qué entra en el paquete).

## Próximos pasos
- F1-T3: cola por sesión en el core.
