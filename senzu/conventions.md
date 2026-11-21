# Convenciones del proyecto (adoptadas con /adoptar)
<!-- senzu:inmutable -->
Analizado el 2026-11-21 sobre 37 módulos (`plugins/cmc/**`, `test/**`, `test-support/**`, `scripts/**`) y 32 commits. Estas convenciones GANAN a las preferencias de Senzu.
Selladas con el ok de Peterson el 2026-11-21. Para cambiarlas: borrar este archivo y `senzu/conventions.json`, y volver a ejecutar `/adoptar`.

## Naming
- Archivos en `kebab-case.mjs` — ej. `plugins/cmc/lib/agents-registry.mjs`, `plugins/cmc/hooks/prompt-capture.mjs`.
- Funciones y variables en `camelCase`, verbo primero — ej. `addMessage` (`lib/queue.mjs:138`), `handlePrompt` (`lib/capture.mjs:22`).
- Constantes de módulo en `UPPER_SNAKE` — ej. `DEFAULT_HOLD_PREFIX` (`lib/capture.mjs:9`), `MAX_TEXT_LENGTH`.
- Sin clases, salvo el error propio `CmcError` (`lib/errors.mjs:4`), con `code` estable en mayúsculas (`NO_SUCH_MESSAGE`).
- Los manejadores de hook se llaman `handle<Evento>` — ej. `handleStop`, `handleSessionStart`, `handlePostToolUse`.
- Comandos del plugin en minúscula y una palabra: `/cmc:release`, `/cmc:queue`; palabras de control igual: `;;list`, `;;now`.

## Estructura
- El repositorio es un **marketplace** (`.claude-plugin/marketplace.json`, nombre `r3v3rs3`); el plugin vive en
  `plugins/cmc/` y solo esa carpeta se instala (D-021).
- Dentro del plugin: `lib/` core, `hooks/` adaptadores de una línea (`runHook('nombre', handle…)`), `bin/cmc.mjs` CLI,
  `commands/` comandos. Fuera, en la raíz: `test/`, `test-support/` (ayudantes: `node --test` ejecuta todo lo de `test/`),
  `scripts/`, `docs/`, `senzu/`.
- Node ≥ 20, ESM (`import`/`export`), **sin dependencias de npm en lo que se instala y sin paso de compilación**.
- El estado solo se escribe bajo `${CLAUDE_PLUGIN_DATA}` (`sessions/<id>/…`), nunca en la carpeta del plugin (D-013).
- Cabecera en cada módulo: `// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).` y debajo, qué hace y por qué.

## Backend (core y adaptadores)
- **Multi-OS (Windows, macOS, Linux)**: rutas con `path.join`/`path.resolve`; carpetas comparadas por ruta real; escrituras
  con `writeFileAtomic` (`lib/atomic-write.mjs`), que reintenta el renombrado en Windows. (regla de Peterson)
- Lo que entra por un hook, la CLI o un fichero se valida en el borde a mano y el core confía en sus tipos — ej. `sessionDir`
  valida el id antes de usarlo como carpeta (`lib/paths.mjs`).
- **Un hook nunca pierde un mensaje ni estorba**: ante un error propio no imprime nada, sale con 0 y lo registra (`runHook`,
  `lib/hook-io.mjs`). Lo que cmc rechaza a propósito se explica al usuario (`Not done: …`).
- **El texto del usuario nunca va en una línea de comandos**: procesos con argumentos en array, sin shell; el prompt de un
  agente derivado entra por stdin (D-018); los comandos no reciben argumentos del usuario (D-011).
- Lo que se entrega al agente lleva cabecera factual `[cmc] The user released…`, nunca imperativa (ADR 001).
- Un agente derivado nunca corre con `bypassPermissions` (D-002).
- Errores: no se tragan; un `catch` que ignora algo lleva un comentario con el motivo.
- Salida por `process.stdout.write` / `process.stderr.write`; `console.*` no se usa. El texto de los mensajes no se registra.
- Tipos como JSDoc (`@param`, `@returns`, `@typedef`) en todo lo exportado; no hay TypeScript (D-022).

## Front
- No aplica: sin interfaz web. El indicador es un módulo de hooks del motor (`hooks/indicator.mjs`), sin `node:` (D-014).

## Tests
- `node --test`; `test/<tema>.test.mjs`; `describe`/`it` de `node:test`, `node:assert/strict`; nombres en inglés que
  describen el comportamiento — ej. `it('never hands a message to two drainers running at the same time')`.
- Cada test usa su carpeta temporal (`mkdtempSync`) como directorio de datos; nunca el real. Los procesos que lanza un
  test arrancan en `os.tmpdir()`, no dentro de su carpeta temporal (bloqueo de Windows, entrada 015).
- Cada pieza se prueba en el core y, además, lanzando su script (hook o CLI) como proceso.
- Lo que depende de Claude Code se comprueba con `scripts/e2e.mjs` contra una sesión real; no entra en `npm test`.

## Git
- Conventional Commits en inglés, título ≤ 72, sin co-autores; el cuerpo lleva `Tarea: <id>` — ej. `feat(queue): add per-session held-message queue`.
- Por tarea: un commit de código y uno `docs(devlog): close <id>`. Ramas `feat/…`, `fix/…`, `refactor/…`.

## Idioma
- Identificadores (funciones, variables, archivos): **inglés** — ej. `drainMessages()`, `session-state.mjs`.
- Términos de dominio (lenguaje ubicuo): **inglés** — `hold`, `release`, `queue`, `dispatch`, `held message`.
- Comentarios: **EN**.
- Devlog, memoria y plan: **ES**. ADR, README y documentación del producto: **EN**.
- Mensajes de commit: **EN**, Conventional ≤ 72 sin co-autores.
- Textos de cara al usuario (avisos del plugin, CLI, comandos): **inglés**.

## Zonas intocables
- `spike/`: código desechable de los experimentos; no se importa desde el producto.
- Lo generado por Senzu (`CLAUDE.md`, `.claude/**`, `senzu/senzu.json`).

## Decidido al sellar
- **Lenguaje: JavaScript sobre Node, sin TypeScript ni compilación** (D-022). Claude Code ya trae Node para ejecutar los hooks y es como están hechos Senzu y Corvus. Los tipos se documentan en JSDoc.
- **Primero Claude Code; los adaptadores para otros agentes (Codex y los que falten), después** (D-023), cuando el plugin esté terminado. Entonces se separará un núcleo sin nada específico de un agente y una carpeta por adaptador, y se volverá a ejecutar `/adoptar` para sellar esa regla. Hasta entonces `lib/` puede conocer Claude Code.

## Reglas ejecutables (en `senzu/conventions.json`; al sellar dan 0 coincidencias)
| Archivos | Veta | Por qué |
|---|---|---|
| `\.mjs$` | `\brequire\(` | ESM: `import`, no `require` |
| `^plugins/.*\.mjs$` | `shell:\s*true` | sin shell: argumentos en array |
| `^plugins/.*\.mjs$` | `\bexecSync\(\|\bexec\(` | sin líneas de shell con texto del usuario |
| `^plugins/cmc/hooks/indicator\.mjs$` | `from 'node:` | el módulo del motor no tiene Node |
| `^plugins/cmc/(hooks\|bin)/.*\.mjs$` y `lib/` salvo `atomic-write.mjs` | `\brenameSync\(` | escrituras atómicas por el ayudante (Windows) |
