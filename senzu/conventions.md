# Convenciones del proyecto (PROPUESTA de /adoptar, sin sellar)

Analizado el 2026-11-21 sobre 38 módulos TypeScript (`plugins/cmc/**`, `test/**`, `test-support/**`, `scripts/**`) y 45 commits.
**Pendiente del ok de Peterson para sellar**: este archivo no lleva el sello de inmutabilidad y no existe `senzu/conventions.json`.

## Naming
- Archivos en `kebab-case.ts` — ej. `plugins/cmc/lib/agents-registry.ts`, `plugins/cmc/hooks/prompt-capture.ts`.
- Funciones y variables en `camelCase`, verbo primero — ej. `addMessage` (`lib/queue.ts`), `handlePrompt` (`lib/capture.ts`).
- Constantes de módulo en `UPPER_SNAKE` — ej. `DEFAULT_HOLD_PREFIX` (`lib/capture.ts`), `MAX_TEXT_LENGTH`.
- Sin clases, salvo el error propio `CmcError` (`lib/errors.ts`), con `code` estable en mayúsculas (`NO_SUCH_MESSAGE`).
- Los manejadores de hook se llaman `handle<Evento>` — ej. `handleStop`, `handleSessionStart`, `handlePostToolUse`.
- Comandos del plugin en minúscula y una palabra: `/cmc:release`, `/cmc:queue`; palabras de control igual: `;;list`, `;;now`.

## Estructura
- El repositorio es un **marketplace** (`.claude-plugin/marketplace.json`, nombre `r3v3rs3`); el plugin vive en
  `plugins/cmc/` y solo esa carpeta se instala (D-021).
- Dentro del plugin: `lib/` core, `hooks/` adaptadores de una línea (`runHook('nombre', handle…)`), `bin/cmc.ts` CLI,
  `commands/` comandos. Fuera, en la raíz: `test/`, `test-support/` (ayudantes: `node --test` ejecuta todo lo de `test/`),
  `scripts/`, `docs/`, `senzu/`.
- **TypeScript ejecutado directamente por Node ≥ 22.18** (D-024): módulos ES `.ts`, sin compilación ni `dist/`, y **sin dependencias de npm en lo que se instala**. `typescript` y `@types/node` solo en desarrollo. El plugin lleva su propio `package.json` con `"type": "module"`.
- Las importaciones relativas llevan la extensión `.ts`; lo que solo es tipo se importa con `import type` o `import { fn, type T }`.
- El estado solo se escribe bajo `${CLAUDE_PLUGIN_DATA}` (`sessions/<id>/…`), nunca en la carpeta del plugin (D-013).
- Cabecera en cada módulo: `// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).` y debajo, qué hace y por qué.

## Backend (core y adaptadores)
- **Multi-OS (Windows, macOS, Linux)**: rutas con `path.join`/`path.resolve`; carpetas comparadas por ruta real; escrituras
  con `writeFileAtomic` (`lib/atomic-write.ts`), que reintenta el renombrado en Windows. (regla de Peterson)
- Lo que entra por un hook, la CLI o un fichero se valida en el borde a mano y el core confía en sus tipos — ej. `sessionDir`
  valida el id antes de usarlo como carpeta (`lib/paths.ts`).
- **Un hook nunca pierde un mensaje ni estorba**: ante un error propio no imprime nada, sale con 0 y lo registra (`runHook`,
  `lib/hook-io.ts`). Lo que cmc rechaza a propósito se explica al usuario (`Not done: …`).
- **El texto del usuario nunca va en una línea de comandos**: procesos con argumentos en array, sin shell; el prompt de un
  agente derivado entra por stdin (D-018); los comandos no reciben argumentos del usuario (D-011).
- Lo que se entrega al agente lleva cabecera factual `[cmc] The user released…`, nunca imperativa (ADR 001).
- Un agente derivado nunca corre con `bypassPermissions` (D-002).
- Errores: no se tragan; un `catch` que ignora algo lleva un comentario con el motivo.
- Salida por `process.stdout.write` / `process.stderr.write`; `console.*` no se usa. El texto de los mensajes no se registra.
- **Tipado estricto sin escapes** (D-025): `strict` y `noUncheckedIndexedAccess`; sin `any`, `@ts-ignore`, `@ts-expect-error` ni `!`. Lo que entra por un hook o sale de `JSON.parse` es `unknown` y se estrecha donde se usa (`HookInput`, `isRecord`, `errorCode`). Un `as` solo junto a la comprobación que lo justifica.
- **Solo sintaxis borrable** (`erasableSyntaxOnly`): sin `enum`, sin `namespace` con código, sin propiedades en el constructor; Node quita los tipos, no transforma el código.
- Los tipos que antes eran `@typedef` son `type`/`interface` exportados junto a su módulo — ej. `HeldMessage` (`lib/queue.ts`), `AgentRecord` (`lib/agents-registry.ts`). Los comentarios de documentación cuentan el qué y el porqué, no repiten el tipo.

## Front
- No aplica: sin interfaz web. El indicador es un módulo de hooks del motor (`hooks/indicator.ts`), sin `node:` ni importaciones de `claude-code`; declara sus propios tipos del motor (D-014).

## Tests
- `node --test`; `test/<tema>.test.ts`; `describe`/`it` de `node:test`, `node:assert/strict`; nombres en inglés que
  describen el comportamiento — ej. `it('never hands a message to two drainers running at the same time')`.
- Cada test usa su carpeta temporal (`mkdtempSync`) como directorio de datos; nunca el real. Los procesos que lanza un
  test arrancan en `os.tmpdir()`, no dentro de su carpeta temporal (bloqueo de Windows, entrada 015).
- Cada pieza se prueba en el core y, además, lanzando su script (hook o CLI) como proceso.
- En los tests, un valor que puede faltar se afirma antes de usarlo (`first`, `present`, `blocked` de `test-support/expect.ts`), no se fuerza con `!`.
- Verificación de cada tarea: `npm run types` (`tsc --noEmit`), `npm run lint` y `npm test`.
- Lo que depende de Claude Code se comprueba con `scripts/e2e.ts` contra una sesión real; no entra en `npm test`.

## Git
- Conventional Commits en inglés, título ≤ 72, sin co-autores; el cuerpo lleva `Tarea: <id>` — ej. `feat(queue): add per-session held-message queue`.
- Por tarea: un commit de código y uno `docs(devlog): close <id>`. Ramas `feat/…`, `fix/…`, `refactor/…`.

## Idioma
- Identificadores (funciones, variables, archivos): **inglés** — ej. `drainMessages()`, `session-state.ts`.
- Términos de dominio (lenguaje ubicuo): **inglés** — `hold`, `release`, `queue`, `dispatch`, `held message`.
- Comentarios: **EN**.
- Devlog, memoria y plan: **ES**. ADR, README y documentación del producto: **EN**.
- Mensajes de commit: **EN**, Conventional ≤ 72 sin co-autores.
- Textos de cara al usuario (avisos del plugin, CLI, comandos): **inglés**.

## Zonas intocables
- `spike/`: código desechable de los experimentos; no se importa desde el producto.
- Lo generado por Senzu (`CLAUDE.md`, `.claude/**`, `senzu/senzu.json`).

## Decidido con Peterson
- **Lenguaje: TypeScript ejecutado por Node, sin compilación** (D-024, sustituye a D-022). Claude Code ya trae Node para ejecutar los hooks.
- **Primero Claude Code; los adaptadores para otros agentes (Codex y los que falten), después** (D-023), en la fase 5. Entonces se separará un núcleo sin nada específico de un agente y una carpeta por adaptador, y se volverá a ejecutar `/adoptar`. Hasta entonces `lib/` puede conocer Claude Code.

## Reglas ejecutables propuestas (irán a `senzu/conventions.json` al sellar; hoy dan 0 coincidencias)
| Archivos | Veta | Por qué |
|---|---|---|
| `\.ts$` | `\brequire\(` | módulos ES: `import`, no `require` |
| `plugins/.*\.ts$` | `shell:\s*true` | sin shell: argumentos en array |
| `plugins/.*\.ts$` | `\bexecSync\(\|\bexec\(` | sin líneas de shell con texto del usuario |
| `hooks/indicator\.ts$` | `from 'node:` | el módulo del motor no tiene Node |
| `plugins/cmc/(hooks\|bin\|lib)/` salvo `atomic-write.ts` | `\brenameSync\(` | escrituras atómicas por el ayudante (Windows) |
| `(plugins\|test\|test-support\|scripts)/.*\.ts$` | `@ts-ignore\|@ts-expect-error\|\bas any\b\|:\s*any\b` | tipado estricto sin escapes |
| `(plugins\|test\|test-support\|scripts)/.*\.ts$` | `^\s*(export\s+)?(const\s+)?enum\s` | solo sintaxis borrable: Node no transforma `enum` |
