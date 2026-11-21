# Convenciones del proyecto (BORRADOR de /adoptar, sin sellar)

Definidas por entrevista el 2026-11-21 (proyecto nuevo, sin código previo). **Pendiente del ok de Peterson para
sellar**: hasta entonces este archivo no lleva el sello de inmutabilidad ni existe `senzu/conventions.json`.
Lo marcado «(brief)» ya lo decidió Peterson en `senzu/plan/brief.md`; lo marcado «(propuesta)» es el valor por
defecto que se está aplicando y que falta confirmar.

## Naming
- Archivos en `kebab-case.mjs` — ej. `lib/queue.mjs`, `hooks/prompt-capture.mjs`. (propuesta)
- Funciones y variables en `camelCase`, constantes de módulo en `UPPER_SNAKE`, sin clases salvo errores propios
  — ej. `drainQueue()`, `HOLD_PREFIX`. (propuesta)
- Comandos del plugin en minúscula y una palabra: `/cmc:release`, `/cmc:queue`, `/cmc:dispatch`, `/cmc:agents`. (brief)

## Estructura
- `lib/` core puro, testeable sin Claude Code; `hooks/` adaptadores finos sin lógica; `bin/cmc.mjs` CLI;
  `commands/` comandos del plugin; `test/` tests. (brief, sección «Arquitectura» del plan)
- Node ≥ 20, ESM (`.mjs`, `import`/`export`), **sin dependencias de npm ni paso de build**. (brief)
- El estado solo se escribe bajo `${CLAUDE_PLUGIN_DATA}`, nunca en `${CLAUDE_PLUGIN_ROOT}`. (brief)
- Cabecera de autoría en cada fichero del core: `// cmc — … Author: Peterson Sena (r3v3rs3).` (brief)

## Backend (core y adaptadores)
- Lo que entra por un hook, la CLI o un fichero se valida en el borde con validación a mano (sin zod: sin
  dependencias) y el core confía en sus tipos. (propuesta)
- Un hook nunca pierde un mensaje: ante un error propio deja pasar el prompt y registra el error. (plan F1-T4)
- El texto del usuario nunca se interpola en una línea de shell: procesos con argumentos en array, sin `shell`. (brief)
- Salida por `process.stdout.write` / `process.stderr.write`; `console.log` no se usa. (muro de Senzu)

## Front
- No aplica: sin interfaz web.

## Tests
- `node --test`, ficheros `test/<módulo>.test.mjs`, `describe`/`it` de `node:test` y `node:assert/strict`,
  nombres de test en inglés. (propuesta)
- Los tests usan un directorio temporal propio como directorio de datos; nunca el real del usuario. (propuesta)

## Git
- Conventional Commits ≤ 72, en inglés, sin co-autores; el cuerpo lleva `Tarea: <id>`. Ramas `feat/…`, `fix/…`. (Senzu + propuesta de idioma)

## Idioma
- Identificadores (funciones, variables, archivos): **inglés** — ej. `drainQueue()`, `prompt-capture.mjs`. (brief)
- Términos de dominio (lenguaje ubicuo): **inglés** — `hold`, `release`, `queue`, `dispatch`. (brief)
- Comentarios: **EN**. (brief)
- Devlog, memoria y plan: **ES**. ADR, README y documentación del producto: **EN**. (brief)
- Mensajes de commit: **EN**, Conventional ≤ 72 sin co-autores. (propuesta)
- Textos de cara al usuario (avisos del plugin, CLI, comandos): **inglés**. (brief)

## Zonas intocables
- `spike/` es código desechable de los experimentos (F1-T1, F3-T1): no se reutiliza ni se importa desde el producto.
- Lo generado por Senzu (`CLAUDE.md`, `.claude/**`, `senzu/senzu.json`).

## Reglas ejecutables propuestas (irán a `senzu/conventions.json` al sellar)
| Archivos | Veta | Por qué |
|---|---|---|
| `\.mjs$` | `\brequire\(` | ESM: `import`, no `require` |
| `^(lib\|hooks\|bin)/.*\.mjs$` | `shell:\s*true` | sin shell: argumentos en array |
| `^(lib\|hooks\|bin)/.*\.mjs$` | `\bexecSync\(\|\bexec\(` | sin líneas de shell con texto del usuario |
| `^(lib\|hooks\|bin)/.*\.mjs$` | `CLAUDE_PLUGIN_ROOT.*(writeFile\|appendFile\|mkdir)` | el estado no va en la carpeta del plugin |
