# 019 — X-T3: el plugin pasa a TypeScript ejecutado por Node

- **Fecha/hora:** 2026-11-21 02:22
- **Tipo:** refactor
- **Mejora a:** 018
- **Tarea:** X-T3
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Los 36 módulos (`plugins/cmc/**`, `test/**`, `test-support/**`, `scripts/**`) pasan de `.mjs` a `.ts`. Node los ejecuta directamente: no hay compilación ni `dist/`, y la instalación por marketplace sigue copiando la carpeta tal cual.
- `plugins/cmc/package.json` (`"type": "module"`) para que los `.ts` sean módulos ES también una vez copiados a la caché de Claude Code, donde ya no está el `package.json` de la raíz.
- `tsconfig.json` estricto (`strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`). `typescript` y `@types/node@22` como dependencias solo de desarrollo; script `npm run types`.
- Tipado real en dos tandas paralelas (subagentes), revisadas después: 666 errores de `tsc` → 0, sin `any`, `@ts-ignore` ni `!`. Los JSDoc `@typedef` son ahora tipos exportados (`HeldMessage`, `Selection`, `SessionRecord`, `AgentRecord`, `Control`, `HookInput`…). Lo que llega por un hook o sale de `JSON.parse` es `unknown` y se estrecha donde se usa.
- Node mínimo: 22.18, comprobado en la documentación de Node (desde esa versión ejecuta `.ts` sin opciones ni aviso; estable desde la 24.12).
- El «types» de la verificación de Senzu, que lanzaba `tsc` sin TypeScript, pasa a verde.

## Fallos reales que destapó el tipado estricto (corregidos)
1. `;;now`: si otro proceso vaciaba la cola entre elegir y soltar, se entregaba al agente el texto «null». Ahora responde que no hay nada que soltar.
2. `cancelAgent` podía devolver `null` aunque prometía el registro del agente.
3. `cmc` (CLI): un comando de cola habría impreso `undefined` si alguna vez devolviera contexto en vez de respuesta.
4. `agent-runner` sin argumento, con `command` vacío o sin stdin del hijo: fallaba con un `TypeError` confuso; ahora da un error claro y el agente queda `failed`.
5. `scripts/e2e.ts` y `test-support/queue-worker.ts`: una opción sin valor metía `undefined`; ahora avisan y salen con código 2.

## Commits
- `f0ce054` refactor: rename every module to TypeScript run directly by Node
- `c20aec9` refactor: type the whole code base under strict TypeScript

## Decisiones (resumen; detalle en DECISIONES.md)
- Aplica D-024 (sustituye a D-022). D-025: tipado estricto sin escapes (ver DECISIONES.md#dev-019).

## Verificación
```
$ npx tsc --noEmit                      → exit 0, sin salida
$ npm test                              → tests 146 · pass 146 · fail 0   (tres veces seguidas)
$ npm run lint                          → lint: 38 modules checked, 0 failed
$ claude plugin validate .              → ✔ Validation passed
$ node .claude/skills/code-quality/scripts/verify-build.mjs
  PASS lint · PASS types · PASS test · SKIP build

$ node scripts/e2e.ts --mid ";; reply with the word guava" --mid ";; reply with the word mango" --mid ";;top 2" --cli "hold reply with the word papaya" --mid ";;end"
  8.7s  NOTICE     Message 2 is now first. …
 10.3s  CLI        cmc hold reply with the word papaya → Held (3 queued).
 24.3s  DELIVERED  Stop hook feedback: [cmc] The user released their held messages with ";;end": 1. … mango 2. … guava 3. … papaya
 25.9s  AGENT      mango guava papaya

Instalación por marketplace en una configuración aislada:
$ claude plugin install cmc@r3v3rs3     → ✔ Successfully installed plugin
caché: bin commands hooks lib package.json   ·   hooks: indicator.ts prompt-capture.ts session-register.ts stop-release.ts tool-release.ts
$ … | node <caché>/hooks/prompt-capture.ts   → {"decision":"block","reason":"Held (1 queued). Release with /cmc:release."}
```

## Desviaciones
- Queda un único `as` sin validación completa: `readAgentAt` da por bueno el `agent.json` que el propio módulo escribe (solo comprueba que sea un objeto con `id`). Está comentado.
- Fichero nuevo `test-support/expect.ts` (`first`, `present`, `blocked`): afirman y estrechan el tipo en los tests. Ningún test se quitó ni se debilitó.
- Sin probar: Node 22.18 exacto (aquí hay 24.4.1), macOS y Linux.
- `spike/` sigue en `.mjs`: es código desechable.

## Próximos pasos
- `/adoptar` de nuevo, ya con TypeScript (propuesta en `senzu/conventions.md`, sin sellar).
- F3-T3: worktree del agente derivado, en TypeScript.
