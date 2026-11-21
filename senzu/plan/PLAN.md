# Plan — Plugin de Claude Code `cmc` (Claude Message Control)

- **Objetivo:** retener los mensajes y soltarlos cuando el usuario quiera, sin interrumpir al agente, y derivar un mensaje a otro agente que hereda el contexto y trabaja en paralelo.
- **Estado:** en curso · **Actualizado:** 2026-11-21
- **Stack / perfil:** a medida · plugin de Claude Code · TypeScript ejecutado directamente por Node ≥ 22.18 (sin build ni dependencias en lo que se instala; `typescript` solo en desarrollo) · `node --test` · antes del 2026-11-21: ESM `.mjs`
- **Brief:** `senzu/plan/brief.md` · **Design system:** no aplica (sin interfaz web) · **Devlog:** `senzu/devlog/INDEX.md`
- **Definición de hecho global:** `node --test` en verde, `claude plugin validate .` limpio, probado en sesión real con `claude --plugin-dir .`, sin secretos, cabecera de autoría (Peterson Sena · r3v3rs3) en el core, devlog al día, sin push ni publicación sin aprobación
- **Idioma:** producto en inglés (código, comentarios, textos del plugin, nombres de comandos, README, documentación y ADR); devlog y este plan en castellano

## Alcance
- **IN:** captura por prefijo y por CLI externa; cola por sesión persistente (listar, editar, borrar, reordenar); liberación manual, «al terminar» y «ya»; indicador visible; derivación a otro agente con contexto (fork de sesión o paquete de contexto) en worktree; estado, log y cancelación; retorno del resultado a la cola; configuración, README y marketplace local.
- **OUT (explícito):** retener lo que se envía sin prefijo por la cola nativa; canales MCP (`--channels`, en vista previa); conversación en tiempo real entre agentes que están trabajando (un mensaje a un agente le llega cuando acaba su turno, F5-T7); fusión automática del worktree; otros CLI (pasan a la fase F5, tras terminar Claude Code) y apps de escritorio/web; publicación en marketplace público.
- **Supuestos:** S1 nombre `cmc`, prefijos `;;` y `>>` · S2 `UserPromptSubmit` intercepta los mensajes de mitad de turno sin interrumpir (no documentado) · S3 `/cmc:release` se expande a mitad de turno (no documentado) · S4 el fork funciona con la sesión a mitad de turno (no documentado) · S5 sin git no hay worktree.
- **Riesgos:** ver sección final

## Arquitectura (decidida al planificar)
- **Desde el 2026-11-21 (D-021):** el repositorio es un marketplace (`.claude-plugin/marketplace.json`, nombre `r3v3rs3`) y el plugin vive en `plugins/cmc/`. Las rutas de abajo (`lib/`, `hooks/`, `bin/`, `commands/`) cuelgan de `plugins/cmc/`; `test/`, `test-support/` y `scripts/` siguen en la raíz y no se instalan.
- `lib/` — core puro y testeable sin Claude Code: `queue.mjs` (cola JSONL por sesión, vaciado atómico), `sessions.mjs` (registro de sesiones por carpeta), `config.mjs`, `dispatch.mjs` (lanzador), `context-pack.mjs`.
- `hooks/` — adaptadores finos: leen el JSON del hook por stdin, llaman al core y devuelven la salida del hook. Sin lógica propia.
- `bin/cmc.mjs` — CLI externa (otra terminal) sobre el mismo core.
- `commands/` — `/cmc:release`, `/cmc:queue`, `/cmc:dispatch`, `/cmc:agents`.
- Estado solo en `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>/`. No se declara `senzu/arquitectura/capas.json`: no hay backend; las decisiones van a ADR en `senzu/arquitectura/adr/`.

## Fases
| Fase | Entregable verificable por el usuario | Estado |
|---|---|---|
| F1 | Esqueleto: escribes `;; texto` con el agente trabajando, no se interrumpe, y `/cmc:release` o el fin del turno se lo entrega | doing |
| F2 | Control completo: ver, editar, borrar y soltar de forma selectiva, modo «ya», indicador visible y CLI `cmc` desde otra terminal | done |
| F3 | Derivar: `>> tarea` arranca un segundo agente con contexto en su worktree, en paralelo; se ve, se cancela y su resultado vuelve a la cola (retenido o automático) | done |
| F4 | Entrega: configuración, revisión de seguridad, README e instalación desde marketplace local | done |
| F5 | Panel de control: un panel junto al chat, manejable con el ratón, con la cola y los agentes en vivo; enviar, editar, borrar, reordenar y derivar mensajes; ver, parar y escribir a los agentes, y pasar el resultado de uno a otro | todo |
| F6 | Adaptadores para otros agentes: núcleo sin nada de Claude Code, adaptador de Codex y los que falten (se planifica al cerrar F5) | todo |

---

## F1 — Esqueleto: retener y soltar

### F1-T1 · Comprobar el comportamiento real de los hooks a mitad de turno  [S] [done]
- Para qué: saber si un mensaje se puede retener sin interrumpir al agente antes de construir nada encima.
- Skill: sin skill: experimento con hooks de prueba que solo registran en un fichero
- Archivos: spike/hooks.json, spike/log-hook.mjs, senzu/arquitectura/adr/001-captura-y-liberacion.md
- Hecho cuando: el ADR responde con evidencia a (a) ¿`UserPromptSubmit` se dispara con mensajes escritos a mitad de turno?, (b) ¿bloquearlo interrumpe al agente o muestra algo molesto?, (c) ¿un `/comando` escrito a mitad de turno se expande al entregarse?, (d) ¿`Stop` con `decision: block` entrega el `reason` como instrucción y respeta `stop_hook_active`?, (e) ¿`PostToolUse additionalContext` llega al modelo en ese mismo turno?; y fija el diseño de captura y liberación (o el plan B: captura a mitad de turno solo por CLI externa).
- Verificar: sesión real con `claude --plugin-dir ./spike` lanzando una tarea larga; el log del spike y las respuestas a–e pegados en el ADR.
- Depende de: —
- Verificado: ocho ejecuciones headless con `node spike/drive.mjs <escenario>`; `;; HELD-ALPHA` enviado a mitad de turno → `UserPromptSubmit held=true` tras el primer `PostToolUse`, los pasos 2 y 3 siguen y `/cmc-spike:release` lo entrega (`result 2: pineapple`); `claude plugin validate ./spike` → Validation passed
- Cumple: ya se sabe que un mensaje con prefijo se puede retener a mitad de turno sin interrumpir al agente, que era el «Para qué»; el diseño queda fijado en el ADR 001
- Devlog: senzu/devlog/2026-11-21/002-f1-t1-spike-hooks-mitad-de-turno.md
- Notas: medido en modo headless (stream-json); la interfaz interactiva se comprueba en F1-T6. S3 refutado para mitad de turno: el comando se expande al terminar el turno. Archivos reales: spike/hooks/hooks.json, spike/probe.mjs, spike/drain.mjs, spike/drive.mjs.

### F1-T2 · Crear el esqueleto del plugin y el repositorio  [S] [done]
- Para qué: tener un plugin que carga y un sitio donde probar cada pieza.
- Skill: `code-quality §references/git-and-reviews "Conventional Commits"`
- Archivos: .claude-plugin/plugin.json, hooks/hooks.json, package.json (`"type":"module"`, script `test`), .gitignore, README.md, senzu/devlog/INDEX.md, test/smoke.test.mjs
- Hecho cuando: `git init` hecho; el plugin carga sin errores; `npm test` ejecuta un test trivial en verde; autoría en `plugin.json`.
- Verificar: `claude plugin validate .` sin errores; `npm test` → 1 verde.
- Depende de: F1-T1 (Q1: nombre y prefijos)
- Verificado: `npm test` → 2 pass, 0 fail; `npm run lint` → 2 modules checked, 0 failed; `claude plugin validate .` → Validation passed with warnings (CLAUDE.md de Senzu en la raíz; LICENSE e icono, de F4-T3)
- Cumple: hay un plugin que carga y valida y un `npm test` donde colgar cada pieza, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/003-f1-t2-esqueleto-plugin.md
- Notas: `git init` hecho antes (entrada 001). Archivos extra: scripts/lint.mjs, .gitattributes. Licencia sin fijar hasta F4-T3.

### F1-T3 · Implementar la cola por sesión en el core  [M] [done]
- Para qué: que los mensajes retenidos no se pierdan ni se entreguen dos veces.
- Skill: `code-quality §references/testing "TDD pragmático"` + `code-quality §references/jobs-and-queues "Idempotencia (el job llegará dos veces)"`
- Archivos: lib/queue.mjs, lib/paths.mjs, test/queue.test.mjs
- Hecho cuando: `add`, `list`, `drain` (todos o por id) sobre JSONL en el directorio de datos; `drain` es atómico (renombrado) y dos vaciados simultáneos no entregan el mismo mensaje; un fichero corrupto no rompe: se aparta y se avisa.
- Verificar: `npm test` → tests de cola en verde, incluido el de dos procesos vaciando a la vez.
- Depende de: F1-T2
- Verificado: `npm test` → 13 pass, 0 fail, incluido «never hands a message to two drainers running at the same time» (2 procesos añadiendo 120 mensajes y 3 vaciando: cada uno entregado una vez); `npm run lint` → 7 modules checked, 0 failed
- Cumple: los mensajes retenidos persisten en disco y ningún vaciado simultáneo los pierde ni los duplica, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/004-f1-t3-cola-por-sesion.md
- Notas: cerrojo por directorio además del renombrado (D-009). Archivos extra: lib/errors.mjs, test-support/queue-worker.mjs.

### F1-T4 · Capturar mensajes con prefijo en `UserPromptSubmit`  [M] [done]
- Para qué: escribir un mensaje mientras el agente trabaja sin que lo reciba.
- Skill: `code-quality §references/errors-logging "No tragar errores"`
- Archivos: hooks/prompt-capture.mjs, hooks/hooks.json, test/prompt-capture.test.mjs
- Hecho cuando: un prompt que empieza por `;;` se guarda en la cola y se bloquea con un aviso corto («Held (3 queued)»); un prompt sin prefijo pasa intacto; si el hook falla, el prompt pasa (nunca se pierde un mensaje) y el error queda en el log.
- Verificar: `npm test` (JSON de entrada simulado → salida esperada) y sesión real: `;; hola` a mitad de turno no aparece en el contexto del agente.
- Depende de: F1-T3
- Verificado: `npm test` → 26 pass, 0 fail; `npm run lint` → 12 modules checked, 0 failed; sesión real `node scripts/e2e.mjs --mid ";; HELD-ALPHA please also say pineapple"` → aviso `Held (1 queued)` tras el paso 1, el agente responde `step1, step2, step3` sin mencionarlo y la cola queda con 1 mensaje
- Cumple: se puede escribir un mensaje mientras el agente trabaja sin que lo reciba, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/005-f1-t4-captura-por-prefijo.md
- Notas: archivos extra: lib/capture.mjs, lib/hook-io.mjs, lib/log.mjs, scripts/e2e.mjs. Sesión real en modo headless.

### F1-T5 · Soltar la cola con `/cmc:release` y al terminar el turno  [M] [done]
- Para qué: decidir tú cuándo recibe el agente lo retenido.
- Skill: `code-quality §references/security-owasp "Prompt injection y seguridad de LLM"`
- Archivos: commands/release.md, hooks/stop-release.mjs, bin/cmc.mjs (subcomando `drain`), test/stop-release.test.mjs
- Hecho cuando: `/cmc:release` entrega todos los mensajes en orden, marcados como mensajes del usuario retenidos, y vacía la cola; con el modo «al terminar» activo, el hook `Stop` los entrega al acabar el turno y no entra en bucle (`stop_hook_active`); con la cola vacía, ninguno de los dos hace nada.
- Verificar: `npm test` y sesión real: retener 2 mensajes, comprobar que el agente termina su tarea sin verlos y que los recibe al soltar.
- Depende de: F1-T4
- Verificado: `npm test` → 48 pass, 0 fail; `npm run lint` → 18 modules checked, 0 failed; sesión real: 2 mensajes retenidos a mitad de turno, el agente responde `step1, step2, step3` sin verlos y tras `/cmc:release` responde `pineapple mango`; con `;;end` el hook `Stop` entrega `[cmc] The user released their held message with ";;end"` y el agente responde `papaya`; cola vacía al final en ambos
- Cumple: el usuario decide cuándo recibe el agente lo retenido (a mano o al terminar el turno), que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/006-f1-t5-soltar-la-cola.md
- Notas: el modo «al terminar» se activa con `;;end` (D-010), adelantado de F2-T2. Archivos extra: lib/release.mjs, lib/session-state.mjs.

### F1-T6 · Cerrar la fase con prueba de extremo a extremo  [S] [done]
- Para qué: confirmar que el esqueleto cumple lo pedido antes de ampliarlo.
- Skill: sin skill: cierre de fase (resumen en devlog)
- Archivos: senzu/devlog/<fecha>/NNN-cierre-f1.md, README.md (uso básico)
- Hecho cuando: guion de prueba manual documentado y pasado (retener a mitad de turno → no interrumpe → soltar manual → soltar al terminar); desviaciones respecto al ADR 001 anotadas.
- Verificar: guion ejecutado en sesión real con su resultado pegado en el devlog.
- Depende de: F1-T5
- Verificado: guion parte A de `docs/manual-test.md` ejecutado en sesiones reales headless: A1 (retener a mitad de turno, no interrumpe, `QUEUE 1 held`), A2 (`/cmc:release` → `pineapple mango`), A3 (`;;end` → `Stop hook feedback: [cmc] The user released…` → `papaya`), más `/cmc:release` a mitad de turno (actúa al terminar → `mango`); `npm test` → 48 pass
- Cumple: el esqueleto hace lo pedido de extremo a extremo (retener sin interrumpir, soltar a mano, soltar al terminar) antes de ampliarlo, que era el «Para qué»; queda sin comprobar solo cómo se ve en la interfaz interactiva (F1-T6b)
- Devlog: senzu/devlog/2026-11-21/007-f1-t6-cierre-fase-1.md
- Notas: dividida: la parte B del guion (interfaz interactiva) pasa a F1-T6b porque el agente no puede conducir el terminal. Archivo extra: docs/manual-test.md.

### F1-T6b · Pasar el guion en la interfaz interactiva  [S] [blocked]
- Para qué: confirmar que en el terminal real retener no interrumpe y que el aviso no molesta, que es lo único que el modo headless no demuestra.
- Skill: sin skill: prueba manual
- Archivos: senzu/devlog/<fecha>/NNN-guion-interactivo.md
- Hecho cuando: las seis filas de la parte B de `docs/manual-test.md` (B1–B6, la B6 es el indicador de F2-T4) están ejecutadas con su resultado y con cómo se ve el aviso en pantalla; si alguna falla, hay tarjeta de arreglo.
- Verificar: `claude --plugin-dir .` en una carpeta de pruebas, siguiendo `docs/manual-test.md`.
- Depende de: F1-T6
- Verificado: —
- Cumple: —
- Devlog: —
- Notas: bloqueada. Necesito: que Peterson ejecute la parte B (unos cinco minutos); el agente no puede escribir en la interfaz interactiva. No bloquea F2.

## F2 — Control completo de la cola

### F2-T1 · Gestionar la cola: ver, editar, borrar y reordenar  [M] [done]
- Para qué: control total de lo retenido: decidir qué mensaje va primero y cuál después, y corregir o descartar cualquiera antes de enviarlo.
- Skill: `code-quality §references/testing "Qué testear y qué no"`
- Archivos: lib/queue.mjs, commands/queue.md, bin/cmc.mjs (`list`, `edit`, `rm`, `move`), test/queue-manage.test.mjs
- Hecho cuando: `/cmc:queue` muestra posición, id, hora y texto de cada mensaje; se puede editar el texto, borrar uno o todos y cambiar el orden (mover a una posición, subir, bajar, poner el primero); el orden que se ve es el orden exacto en que se entregan al soltar; gestionar la cola no envía nada al agente más allá del listado.
- Verificar: `npm test` y sesión real: editar y borrar un mensaje retenido y comprobarlo en el listado.
- Depende de: F1-T6
- Verificado: `npm test` → 68 pass, 0 fail; `npm run lint` → 21 modules checked, 0 failed; sesión real: 3 mensajes retenidos a mitad de turno, `;;edit 1`, `;;rm 2`, `;;top 2` y `;;list` responden con el listado nuevo sin interrumpir, y `/cmc:release` entrega `guava papaya`, el orden del último listado
- Cumple: control total de lo retenido: se ve, se corrige, se descarta y se decide qué va primero antes de enviarlo, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/008-f2-t1-gestionar-la-cola.md
- Notas: la gestión va por palabras de control (`;;list`, `;;edit`, `;;rm`, `;;move`…), no por argumentos de `/cmc:queue` (D-011); `/cmc:queue` solo lista. Archivos extra: lib/control.mjs, lib/queue-view.mjs.

### F2-T2 · Soltar de forma selectiva y en modo «ya»  [M] [done]
- Para qué: enviar solo un mensaje, o hacerlo llegar en el siguiente paso sin esperar al final.
- Skill: `code-quality §references/errors-logging "No tragar errores"`
- Archivos: hooks/tool-release.mjs, hooks/hooks.json, lib/release.mjs, commands/release.md, test/release.test.mjs
- Hecho cuando: `/cmc:release 2` entrega solo ese mensaje; `;;now` (o `cmc release --now` desde otra terminal) marca la cola para entregarse en el siguiente paso del agente por el mecanismo fijado en el ADR 001; `;;end` la deja para el final del turno; cada mensaje se entrega una sola vez.
- Verificar: `npm test` y sesión real con una tarea de varios pasos: el mensaje llega entre dos herramientas.
- Depende de: F2-T1
- Verificado: `npm test` → 85 pass, 0 fail; `npm run lint` → 23 modules checked, 0 failed; sesiones reales: `;;now 2` a mitad de turno → `step1, step2, step3 — mango` y el otro mensaje sigue retenido; `;;now` en reposo → `papaya`; `cmc release --now` desde fuera a mitad de turno → `step1, step2, step3 — guava`; cola vacía al final
- Cumple: se puede enviar solo un mensaje y hacerlo llegar en el siguiente paso del agente sin esperar al final, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/009-f2-t2-soltar-selectivo-y-ya.md
- Notas: la selección va por palabras de control (`;;now N`, `;;end N`), no por `/cmc:release 2` (D-011). `cmc release --now` usa `PostToolUse` y, si no hay más pasos, el fin de turno. Archivo extra: hooks/tool-release.mjs; la lógica vive en lib/release.mjs.

### F2-T3 · Escribir desde otra terminal con la CLI `cmc`  [M] [done]
- Para qué: retener mensajes sin tocar el prompt de Claude Code (y plan B si S2 falla).
- Skill: `code-quality §references/security-owasp "Validación en servidor"`
- Archivos: bin/cmc.mjs, lib/sessions.mjs, hooks/session-register.mjs, test/sessions.test.mjs
- Hecho cuando: un hook `SessionStart` registra la sesión (id, carpeta, última actividad); `cmc hold "texto"` desde otra terminal la encuentra por carpeta y encola; con varias sesiones en la misma carpeta, pide elegir; sin sesión activa, lo dice y no guarda nada.
- Verificar: `npm test` y prueba real con dos terminales.
- Depende de: F2-T1
- Verificado: `npm test` → 104 pass, 0 fail; `npm run lint` → 26 modules checked, 0 failed; prueba real con la CLI lanzada como segunda terminal en la carpeta de la sesión, sin id ni directorio de datos: `cmc hold reply with the word guava` → `Held (1 queued).`, el agente responde `step1, step2, step3` y tras `/cmc:release` responde `guava`; al cerrar, `cmc sessions --all` la muestra `closed`
- Cumple: se retienen mensajes sin tocar el prompt de Claude Code, desde otra terminal, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/010-f2-t3-cli-desde-otra-terminal.md
- Notas: con varias sesiones en la carpeta la CLI las lista y pide `--session <id>` (no hay selector interactivo). El hook registra también `SessionEnd`. Comando extra: `cmc sessions`.

### F2-T4 · Mostrar el indicador de mensajes retenidos  [M] [done]
- Para qué: saber de un vistazo que hay mensajes esperando.
- Skill: `plugin-authoring` (mods: banda o línea de estado) — skill de Claude Code, no de Senzu
- Archivos: mods/ o statusline/cmc-status.mjs (según lo que permita el sistema de mods), README.md
- Hecho cuando: se ve «✉ 2 held» (y nada cuando la cola está vacía), actualizado al retener y al soltar; si un plugin no puede aportar la línea de estado, queda documentado cómo activarla en `settings.json`.
- Verificar: sesión real: captura con 0, 1 y 2 mensajes retenidos.
- Depende de: F2-T1
- Verificado: `npm test` → 109 pass, 0 fail (el módulo, con un motor de pega, pone `✉ 1 held`, `✉ 2 held` y lo quita al vaciar); `claude plugin validate .` lista `./indicator.mjs hooks: session.start` y sus llamadas; registro de depuración de una sesión real: `hooks module cmc@inline loaded … events: session.start` y lectura por segundo de la cola de la sesión. Captura en pantalla: no aplica desde el agente (no ve la interfaz interactiva); queda como fila B6 del guion de F1-T6b
- Cumple: con mensajes retenidos se ve `✉ N held` bajo el prompt y desaparece al vaciar la cola, que era el «Para qué»; falta que Peterson lo vea pintado (B6)
- Devlog: senzu/devlog/2026-11-21/011-f2-t4-indicador.md
- Notas: es un módulo de hooks (`hooks/indicator.mjs`, D-014), no `mods/` ni `statusline/`: un plugin sí puede aportar la línea de estado, así que no hace falta documentar ajuste manual.

### F2-T5 · Conservar la cola tras reiniciar, reanudar o compactar  [S] [done]
- Para qué: no perder mensajes retenidos si se cierra la terminal.
- Skill: `code-quality §references/testing "Qué testear y qué no"`
- Archivos: lib/sessions.mjs, hooks/session-register.mjs, test/persistence.test.mjs
- Hecho cuando: al reanudar una sesión (`--resume`, `--continue`) la cola sigue ahí y se avisa de cuántos hay; las colas de sesiones de más de N días se limpian.
- Verificar: `npm test` y prueba real: retener, cerrar, `claude --continue`, soltar.
- Depende de: F2-T3
- Verificado: `npm test` → 117 pass, 0 fail; prueba real: 2 mensajes retenidos, proceso cerrado, `claude -p /cmc:release --continue` reanuda la misma sesión (`21ac41be…`), el hook devuelve `cmc: 2 held message(s) are waiting in this session` y el agente responde `guava mango`
- Cumple: cerrar la terminal no pierde los mensajes retenidos: siguen ahí al reanudar y se avisa, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/012-f2-t5-cola-tras-reanudar.md
- Notas: retención de 30 días (D-015), configurable en F4-T1. La lógica quedó en lib/sessions.mjs (ya existía de F2-T3).

## F3 — Derivar a otro agente

### F3-T1 · Comprobar el fork de sesión a mitad de turno en Windows  [S] [done]
- Para qué: saber si el segundo agente puede heredar el contexto mientras el principal sigue trabajando.
- Skill: sin skill: experimento
- Archivos: spike/fork-test.mjs, senzu/arquitectura/adr/002-derivacion-y-contexto.md
- Hecho cuando: el ADR responde con evidencia a (a) ¿`claude -p --resume <id> --fork-session` arranca con la sesión origen a mitad de turno y no la altera?, (b) ¿qué ve el fork si el transcript acaba en una llamada a herramienta sin resultado?, (c) ¿cómo se lanza desacoplado en Windows y sobrevive al hook?, (d) ¿qué flags hay que volver a pasar (`--plugin-dir`, permisos, `--worktree`)?, (e) coste en tokens del fork frente a un paquete de contexto; y fija el modo por defecto.
- Verificar: salida de las pruebas pegada en el ADR.
- Depende de: F2-T5
- Verificado: `node spike/fork-test.mjs` → cuatro forks lanzados con el origen a mitad del paso 2: todos responden con el nombre en clave del fichero leído por el origen y «step1 finished, step2 interrupted»; id de sesión distinto; el origen termina `HERON — step1, step2, step3`; el desacoplado acaba tras salir su lanzador; `git branch` muestra `worktree-cmc-spike-fork`; coste fork 45 767 tokens / 0,00089 $ frente a paquete 25 109 / 0,00174 $
- Cumple: ya se sabe que el segundo agente puede heredar el contexto mientras el principal sigue trabajando, sin alterarlo, que era el «Para qué»; diseño fijado en el ADR 002
- Devlog: senzu/devlog/2026-11-21/013-f3-t1-fork-a-mitad-de-turno.md
- Notas: S4 confirmado. Modo por defecto: fork (D-016). El worktree lo crea `--worktree` de Claude Code (D-017), lo que simplifica F3-T3. Una ejecución válida, solo Windows.

### F3-T2 · Implementar el lanzador de agentes derivados  [M] [done]
- Para qué: arrancar el segundo agente sin bloquear ni interrumpir al principal.
- Skill: `code-quality §references/security-owasp "Inyección (SQL, comandos, plantillas)"` + `code-quality §references/jobs-and-queues "Anatomía de un job bien hecho"`
- Archivos: lib/dispatch.mjs, lib/agents-registry.mjs, test/dispatch.test.mjs
- Hecho cuando: `dispatch(tarea, sesión)` lanza `claude -p` desacoplado con argumentos en array (sin shell), salida `stream-json` a un log por agente y ficha en el registro (id, pid, tarea, estado, inicio); permisos `acceptEdits` con lista de herramientas configurable, nunca `bypassPermissions`; el estado pasa a `terminado` o `fallido` con su código de salida; cancelar mata el proceso.
- Verificar: `npm test` con un ejecutable falso en lugar de `claude`; prueba real con una tarea de solo lectura.
- Depende de: F3-T1
- Verificado: `npm test` → 146 pass, 0 fail, seis veces seguidas (con ejecutable de pega: termina, falla, resultado de error, ejecutable inexistente, cancelación, texto hostil por stdin); `npm run lint` → 36 modules checked, 0 failed; prueba real de solo lectura: `dispatched b901043e in 30 ms`, `state=finished exit=0 after 3.6 s`, resumen «The project codename is HERON…» (lo sabía por la sesión origen)
- Cumple: el segundo agente arranca sin bloquear ni interrumpir al principal (el lanzador vuelve en 30 ms), que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/015-f3-t2-lanzador-de-agentes.md
- Notas: supervisor desacoplado por agente (D-018). Archivo extra: lib/agent-runner.mjs, test-support/fake-claude.mjs. Cancelación solo probada en Windows.

### F3-T3 · Aislar al agente derivado en un worktree  [M] [done]
- Para qué: que dos agentes a la vez no pisen los mismos archivos.
- Skill: `code-quality §references/git-and-reviews "Ramas cortas"`
- Archivos: lib/worktree.mjs, lib/dispatch.mjs, test/worktree.test.mjs
- Hecho cuando: con repositorio git, el agente trabaja en un worktree y una rama propios (`cmc/<id>`); sin git, trabaja en la misma carpeta y se avisa; un worktree sin cambios se limpia al terminar y uno con cambios se conserva y se informa de la rama.
- Verificar: `npm test` sobre un repositorio temporal; prueba real: el derivado edita un archivo y el principal no lo ve cambiar.
- Depende de: F3-T2
- Verificado: `npm test` → 161 pass, 0 fail (tres veces); `npx tsc --noEmit` → 0; prueba real en un repositorio temporal: el derivado que edita termina con `branch=worktree-cmc-792d31cd changedFiles=["notes.txt"]`, su cambio está en el worktree y `notes.txt` de la carpeta principal sigue igual; el que solo lee termina con `worktreePath=null` y `git worktree list` ya no lo muestra
- Cumple: dos agentes a la vez no pisan los mismos archivos: el derivado edita en su worktree y el principal no ve cambiar nada, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/021-f3-t3-worktree-del-derivado.md
- Notas: el worktree lo crea `--worktree` de Claude Code (D-017); se levanta el bloqueo que deja su sesión terminada (D-027). Solo probado en Windows. `.claude/worktrees/` queda dentro del repositorio del usuario.

### F3-T4 · Construir el paquete de contexto ligero  [M] [done]
- Para qué: derivar tareas pequeñas sin pagar el historial entero (y plan B si S4 falla).
- Skill: `code-quality §references/llm-apps "5. Costes y límites"` + `code-quality §references/llm-apps "6. Seguridad"`
- Archivos: lib/context-pack.mjs, test/context-pack.test.mjs, test/fixtures/transcript.jsonl
- Hecho cuando: a partir del transcript se obtiene un paquete acotado (petición original, últimos N intercambios, archivos tocados, carpeta y rama) que se pasa al agente nuevo; un transcript con formato desconocido no rompe: degrada a «tarea + carpeta» y lo avisa; `--modo fork|paquete` elige.
- Verificar: `npm test` con transcripts de ejemplo, incluido uno malformado.
- Depende de: F3-T2
- Verificado: `npm test` → 170 pass, 0 fail (transcript de ejemplo, de formato desconocido, vacío e inexistente: los tres últimos degradan a «tarea + carpeta» con aviso); `npx tsc --noEmit` → 0; sobre un transcript real de Claude Code genera un prompt de 938 caracteres con carpeta, rama, primera petición, intercambio y ficheros leídos
- Cumple: una tarea pequeña se puede derivar con un resumen acotado en vez de todo el historial, que era el «Para qué»; y es el camino disponible cuando el fork no conviene
- Devlog: senzu/devlog/2026-11-21/022-f3-t4-paquete-de-contexto.md
- Notas: sin agente real en modo paquete todavía (F3-T5). El respaldo automático fork→paquete no está hecho: el modo se elige.

### F3-T5 · Derivar desde el prompt y ver los agentes  [M] [done]
- Para qué: mandar una tarea al segundo agente con un gesto y saber cómo va.
- Skill: `code-quality §references/errors-logging "Mensajes accionables"`
- Archivos: hooks/prompt-capture.mjs, commands/dispatch.md, commands/agents.md, bin/cmc.mjs (`dispatch`, `agents`, `log`, `cancel`), test/prompt-dispatch.test.mjs
- Hecho cuando: `>> tarea` a mitad de turno lanza el agente sin que el principal lo vea ni se interrumpa; `/cmc:dispatch 2` deriva un mensaje ya retenido; `/cmc:agents` lista estado, duración y rama; `cmc log <id>` muestra su salida y `cmc cancel <id>` lo detiene; el indicador de F2-T4 muestra los agentes activos.
- Verificar: `npm test` y sesión real: el principal y el derivado trabajando a la vez, con captura del listado.
- Depende de: F3-T3, F3-T4
- Verificado: `npm test` → 192 pass, 0 fail (tres veces); `npx tsc --noEmit` → 0; sesión real: `>>` a mitad del paso 1 → recibo «Dispatched to agent df6a6755…», el principal sigue con los pasos 2 y 3, `;;agents` lo lista `running 15s same folder`; el derivado responde «heron»; `>> --pack` real responde correctamente desde el resumen; `active.json` vuelve a 0
- Cumple: una tarea se manda al segundo agente con un gesto, sin que el principal la vea ni se interrumpa, y se ve cómo va (`;;agents`, `;;log`, indicador), que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/023-f3-t5-derivar-desde-el-prompt.md
- Notas: `;;dispatch N` en lugar de `/cmc:dispatch N` (D-028). Corregido además: la respuesta del derivado se perdía si los hooks Stop del usuario lo hacían seguir. Pendiente: las sesiones de los derivados aparecen como abiertas para la CLI. Indicador con agentes sin ver en pantalla (B6).

### F3-T6 · Devolver el resultado del agente derivado a la cola  [M] [done]
- Para qué: que el trabajo del segundo agente vuelva a la conversación cuando tú quieras.
- Skill: `code-quality §references/security-owasp "Prompt injection y seguridad de LLM"`
- Archivos: lib/dispatch.mjs, lib/queue.mjs, test/dispatch-return.test.mjs
- Hecho cuando: al terminar, el resumen final del derivado (más la rama y los archivos cambiados) entra en la cola como mensaje retenido (modo `held`, el de por defecto), marcado como salida de otro agente y no como instrucción del usuario; si falla, entra el error con la ruta del log.
- Verificar: `npm test` y sesión real: derivar, esperar, `/cmc:queue` muestra el resultado, `/cmc:release` lo entrega.
- Depende de: F3-T5
- Verificado: `npm test` → 208 pass, 0 fail (tres veces); sesión real: tras `>>` a mitad de turno, `cmc list` muestra `(from agent e157ff93) Agent e157ff93 finished the task …` y `/cmc:release` lo entrega; el principal responde «The dispatched agent (e157ff93) replied "heron"…»; cola vacía después
- Cumple: el trabajo del derivado vuelve a la conversación cuando el usuario quiere, como mensaje retenido marcado como salida de otro agente, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/024-f3-t6-t7-resultado-del-derivado.md
- Notas: hecha junto con F3-T7 en un solo commit. Un agente cancelado no deja resultado.

### F3-T7 · Añadir el retorno automático como ajuste  [S] [done]
- Para qué: poder elegir que el resultado del segundo agente llegue solo al principal, sin soltarlo a mano.
- Skill: `code-quality §references/security-owasp "Prompt injection y seguridad de LLM"`
- Archivos: lib/dispatch.mjs, lib/release.mjs, lib/config.mjs, test/dispatch-return.test.mjs
- Hecho cuando: el ajuste `dispatch.return` admite `held` (por defecto) y `auto`; con `auto` el resultado se entrega al agente principal en su siguiente paso o, si está parado, al terminar su turno, por el mismo mecanismo que el modo «ya»; se puede fijar por derivación (`>> --auto tarea`); el resultado sigue marcado como salida de otro agente.
- Verificar: `npm test` y sesión real: derivar con `auto` y comprobar que el principal recibe el resultado sin `/cmc:release`.
- Depende de: F3-T6
- Verificado: `npm test` → 208 pass (8 tests del modo automático); sesión real con `>> --auto`: al terminar el turno del principal llega «[cmc] Results of the agent the user dispatched with ">> --auto"… Report of dispatched agent 68e7467a…» sin `/cmc:release`
- Cumple: se puede elegir que el resultado llegue solo al principal, sin soltarlo a mano, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/024-f3-t6-t7-resultado-del-derivado.md
- Notas: se entrega solo al terminar un turno, no a mitad (D-029). El valor por defecto configurable (`dispatch.return`) queda para F4-T1, que crea el fichero de configuración.

## F4 — Entrega

### F4-T1 · Añadir la configuración del plugin  [S] [done]
- Para qué: adaptar prefijos, modo de entrega y permisos sin tocar código.
- Skill: `code-quality §references/typescript "Validación en los bordes con zod"` (el principio, con validación a mano: sin dependencias)
- Archivos: lib/config.mjs, config.default.json, test/config.test.mjs
- Hecho cuando: prefijos, modo de entrega por defecto, modo de contexto, permisos y herramientas del derivado y días de retención se leen de un fichero de usuario validado; un valor inválido cae al valor por defecto con aviso.
- Verificar: `npm test`.
- Depende de: F3-T6
- Verificado: `npm test` → 228 pass, 0 fail (tres veces; 17 tests de configuración); `npx tsc --noEmit` → 0; sesión real con `{"holdPrefix": "%%"}`: `%% …` se retiene, `%%end` arma la entrega y el agente recibe «… with "%%end": 1. reply with the word quince» y responde `quince`
- Cumple: prefijos, valores por defecto de la derivación, permisos y herramientas del derivado y días de retención se cambian sin tocar código, y un valor erróneo nunca rompe el plugin, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/026-f4-t1-configuracion.md
- Notas: `config.json` en el directorio de datos (D-031), con `cmc config` e `init`. Corregido de paso: una lista JSON pasaba por objeto válido.

### F4-T2 · Revisar la seguridad del plugin  [M] [done]
- Para qué: que un mensaje o un transcript no puedan ejecutar nada por su cuenta.
- Skill: `security` (pasada OWASP con evidencia, `/seguridad`)
- Archivos: senzu/seguridad/ (informe), correcciones donde toque
- Hecho cuando: revisados inyección de comandos en el lanzador, rutas (ids de sesión como nombres de carpeta), permisos del derivado, contenido de terceros tratado como datos y logs sin secretos; hallazgos corregidos o aceptados por escrito.
- Verificar: informe con evidencia por hallazgo; `npm test` en verde tras las correcciones.
- Depende de: F4-T1
- Verificado: informe `senzu/seguridad/2026-11-21-revision-cmc.md` con evidencia por hallazgo; `npm test` → 241 pass, 0 fail (13 tests de seguridad, uno por arreglo); `npm audit` → 0; prueba real: el derivado no tiene Bash («NO-BASH-TOOL»), y el worktree limpio se sigue retirando con `--ignored`
- Cumple: ni un mensaje ni un transcript pueden ejecutar nada por su cuenta ni salirse de su sitio, y el agente derivado no tiene más permisos de los configurados, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/027-f4-t2-revision-de-seguridad.md
- Notas: 3 medios y 5 bajos corregidos; S1 y S2 corregidas, S3 aceptada. Contrapartida: restringir herramientas encarece el fork (D-032, ajuste `dispatch.restrictTools`).

### F4-T3 · Documentar e instalar desde un marketplace local  [M] [done]
- Para qué: instalarlo en cualquier proyecto y que otra persona sepa usarlo.
- Skill: sin skill: README (qué hace, instalación, uso, límites conocidos, cómo probar)
- Archivos: README.md, .claude-plugin/marketplace.json, CHANGELOG.md, LICENSE
- Hecho cuando: el README cubre instalación, los cuatro comandos, los prefijos, la CLI, la configuración y los límites (lo no documentado por Claude Code); el plugin se instala desde el marketplace local en un proyecto limpio y pasa el guion de F1-T6 y el de derivación.
- Verificar: `claude plugin validate .`; instalación en una carpeta nueva y guiones pasados, con resultado en el devlog.
- Depende de: F4-T2
- Verificado: instalación real con `marketplace add` + `install cmc@r3v3rs3 --scope project` en un proyecto git limpio; guion de F1-T6 (retener, `/cmc:release` → `mango`, `;;end` → `papaya`) y derivación (worktree propio, carpeta principal intacta, resultado en la cola y entregado) pasados con el plugin instalado; `claude plugin validate .` → Validation passed; desinstalado después
- Cumple: el plugin se instala en cualquier proyecto desde el marketplace y el README explica instalación, uso, CLI, ajustes, límites y seguridad, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/028-f4-t3-documentar-e-instalar.md
- Notas: licencia MIT elegida por el agente. Sin icono (solo lo pide el directorio público). Los hooks globales del usuario escriben en el worktree del derivado y hacen que se conserve siempre: documentado.

---

## F5 — Panel de control

Entregable: `/cmc` abre un panel junto al chat con lo retenido y los agentes, que se actualiza solo y se maneja con el ratón (y con el teclado). Todo lo que hace pasa por la CLI `cmc`, así que el núcleo, el cerrojo y las reglas son los mismos que con `;;` y `>>`. Sin panel (`claude -p`, una terminal estrecha, una versión sin el motor) todo sigue funcionando como hoy.

### F5-T1 · Prueba del panel: se abre, responde al ratón y se actualiza solo  [S] [done]
- Para qué: antes de construirlo hay que ver en el terminal de Peterson que un panel del motor se abre junto al chat, que un clic en un botón actúa y que se repinta cuando cambia la cola.
- Skill: `plugin-authoring` (`examples/pane.tsx`, `reference.md §ui.render`; en los tipos: `PaneOpenArgs`, `ButtonProps`, `atom`/`update`)
- Archivos: plugins/cmc/hooks/panel.tsx, plugins/cmc/hooks/module.ts, plugins/cmc/types/index.d.ts, plugins/cmc/.claude-plugin/plugin.json
- Hecho cuando: `/cmc` abre un panel con el número de mensajes retenidos y un botón «Send all»; un clic lo envía; retener otro mensaje lo repinta en menos de un segundo; con la terminal estrecha (menos de 110 columnas) se sabe qué pasa y está documentado. Con el panel cerrado, la sesión se comporta y se ve igual que antes (no regresión: mismos avisos, mismo tiempo de los hooks).
- Verificar: `claude plugin validate ./plugins/cmc`; `tsc`; test del panel con `claude plugin test`; guion corto que pasa Peterson (clic y repintado) con captura.
- Depende de: —
- Verificado: prueba de Peterson en su terminal (capturas): el panel se abre junto al chat, se repinta solo, los clics actúan (Delete, Send, To subagent: el subagente e3a6971f arrancó con la conversación entera y su resultado volvió)
- Cumple: el panel del motor sirve para la interfaz de control, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/032-f5-t1-primer-panel.md, 033, 034
- Notas: Send con el agente trabajando no llegó a entrar en el turno: las sesiones vivas se direccionan por nombre, no por id (ADR 003 §3). Peterson: «la UI debe ser el centro neurálgico»: lo recoge F5-T2.

### F5-T2 · Diseñar el panel  [S] [done]
- Para qué: decidir disposición, estados y uso con ratón y teclado antes de construir, para que sea intuitivo (petición de Peterson).
- Skill: `plugin-authoring` (`reference.md §ui.render`: elementos de la terminal `Box`, `Text`, `Button`, `Input`, `Select`, `Progress`). Sin `ui-ux-pro-max`: no es una interfaz web, es una terminal con los elementos del motor.
- Archivos: senzu/arquitectura/adr/003-panel-de-control.md
- Hecho cuando: ADR con la maqueta en texto del panel (sección de mensajes, sección de agentes, barra de acciones), estados vacío, cargando y error, qué hace cada botón, atajos de teclado (`hotkey`), anchos estrecho y ancho, cuándo se abre solo y cuándo no, y de dónde lee los datos (ficheros del núcleo o la CLI); revisado con Peterson.
- Verificar: Peterson aprueba la maqueta.
- Depende de: F5-T1
- Verificado: Peterson aprobó la maqueta del ADR 003 («sí lo apruebo»), con dos añadidos: conversación por subagente (§6) y Send como Ctrl+Enter (§3, D-038)
- Cumple: diseño cerrado antes de construir, con lo que Peterson pidió que fuera intuitivo, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/035-f5-t2-diseno-del-panel.md
- Notas: colores pendientes de que Peterson elija paleta.

### F5-T3 · Sección de mensajes  [M] [todo]
- Para qué: gestionar lo retenido con el ratón: lo que hoy son `/held`, `;;edit`, `;;rm`, `;;top`… en un solo sitio.
- Skill: `plugin-authoring` (`ui.render` de `Pane`, `Button`, `Input`) + `code-quality §references/typescript`
- Archivos: plugins/cmc/hooks/panel.tsx, plugins/cmc/hooks/panel-messages.tsx, plugins/cmc/bin/cmc.ts, test/panel.test.tsx
- Hecho cuando: cada mensaje en una fila con su texto, su origen (tú o un agente) y cuándo saldrá (al acabar el turno o retenido); botones Send · Edit · Delete · ↑ · ↓ · To agent; «Send all» y «Clear» arriba; Edit cambia el texto en el propio panel (`Input`) sin perder su sitio; todo se repinta solo; ningún mensaje se pierde si una acción falla (D-034).
- Verificar: `npm test` (tests del panel con el motor simulado); `claude plugin test ./plugins/cmc`; guion de Peterson con captura.
- Depende de: F5-T2

### F5-T4 · Sección de agentes  [M] [todo]
- Para qué: ver de un vistazo qué hace cada agente derivado y actuar sobre él sin comandos.
- Skill: `plugin-authoring` (`ui.render`, `Button`, `Progress`, `$.ui.copy`) + `code-quality §references/typescript`
- Archivos: plugins/cmc/hooks/panel-agents.tsx, plugins/cmc/lib/agents-view.ts, plugins/cmc/bin/cmc.ts, test/panel.test.tsx
- Hecho cuando: cada agente con su tarea, estado (trabajando, terminado, fallido, cancelado, perdido), tiempo, rama y ficheros cambiados; botones Log (se despliega en el panel), Stop, Send result (su resultado al agente principal), Copy path (carpeta del worktree); se repinta al cambiar de estado.
- Verificar: `npm test`; guion de Peterson con un agente real.
- Depende de: F5-T3

### F5-T5 · Nueva tarea para un agente desde el panel  [S] [todo]
- Para qué: lanzar un agente sin recordar `>>` ni sus opciones.
- Skill: `plugin-authoring` (`Input`, `Select`) + `code-quality §references/typescript`
- Archivos: plugins/cmc/hooks/panel-agents.tsx, test/panel.test.tsx
- Hecho cuando: un campo de texto y un botón «Start agent»; contexto (conversación completa o resumen) y retorno (retenido o automático) elegibles con su valor por defecto de la configuración; el agente aparece en la lista al momento.
- Verificar: `npm test`; guion de Peterson.
- Depende de: F5-T4

### F5-T6 · Escribir a un agente  [M] [todo]
- Para qué: seguir la conversación con un agente derivado: corregirle, pedirle más o preguntarle por su resultado.
- Skill: `code-quality §references/typescript` + `plugin-authoring` (`Input`)
- Archivos: plugins/cmc/lib/dispatch.ts, plugins/cmc/lib/agent-runner.ts, plugins/cmc/lib/agent-control.ts, plugins/cmc/bin/cmc.ts, plugins/cmc/hooks/panel-agents.tsx, test/agent-tell.test.ts
- Hecho cuando: `cmc tell <id> <texto>`, `;;tell <id> <texto>` y un campo en la fila del agente; si el agente ha terminado, se reanuda su sesión (`--resume <agentSessionId>`) en su mismo worktree con el texto; si sigue trabajando, el texto espera y sale cuando acaba (nada a mitad de turno, D-030); su nueva respuesta vuelve como resultado, con el mismo retorno; los mismos permisos y herramientas que al derivar.
- Verificar: `npm test` (con el claude simulado); sesión real: derivar, escribirle, ver la segunda respuesta en la cola y en el panel.
- Depende de: F5-T4

### F5-T7 · Pasar el resultado de un agente a otro  [S] [todo]
- Para qué: encadenar agentes (uno investiga, otro implementa) sin copiar y pegar.
- Skill: `code-quality §references/typescript` + `plugin-authoring`
- Archivos: plugins/cmc/lib/agent-control.ts, plugins/cmc/bin/cmc.ts, plugins/cmc/hooks/panel-agents.tsx, test/agent-tell.test.ts
- Hecho cuando: en la fila de un resultado, «To agent…» lo manda a un agente existente (como F5-T6) o a uno nuevo, citado como informe de otro agente, no como orden del usuario (igual que hoy al soltarlo al principal).
- Verificar: `npm test`; sesión real con dos agentes.
- Depende de: F5-T6

### F5-T8 · Abrir, cerrar y convivir con el resto  [S] [todo]
- Para qué: que el panel esté cuando hace falta y no estorbe cuando no.
- Skill: `plugin-authoring` (`PaneOpenArgs`: `focus`, `closeOnEscape`; `$.ui.close`) + `code-quality §references/typescript`
- Archivos: plugins/cmc/hooks/panel.tsx, plugins/cmc/hooks/interface.ts, plugins/cmc/lib/config.ts, test/panel.test.tsx
- Hecho cuando: usa solo mecanismos nativos del motor (panel, botones, diálogo); no regresión: con el panel cerrado o sin motor, `;;`, `/held`, `/send`, `/cmc:release`, `>>` y la CLI funcionan igual y los tests de antes siguen en verde; `/cmc` lo abre y lo cierra; ajuste `panel.autoOpen` (abrirse al retener el primer mensaje o al derivar), por defecto el que decida el ADR; Escape lo cierra; `/held` y los avisos siguen para quien no use el panel; sin panel disponible, `/cmc` dice por qué y sugiere `/held`.
- Verificar: `npm test`; guion de Peterson.
- Depende de: F5-T3

### F5-T9 · Cierre de la fase: documentación y prueba completa  [M] [todo]
- Para qué: que se pueda usar sin preguntarme y quede probado de punta a punta.
- Skill: `code-quality §references/api-design` (documentación de uso) + skill `devlog`
- Archivos: README.md, docs/manual-test.md (parte C: panel), CHANGELOG.md, manifiestos (versión 1.1.0)
- Hecho cuando: README con el panel (captura), `/held`, `/send`, `sendAtEnd` y escribir a agentes; parte C del guion manual; versión 1.1.0; suite, tipos, lint y validación en verde; Peterson pasa la parte C.
- Verificar: `npm test`, `npx tsc --noEmit`, `npm run lint`, `claude plugin validate .`; guion de Peterson.
- Depende de: F5-T5, F5-T7, F5-T8

## Tareas ad hoc (fuera del plan original)

### X-T6 · Lo retenido llega solo al acabar el turno  [S] [done]
- Para qué: Peterson retuvo «di también piña» mientras el agente trabajaba y, al acabar, no llegó: esperaba a un `/send`. «Debería enviarse al final, ya es obvio.» Además, con otro hook Stop continuando el turno (Senzu), cmc no entregaba nada.
- Skill: `code-quality §references/typescript` + experimento con `scripts/e2e.ts`
- Archivos: plugins/cmc/lib/release.ts, plugins/cmc/lib/config.ts, plugins/cmc/lib/capture.ts, plugins/cmc/bin/cmc.ts, plugins/cmc/hooks/interface.ts, test/send-at-end.test.ts
- Hecho cuando: lo retenido mientras el agente trabaja llega al acabar su turno sin ningún comando, con su orden y sus ediciones; `sendAtEnd: false` lo deja retenido; los resultados de agentes siguen su modo de retorno; se entrega aunque otro hook Stop esté continuando el turno.
- Verificar: `npm test`; sesión real con `scripts/e2e.ts --mid`.
- Depende de: —
- Verificado: `npm test` → 282 pass; sesión real: `;; also say the word pineapple` a mitad de turno → aviso «goes to the agent when its turn ends», el agente acaba la tarea y responde «pineapple», cola vacía
- Cumple: lo que escribes mientras trabaja le llega al terminar sin hacer nada más, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/031-x-t6-envio-al-acabar-el-turno.md
- Notas: D-035 y D-036. `/send` con el agente parado ahora envía cuando su comando ha contestado (el motor rechazaba el prompt durante el comando, hipótesis); si falla, muestra el motivo del motor. Pendiente de confirmar en el terminal de Peterson.

### X-T5 · Interfaz interactiva en el motor de plugins: prueba (retener al pulsar Enter, /held, /send)  [M] [doing]
- Para qué: en el terminal interactivo el mensaje retenido volvía a la barra del chat, con un aviso de tres líneas, y no había forma visible de enviarlo, editarlo, borrarlo o derivarlo (prueba de Peterson, F1-T6b).
- Skill: `plugin-authoring` (módulo de hooks: `prompt.submit`, `command.register`/`command.run`, `$.prompt`) + `code-quality §references/typescript`
- Archivos: plugins/cmc/hooks/interface.ts, plugins/cmc/hooks/module.ts, plugins/cmc/hooks/indicator.ts, plugins/cmc/lib/release.ts, plugins/cmc/bin/cmc.ts, test/interface.test.ts
- Hecho cuando: en el terminal interactivo de Peterson, `;; texto` desaparece de la barra con un aviso corto, `/held` y `/send` salen en el autocompletado y funcionan con el agente trabajando, y ningún mensaje se pierde si el envío falla. Con eso se decide construir el resto (/edit, /drop, /move, /agent, panel).
- Verificar: `npm test`; `claude plugin validate ./plugins/cmc`; sesión real sin interfaz (retener, /held, /send); guion interactivo de Peterson.
- Depende de: —

### X-T4 · Decidir qué hacer con el modo «ya» a mitad de turno  [M] [done]
- Para qué: `;;now` y `cmc release --now` con el agente ocupado entregan el mensaje, pero el modelo lo ignora más de la mitad de las veces y el mensaje se pierde de la cola; hoy la función promete más de lo que da.
- Skill: `code-quality §references/llm-apps "6. Seguridad"` + experimento con `scripts/e2e.ts`
- Archivos: plugins/cmc/lib/control.ts, plugins/cmc/lib/release.ts, README.md, senzu/arquitectura/adr/001-captura-y-liberacion.md
- Hecho cuando: medido con el modelo por defecto y con al menos 10 ejecuciones por variante (redacción, canal); y tomada una de estas salidas: (a) una variante fiable, (b) `;;now` a mitad de turno pasa a entregar al terminar el turno, o (c) el mensaje no sale de la cola hasta que el turno acaba y se confirma. README y ADR reflejan lo decidido.
- Verificar: tabla de resultados en el ADR; `npm test`; sesión real del camino elegido.
- Depende de: —
- Verificado: `npm test` → 211 pass (tres veces); sesiones reales: `;;now 2` con el agente ocupado 3 de 3 entregado al final del turno y obedecido, `cmc release` ocupado 3 de 3, `;;now` en reposo 1 de 1 (antes: 5 de 12)
- Cumple: la función ya no promete más de lo que da: lo que se suelta llega siempre y nunca se pierde un mensaje ignorado, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/025-x-t4-now-sin-mitad-de-turno.md
- Notas: salida (b) de la tarjeta (D-030). No se midió con más modelos ni 10 ejecuciones por variante: se quitó la entrega a mitad de turno en vez de buscar una variante fiable.

### X-T3 · Migrar el plugin a TypeScript ejecutado por Node  [M] [done]
- Para qué: Peterson quería el plugin en TypeScript; el agente lo dejó en JavaScript por un malentendido.
- Skill: `code-quality §references/typescript` (tipado estricto, validación en los bordes)
- Archivos: plugins/cmc/**/*.mjs → *.ts, test/**, test-support/**, scripts/**, plugins/cmc/hooks/hooks.json, plugins/cmc/commands/*.md, package.json, tsconfig.json, README.md
- Hecho cuando: todo el código es `.ts` y Node lo ejecuta sin compilar (sin `dist/`); `tsc --noEmit` en modo estricto sin errores; los hooks y los comandos llaman a los `.ts`; la instalación por marketplace sigue copiando solo `plugins/cmc`; el Node mínimo real está comprobado en la documentación y escrito en el README; `/adoptar` vuelto a ejecutar con TypeScript.
- Verificar: `npm test` (los 146 tests), `npm run lint`, `npx tsc --noEmit`, `claude plugin validate`, instalación en configuración aislada y `scripts/e2e`.
- Depende de: —
- Verificado: `npx tsc --noEmit` → exit 0 (de 666 errores a 0); `npm test` → 146 pass, 0 fail; `npm run lint` → 38 modules checked; `verify-build` → PASS lint, types y test; sesión real con los hooks en `.ts` (`mango guava papaya` tras `;;top 2`, `cmc hold` y `;;end`); instalación por marketplace en configuración aislada, con el hook ejecutándose desde la caché
- Cumple: el plugin está en TypeScript, que es lo que Peterson quería, y Node lo ejecuta sin compilar, así que se sigue instalando copiando la carpeta
- Devlog: senzu/devlog/2026-11-21/019-x-t3-migracion-a-typescript.md
- Notas: tipado hecho por dos subagentes y revisado; destapó seis fallos reales, corregidos. Node mínimo 22.18 (documentación). Sin probar: Node 22.18 exacto, macOS y Linux. `spike/` sigue en `.mjs`.
- Notas: desbloqueada el 2026-11-21 (Peterson borró las convenciones selladas). F3-T3 espera a esta tarjeta para no escribir más código en JavaScript.

### X-T2 · Convertir el repositorio en marketplace con el plugin en su carpeta  [S] [done]
- Para qué: instalar `cmc` como quiere Peterson, añadiendo un marketplace y luego el plugin, sin que la instalación arrastre `senzu/`, tests ni configuración del proyecto.
- Skill: sin skill: reestructuración de carpetas y manifiesto
- Archivos: .claude-plugin/marketplace.json, plugins/cmc/**, test/**, scripts/**, package.json, README.md
- Hecho cuando: `claude plugin marketplace add <repo>` y `claude plugin install cmc@r3v3rs3` instalan solo el contenido de `plugins/cmc`; los tests y el script de extremo a extremo siguen en verde con las rutas nuevas.
- Verificar: `npm test`, `claude plugin validate .` y `./plugins/cmc`, instalación en una configuración aislada y `scripts/e2e.mjs`.
- Depende de: —
- Verificado: `npm test` → 146 pass, 0 fail; `claude plugin validate .` → marketplace Validation passed; instalación en configuración aislada: `marketplace add` → `Successfully added marketplace: r3v3rs3`, `install cmc@r3v3rs3` → `Successfully installed plugin`, y en la caché solo hay `.claude-plugin`, `bin`, `commands`, `hooks`, `lib`; `scripts/e2e.mjs` con la ruta nueva entrega `guava`
- Cumple: el plugin se instala añadiendo el marketplace y después el plugin, y la instalación no arrastra nada del proyecto, que era el «Para qué»
- Devlog: senzu/devlog/2026-11-21/016-x-t2-marketplace-y-plugin.md
- Notas: no instalado en la configuración real de Peterson ni probada una sesión con el plugin instalado (solo `--plugin-dir`). Licencia, icono y PATH de la CLI siguen en F4-T3.

### X-T1 · Revisar y corregir la portabilidad entre sistemas operativos  [M] [done]
- Para qué: que el plugin funcione igual en Windows, macOS y Linux; Peterson lo pidió el 2026-11-21 («cuidado con las barras y las rutas»).
- Skill: sin skill: revisión de rutas, renombrados y permisos (subagente)
- Archivos: lib/atomic-write.mjs, lib/queue.mjs, lib/session-state.mjs, lib/sessions.mjs, scripts/e2e.mjs, tests
- Hecho cuando: los renombrados atómicos reintentan en Windows; las carpetas se comparan por ruta real y sin distinguir mayúsculas donde toca; el cerrojo no confunde un error de permisos con «ocupado» fuera de Windows; `scripts/e2e.mjs` respeta `CLAUDE_CONFIG_DIR` y `CLAUDE_BIN`; los ejecutables llevan el bit de ejecución en git; revisado el resto del código en busca de supuestos de un solo sistema.
- Verificar: `npm test` y `npm run lint`; lista de lo que no se ha podido ejecutar fuera de Windows.
- Depende de: —
- Verificado: `npm test` → 135 pass, 0 fail (18 nuevos); `npm run lint` → 31 modules checked, 0 failed; `git ls-files -s` → 100755 en bin/cmc.mjs y los cuatro hooks; sesión real con hooks, CLI y `;;end` → `guava mango`. No ejecutado en macOS ni Linux: las ramas de esas plataformas solo están cubiertas con la plataforma inyectada en los tests
- Cumple: corregidos los supuestos de un solo sistema que se encontraron (renombrados, rutas reales, cerrojo, stdin), que era el «Para qué»; falta la prueba real en macOS y Linux
- Devlog: senzu/devlog/2026-11-21/014-x-t1-portabilidad-multi-os.md
- Notas: correcciones hechas por un subagente y revisadas. Extra: lectura de stdin de los hooks, fichero suelto en sessions/, renombrado de spike/fork-test.mjs a fork-probe.mjs. Pendiente: suite en macOS y Linux (CI en F4).

## Cambios al plan
| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-11-21 | Plan creado | — |
| 2026-11-21 | F2-T1 ampliada: el usuario elige el orden de entrega de los mensajes retenidos (además de editar y borrar) | Petición de Peterson: «total control» |
| 2026-11-21 | Producto en inglés (comandos `/cmc:release`, `/cmc:queue`, `/cmc:dispatch`, `/cmc:agents`); devlog en castellano | Decisión de Peterson |
| 2026-11-21 | Q2 resuelta: el derivado edita solo en su worktree, sin permisos sin límite. Q3 resuelta: retorno retenido primero; se añade F3-T7 (retorno automático como ajuste) | Decisión de Peterson |
| 2026-11-21 | `git init` adelantado de F1-T2 al inicio de la sesión | Petición de Peterson: «inicia el repo» |
| 2026-11-21 | ADR 001: `/cmc:release` a mitad de turno actúa al terminar el turno; el modo «ya» de F2-T2 se hace con el prompt `;;now` y `additionalContext` de `UserPromptSubmit` | Evidencia de F1-T1 |
| 2026-11-21 | F1-T6 dividida: la parte interactiva del guion pasa a F1-T6b (bloqueada, la ejecuta Peterson) | El agente no puede conducir la interfaz interactiva |
| 2026-11-21 | `;;end` adelantado de F2-T2 a F1-T5 (D-010) | Sin él no había forma de activar la entrega al terminar a mitad de turno |
| 2026-11-21 | Tarjeta ad hoc X-T1: portabilidad entre sistemas operativos | Petición de Peterson: el plugin debe ser multi-OS |
| 2026-11-21 | ADR 002: F3-T3 usa el `--worktree` de Claude Code en vez de crear el worktree a mano | Evidencia de F3-T1 |
| 2026-11-21 | Tarjeta ad hoc X-T2: el repositorio pasa a ser un marketplace y el plugin a `plugins/cmc/`; adelanta parte de F4-T3 | Peterson: quería instalación por marketplace y luego plugin |
| 2026-11-21 | Nueva fase F5 (adaptadores para otros agentes), sin tarjetas todavía: se planifica cuando Claude Code esté terminado | Decisión de Peterson: «primero Claude y luego, cuando esté perfecto, pasamos» |
| 2026-11-21 | El lenguaje queda en JavaScript sobre Node, sin TypeScript (D-022) | Decisión de Peterson |
| 2026-11-21 | Tarjeta ad hoc X-T3: migración a TypeScript; D-022 sustituida por D-024; F3-T3 espera | Peterson: «quería TypeScript» |
| 2026-11-21 | Tarjeta ad hoc X-T4: el modo «ya» a mitad de turno no es fiable (5 de 12) | Batería de comparación JavaScript/TypeScript |
| 2026-11-21 | Q1 resuelta: el plugin se llama `cmc` (Claude Message Control); prefijos `;;` y `>>` por defecto, configurables en F4-T1 | Decisión de Peterson |
| 2026-11-21 | X-T5 y X-T6: interfaz en el motor (retener al pulsar Enter, `/held`, `/send`) y lo retenido llega solo al acabar el turno (D-035) | Prueba interactiva de Peterson |
| 2026-11-21 | Nueva fase F5: panel de control con ratón, agentes y mensajes a agentes; los adaptadores pasan a F6. Escribir a un agente entra en el alcance (le llega al acabar su turno); la conversación en tiempo real entre agentes que trabajan sigue fuera | Petición de Peterson: «haz el panel, eso es lo que nos aportaría, además de poder comunicar los agentes» |

## Riesgos y bloqueos
| Riesgo / bloqueo | Impacto | Mitigación / qué se necesita | Estado |
|---|---|---|---|
| `UserPromptSubmit` no se dispara (o interrumpe) con mensajes de mitad de turno: no documentado | Alto: es la captura principal | F1-T1 lo comprueba primero; plan B: captura a mitad de turno solo con la CLI `cmc` desde otra terminal (F2-T3 sube a F1) | Abierto |
| El fork de una sesión a mitad de turno falla o hereda un estado incompleto | Alto para F3 | F3-T1 lo comprobó: funciona y ve la herramienta pendiente como interrumpida (ADR 002) | Mitigado |
| El formato del transcript no está documentado y puede cambiar | Medio | Solo lo lee el paquete de contexto, con degradación a «tarea + carpeta» y test con transcript malformado | Abierto |
| El fork hereda todo el historial: coste alto de tokens por derivación | Medio | Medido en F3-T1: en una sesión corta sale más barato que el paquete por la caché; crece con el historial. Modo paquete disponible; se avisa al derivar | Mitigado |
| Agente derivado sin supervisión con permisos de edición | Alto | Worktree aislado, `acceptEdits` como máximo por defecto, lista de herramientas, nunca `bypassPermissions`; revisión en F4-T2 | Abierto |
| Tope de 8 continuaciones seguidas del hook `Stop` | Bajo | Entregar toda la cola en una sola continuación | Abierto |
| Un plugin quizá no pueda aportar línea de estado ni atajos de teclado | Bajo | F2-T4 usa el sistema de mods o documenta el ajuste manual en `settings.json` | Abierto |
| El modo «ya» a mitad de turno depende de cómo pondere el modelo un texto que llega por un hook | Alto | Resuelto en X-T4: ya no se entrega nada a mitad de turno (D-030) | Cerrado |
| El motor de plugins está en acceso anticipado: su API puede cambiar entre versiones | Alto para F5 | Todo lo que hace el panel pasa por la CLI y el núcleo; sin panel, `;;`, `/cmc:release` y la CLI siguen funcionando; validar con cada versión de Claude Code | Abierto |
| Un panel abierto sin pedirlo solo se coloca con 110-144 columnas o más | Medio | F5-T1 lo mide; el ADR decide abrirlo solo al pedirlo o al retener, y qué se ve en terminales estrechas | Abierto |
| Que el ratón funcione depende del terminal (seguimiento del ratón) | Medio | Los botones también responden al teclado (`hotkey`, foco con Enter); F5-T1 lo prueba en el terminal de Peterson | Abierto |
