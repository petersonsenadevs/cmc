# 040 — F5-T10: cabecera del hub y brief del logotipo

- **Fecha/hora:** 2026-11-21 21:51
- **Tipo:** feature
- **Mejora a:** 036
- **Tarea:** F5-T10
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: para el logotipo, un brief para hacerlo con ChatGPT (para el README), y algo medio ASCII para la terminal.
- `senzu/design-system/cmc/logos/brief.md`: qué es cmc, tres conceptos (mensaje retenido, hub, monograma; recomendado el monograma con el símbolo del hub como icono), reglas (paleta violeta, plano, legible a 32 px, sin logotipos de Anthropic/Claude), entregables (logo oscuro/claro, icono, SVG) y prompts listos para pegar en ChatGPT.
- Panel: la cabecera muestra la marca «cmc» en dos líneas de medios bloques en violeta, «Claude Message Control» y «by r3v3rs3»; debajo, el estado del agente; la pestaña del panel se llama «cmc hub».
- README: empieza con la misma marca y un hueco comentado con el `<picture>` (oscuro/claro) para cuando exista el logotipo.
- ADR 003 §8: la terminal se queda con la marca de bloques; el logotipo va al README.

## Commits
- `cc12ba4` feat(panel): give the hub its mark, name and author

## Verificación
```
$ npm test → ℹ pass 338 · ℹ fail 0   (cabecera: marca, nombre y autoría; pestaña «cmc hub»)
$ npx tsc --noEmit → 0 · npm run lint → 57 modules checked, 0 failed · claude plugin validate ./plugins/cmc → ✔
```

## Pendiente
- Peterson genera el logotipo con los prompts del brief; se copia a `senzu/design-system/cmc/logos/final/` y `plugins/cmc/assets/`, y se activa el `<picture>` del README.
