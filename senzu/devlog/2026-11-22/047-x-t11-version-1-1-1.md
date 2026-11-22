# 047 — X-T11: versión 1.1.1 (Help, abreviaturas, ">>" desde el módulo)

- **Fecha/hora:** 2026-11-22
- **Tipo:** feature
- **Mejora a:** 036, 045
- **Tarea:** X-T11
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: «una pestaña de ayuda explicando todo cómo funciona, como una doc», «abreviatura para subagent -m -e -w», «además de las otras» (los tres detalles de la demo, 045), «el link de GitHub está completo… debería ser un enlace como reverse y decir cmc», y «subimos un tag… en la 1.1.1».
- **Help** (tecla 5): `HELP` en `hooks/panel.ts`, cinco secciones (retener; enviar, editar y reordenar; subagentes con sus banderas; ajustes; el hub).
- **Abreviaturas** (`lib/agent-control.ts`, `SHORT_FLAGS`): `-m` modelo, `-e` esfuerzo, `-w` conversación entera (*whole*; el worktree ya es siempre), `-s` resumen, `-a` vuelta automática. Al inicio de la tarea y tras `;;dispatch N`; `-m=haiku` también. Interpretación de `-w` decidida por el agente (no hay opción de worktree que activar).
- **`>>` lo coge el módulo** (`hooks/interface.ts`): `prefixesFrom` + `messageToDispatch`; `cmc dispatch --stdin` recibe lo escrito tras `>>`. Aviso de una línea y caja vacía; si la CLI lo rechaza, pasa al hook de siempre, que explica el motivo. Antes `>>` caía al hook de comando: aviso de tres líneas de la 1.0 y la tarea quedaba en la caja.
- Fallo destapado al hacerlo: `cmc dispatch` ignoraba `--model`/`--effort` escritos dentro de la tarea; ahora se aplican (los de la línea de órdenes ganan).
- Aviso de subagente nuevo con la redacción 1.1 (hub y `/held`, no `;;list` ni `/cmc:release`).
- Fila del subagente en dos líneas (tarea; estado, tiempo, contexto, modelo, esfuerzo).
- Abajo a la derecha el enlace al repositorio dice **cmc** (`REPO_LABEL`).
- Versión 1.1.1 en los cuatro manifiestos; README (vista Help, abreviaturas, maqueta, ruta de caché), CHANGELOG y guion (C15, C16).
- No resuelto: `/cmc` con el agente trabajando quedó en cola en una demo con el render roto (045); con X-T9 no se ha vuelto a probar. Queda en el guion (C1/C2).

## Verificación
```
$ npm test → ℹ tests 352 · ℹ pass 352 · ℹ fail 0   (8 nuevos: abreviaturas, >> desde el módulo, prefijos, Help, enlace cmc, dispatch --stdin)
$ npx tsc --noEmit → 0 · npm run lint → 57 modules checked, 0 failed
$ claude plugin validate . → ✔ · ./plugins/cmc → ✔ with warnings (los mismos 3 avisos «gating hook without .catch» que en 1.1.0, comprobado en un worktree de HEAD)
```

## Próximos pasos
- Portada 1000×420 y artículo al día en dev.to; llevar a main; etiqueta v1.1.1 y release.
