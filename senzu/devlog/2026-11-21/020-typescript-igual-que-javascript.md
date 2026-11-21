# 020 — TypeScript frente a JavaScript: rendimiento y batería completa

- **Fecha/hora:** 2026-11-21 02:33
- **Tipo:** fix
- **Mejora a:** 019
- **Tarea:** X-T3
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson puso la condición para sellar: que en Claude Code funcione todo igual y no empeore; si no, se vuelve atrás. Se comparó la versión JavaScript (commit `d318872`) con la TypeScript.
- **Rendimiento.** Empeoraba: cada hook tardaba unos 95 ms frente a 42 ms. Corregido con `hooks/run.js`, un lanzador en JavaScript sin lógica que activa la caché de compilación de Node y carga el núcleo; `lib/hooks.ts` resuelve el hook por nombre. Los cuatro scripts de hook de una línea desaparecen.
- **Comportamiento.** Ocho escenarios reales repetidos en TypeScript, más reanudación, carga del módulo indicador y una derivación real.
- **Hallazgo que no es de TypeScript:** el modo «ya» a mitad de turno no es fiable en ninguna de las dos versiones. La entrada 009 y el README decían que el modelo lo había obedecido «en todas las pruebas»: era una ejecución por vía. README y ADR 001 corregidos; tarjeta X-T4.

## Commits
- `5732cc8` perf(hooks): start hooks through a launcher with the compile cache

## Decisiones (resumen; detalle en DECISIONES.md)
- D-026 lanzador `hooks/run.js` + caché de compilación (ver DECISIONES.md#dev-020).

## Verificación
```
Tiempo por hook, 30 ejecuciones, mediana / p90 en ms:
                                    JavaScript    TS sin caché    TS con lanzador
prompt normal (pasa)                  42 / 45       95 / 111        45 / 46
prompt retenido (;; texto)            46 / 48       96 / 111        49 / 52
herramienta, nada pendiente           41 / 42       90 / 95         44 / 45
fin de turno, nada pendiente          41 / 43       90 / 96         44 / 46

Escenarios reales en TypeScript (claude -p, modelo haiku):
retener a mitad de turno                       → step1, step2, step3 · cola 1          igual que JS
2 retenidos + /cmc:release                     → pineapple mango                       igual
;;end                                          → papaya                                igual
/cmc:release a mitad de turno                  → mango (al terminar el turno)          igual
editar, borrar, reordenar + /cmc:release       → guava papaya                          igual
cerrar y reanudar con --continue + release     → guava mango                           igual
derivar a un fork (lectura)                    → finished, «codename is HERON», 17 ms  igual
módulo indicador (.ts) en el motor             → hooks module cmc@inline loaded        igual

Modo «ya» a mitad de turno, 3 ejecuciones por versión (¿obedece el modelo?):
                     ;;now 2      cmc release --now
JavaScript           1 de 3       1 de 3
TypeScript           2 de 3       1 de 3

$ npx tsc --noEmit → exit 0 · npm test → 146 pass, 0 fail · npm run lint → 36 modules checked, 0 failed
```

## Desviaciones
- El plugin tiene un fichero JavaScript (`hooks/run.js`, 5 líneas de código). Es el precio de no perder 50 ms en cada herramienta del agente.
- La caché de compilación con TypeScript está comprobada en Node 24.4.1; en Node 22.18 no se ha probado si cachea los `.ts` (si no lo hiciera, funcionaría igual pero más lento).
- El modo «ya» queda documentado como no fiable con el agente ocupado; el arreglo es X-T4.

## Próximos pasos
- Sellar las convenciones (condición de Peterson cumplida).
- F3-T3 y, antes de cerrar la fase 3, X-T4.
