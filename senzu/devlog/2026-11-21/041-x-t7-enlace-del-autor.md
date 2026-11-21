# 041 — X-T7: «by r3v3rs3» enlaza al GitHub del autor

- **Fecha/hora:** 2026-11-21
- **Tipo:** feature
- **Mejora a:** 040
- **Tarea:** X-T7
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: que «by r3v3rs3» sea un enlace a su GitHub, `petersonsenadevs`.
- Panel: la autoría de la cabecera es un `Link` de la terminal (texto «by r3v3rs3», destino https://github.com/petersonsenadevs).
- README: «by [r3v3rs3](https://github.com/petersonsenadevs)» bajo la marca (dentro del bloque de la marca no caben enlaces); la marca ya no repite la autoría.
- `plugin.json`: `author.url`.
- Memoria de hechos: `identidad.github`.

## Commits
- `948a3e9` feat(panel): link the author to github

## Verificación
```
$ npm test → ℹ pass 338 · ℹ fail 0   (la autoría es un Link con ese destino)
$ npx tsc --noEmit → 0 · npm run lint → 0 fallos · claude plugin validate . → ✔ Validation passed
```

## Desviaciones
- El guard de Senzu bloqueó un comando que juntaba `git add … test/…` con otros pasos como si borrara un test (falso positivo); se repitió por partes.

## Corrección tras la captura de Peterson
- El panel mostraba la URL en vez de «by r3v3rs3»: el `Link` de la terminal dibuja `label` (o sus hijos) y, sin ellos, la URL; se le pasaba `text`, que no existe. Ahora `label: 'by r3v3rs3'`.
- Los selectores salían con «::»: el `Select` añade los dos puntos tras su etiqueta; se quitó el nuestro.
- Commit `fix(panel): draw the author link as text and one colon per selector`; npm test 338, lint y validate en verde.
