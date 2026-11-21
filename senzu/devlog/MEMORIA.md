# Memoria del proyecto

<!--
Lo que SIGUE VIGENTE, en una línea por punto y con la entrada del devlog que lo explica. Máximo 60 líneas:
lo sustituido o cerrado pasa a MEMORIA-historico.md. La crea y mantiene el agente con la skill devlog
(references/memoria.md); el hook stop-guard exige actualizarla cuando el devlog del día trae decisiones.

Formato:
  - D-007 · Correos siempre por cola (Horizon + Redis), nunca síncronos · ver 012
  - D-003 · Sanctum, no Passport: no hay terceros que consuman la API · ver 005
  - D-002 · Stripe Elements: sustituida por D-009 · ver 004
  - [desde 2026-10-04] Textos legales del cliente (en «Pendientes abiertos», siempre con su fecha)

Lo que vale en TODOS los proyectos del usuario no va aquí: va a su memoria personal (/recordar).
-->

## Decisiones vigentes
- D-001 · El plugin se llama `cmc`; prefijos `;;` (retener) y `>>` (derivar), configurables · ver 001
- D-002 · El agente derivado edita solo en su worktree, `acceptEdits` como máximo, nunca `bypassPermissions` · ver 001
- D-003 · El resultado del derivado vuelve retenido; el retorno automático es un ajuste · ver 001
- D-004 · Producto en inglés (código, comandos, README, ADR); devlog y plan en castellano · ver 001
- D-005 · Captura con `UserPromptSubmit` bloqueando los prompts con prefijo (funciona a mitad de turno) · ver 002
- D-006 · Liberar: `/cmc:release` (a mitad de turno actúa al terminar) y `Stop` con `decision: block` en una sola continuación · ver 002
- D-007 · Modo «ya»: prompt `;;now` + `additionalContext` con cabecera «[cmc] The user released their held messages…» · ver 002
- D-008 · Los comandos pasan `${CLAUDE_PLUGIN_DATA}` y `${CLAUDE_SESSION_ID}` como argumentos y llevan `disable-model-invocation: true` · ver 002
- D-009 · La cola se toca siempre bajo cerrojo por directorio y se reescribe con temporal + renombrado · ver 004
- D-010 · `;;end` (sin espacio) arma una entrega de un solo uso al terminar el turno; `;; end` es un mensaje normal · ver 006
- D-011 · La cola se gestiona con palabras de control (`;;list`, `;;edit`, `;;rm`, `;;move`…), no con argumentos de comando; `/cmc:queue` solo lista · ver 008
- D-012 · `cmc release --now` (desde fuera) entrega por `PostToolUse` con la cabecera factual y, si no hay más pasos, por `Stop` · ver 009
- D-013 · La CLI encuentra el directorio de datos por la marca `cmc.json` (no hay estado fuera de `CLAUDE_PLUGIN_DATA`) y la sesión por carpeta · ver 010
- D-014 · El indicador `✉ N held` es un módulo de hooks (`hooks/indicator.mjs`, `$.ui.status`), no la `statusLine` del usuario · ver 011
- D-015 · Las sesiones sin actividad en 30 días se borran con su cola al arrancar otra; configurable en F4-T1 · ver 012
- D-016 · Derivar: por defecto fork de la sesión (`--resume <id> --fork-session`), paquete de contexto como alternativa y respaldo · ver 013
- D-017 · El worktree del derivado lo crea `--worktree cmc-<id>` de Claude Code; sin git, misma carpeta con aviso · ver 013
- D-018 · Cada agente derivado corre bajo un supervisor desacoplado; el prompt entra por stdin, nunca por la línea de comandos · ver 015
- D-019 · Lint del proyecto = `node --check` sobre cada `.mjs` (`scripts/lint.mjs`); sin ESLint ni `tsc`: no hay dependencias ni TypeScript · ver 003
- D-020 · Lo que solo se ve en la interfaz interactiva (aviso de retención, indicador) lo comprueba Peterson con `docs/manual-test.md` parte B; el agente verifica en headless con `scripts/e2e.mjs` · ver 007
- D-021 · El repositorio es un marketplace (`r3v3rs3`) y el plugin vive en `plugins/cmc/`; se instala con `marketplace add` + `install cmc@r3v3rs3` · ver 016

## Reglas del cliente y del proyecto
- El plugin es multi-OS (Windows, macOS, Linux): rutas con `path.join`/`resolve`, carpetas comparadas por ruta real, sin separadores a mano · ver 012

## Lo que no funcionó (no repetir)
- El `additionalContext` de `PostToolUse` con redacción imperativa no se obedece; con la cabecera factual sí · ver 002, 009
- Redactar lo liberado en imperativo («Treat each line as a message from the user») hace que el modelo desconfíe · ver 002
- Las variables `CLAUDE_PLUGIN_*` no existen en el proceso de un `!` de comando; sí en los hooks · ver 002
- En Windows, la carpeta que fue directorio de trabajo de un proceso sigue bloqueada un rato tras su salida: los tests no lanzan procesos dentro de su carpeta temporal · ver 015

## Pendientes abiertos
- [desde 2026-11-21] Ok de Peterson para sellar `senzu/conventions.md` (borrador de /adoptar)
- [desde 2026-11-21] F1-T6b: Peterson pasa la parte B de `docs/manual-test.md` en la interfaz interactiva
- [desde 2026-11-21] Ejecutar la suite en macOS y Linux (solo se ha corrido en Windows) · ver 014
