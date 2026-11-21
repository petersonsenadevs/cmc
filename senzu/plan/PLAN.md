# Plan — Plugin de Claude Code `cmc` (Claude Message Control)

- **Objetivo:** retener los mensajes y soltarlos cuando el usuario quiera, sin interrumpir al agente, y derivar un mensaje a otro agente que hereda el contexto y trabaja en paralelo.
- **Estado:** en curso · **Actualizado:** 2026-11-21
- **Stack / perfil:** a medida · plugin de Claude Code · Node 24 ESM (`.mjs`) sin dependencias ni build · `node --test`
- **Brief:** `senzu/plan/brief.md` · **Design system:** no aplica (sin interfaz web) · **Devlog:** `senzu/devlog/INDEX.md`
- **Definición de hecho global:** `node --test` en verde, `claude plugin validate .` limpio, probado en sesión real con `claude --plugin-dir .`, sin secretos, cabecera de autoría (Peterson Sena · r3v3rs3) en el core, devlog al día, sin push ni publicación sin aprobación
- **Idioma:** producto en inglés (código, comentarios, textos del plugin, nombres de comandos, README, documentación y ADR); devlog y este plan en castellano

## Alcance
- **IN:** captura por prefijo y por CLI externa; cola por sesión persistente (listar, editar, borrar, reordenar); liberación manual, «al terminar» y «ya»; indicador visible; derivación a otro agente con contexto (fork de sesión o paquete de contexto) en worktree; estado, log y cancelación; retorno del resultado a la cola; configuración, README y marketplace local.
- **OUT (explícito):** retener lo que se envía sin prefijo por la cola nativa; canales MCP (`--channels`, en vista previa); conversación continua entre agentes; fusión automática del worktree; otros CLI y apps de escritorio/web; publicación en marketplace público.
- **Supuestos:** S1 nombre `cmc`, prefijos `;;` y `>>` · S2 `UserPromptSubmit` intercepta los mensajes de mitad de turno sin interrumpir (no documentado) · S3 `/cmc:release` se expande a mitad de turno (no documentado) · S4 el fork funciona con la sesión a mitad de turno (no documentado) · S5 sin git no hay worktree.
- **Riesgos:** ver sección final

## Arquitectura (decidida al planificar)
- `lib/` — core puro y testeable sin Claude Code: `queue.mjs` (cola JSONL por sesión, vaciado atómico), `sessions.mjs` (registro de sesiones por carpeta), `config.mjs`, `dispatch.mjs` (lanzador), `context-pack.mjs`.
- `hooks/` — adaptadores finos: leen el JSON del hook por stdin, llaman al core y devuelven la salida del hook. Sin lógica propia.
- `bin/cmc.mjs` — CLI externa (otra terminal) sobre el mismo core.
- `commands/` — `/cmc:release`, `/cmc:queue`, `/cmc:dispatch`, `/cmc:agents`.
- Estado solo en `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>/`. No se declara `senzu/arquitectura/capas.json`: no hay backend; las decisiones van a ADR en `senzu/arquitectura/adr/`.

## Fases
| Fase | Entregable verificable por el usuario | Estado |
|---|---|---|
| F1 | Esqueleto: escribes `;; texto` con el agente trabajando, no se interrumpe, y `/cmc:release` o el fin del turno se lo entrega | doing |
| F2 | Control completo: ver, editar, borrar y soltar de forma selectiva, modo «ya», indicador visible y CLI `cmc` desde otra terminal | todo |
| F3 | Derivar: `>> tarea` arranca un segundo agente con contexto en su worktree, en paralelo; se ve, se cancela y su resultado vuelve a la cola (retenido o automático) | todo |
| F4 | Entrega: configuración, revisión de seguridad, README e instalación desde marketplace local | todo |

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

### F1-T3 · Implementar la cola por sesión en el core  [M] [doing]
- Para qué: que los mensajes retenidos no se pierdan ni se entreguen dos veces.
- Skill: `code-quality §references/testing "TDD pragmático"` + `code-quality §references/jobs-and-queues "Idempotencia (el job llegará dos veces)"`
- Archivos: lib/queue.mjs, lib/paths.mjs, test/queue.test.mjs
- Hecho cuando: `add`, `list`, `drain` (todos o por id) sobre JSONL en el directorio de datos; `drain` es atómico (renombrado) y dos vaciados simultáneos no entregan el mismo mensaje; un fichero corrupto no rompe: se aparta y se avisa.
- Verificar: `npm test` → tests de cola en verde, incluido el de dos procesos vaciando a la vez.
- Depende de: F1-T2
- Verificado: —
- Cumple: —
- Devlog: —

### F1-T4 · Capturar mensajes con prefijo en `UserPromptSubmit`  [M] [todo]
- Para qué: escribir un mensaje mientras el agente trabaja sin que lo reciba.
- Skill: `code-quality §references/errors-logging "No tragar errores"`
- Archivos: hooks/prompt-capture.mjs, hooks/hooks.json, test/prompt-capture.test.mjs
- Hecho cuando: un prompt que empieza por `;;` se guarda en la cola y se bloquea con un aviso corto («Held (3 queued)»); un prompt sin prefijo pasa intacto; si el hook falla, el prompt pasa (nunca se pierde un mensaje) y el error queda en el log.
- Verificar: `npm test` (JSON de entrada simulado → salida esperada) y sesión real: `;; hola` a mitad de turno no aparece en el contexto del agente.
- Depende de: F1-T3
- Verificado: —
- Cumple: —
- Devlog: —

### F1-T5 · Soltar la cola con `/cmc:release` y al terminar el turno  [M] [todo]
- Para qué: decidir tú cuándo recibe el agente lo retenido.
- Skill: `code-quality §references/security-owasp "Prompt injection y seguridad de LLM"`
- Archivos: commands/release.md, hooks/stop-release.mjs, bin/cmc.mjs (subcomando `drain`), test/stop-release.test.mjs
- Hecho cuando: `/cmc:release` entrega todos los mensajes en orden, marcados como mensajes del usuario retenidos, y vacía la cola; con el modo «al terminar» activo, el hook `Stop` los entrega al acabar el turno y no entra en bucle (`stop_hook_active`); con la cola vacía, ninguno de los dos hace nada.
- Verificar: `npm test` y sesión real: retener 2 mensajes, comprobar que el agente termina su tarea sin verlos y que los recibe al soltar.
- Depende de: F1-T4
- Verificado: —
- Cumple: —
- Devlog: —

### F1-T6 · Cerrar la fase con prueba de extremo a extremo  [S] [todo]
- Para qué: confirmar que el esqueleto cumple lo pedido antes de ampliarlo.
- Skill: sin skill: cierre de fase (resumen en devlog)
- Archivos: senzu/devlog/<fecha>/NNN-cierre-f1.md, README.md (uso básico)
- Hecho cuando: guion de prueba manual documentado y pasado (retener a mitad de turno → no interrumpe → soltar manual → soltar al terminar); desviaciones respecto al ADR 001 anotadas.
- Verificar: guion ejecutado en sesión real con su resultado pegado en el devlog.
- Depende de: F1-T5
- Verificado: —
- Cumple: —
- Devlog: —

## F2 — Control completo de la cola

### F2-T1 · Gestionar la cola: ver, editar, borrar y reordenar  [M] [todo]
- Para qué: control total de lo retenido: decidir qué mensaje va primero y cuál después, y corregir o descartar cualquiera antes de enviarlo.
- Skill: `code-quality §references/testing "Qué testear y qué no"`
- Archivos: lib/queue.mjs, commands/queue.md, bin/cmc.mjs (`list`, `edit`, `rm`, `move`), test/queue-manage.test.mjs
- Hecho cuando: `/cmc:queue` muestra posición, id, hora y texto de cada mensaje; se puede editar el texto, borrar uno o todos y cambiar el orden (mover a una posición, subir, bajar, poner el primero); el orden que se ve es el orden exacto en que se entregan al soltar; gestionar la cola no envía nada al agente más allá del listado.
- Verificar: `npm test` y sesión real: editar y borrar un mensaje retenido y comprobarlo en el listado.
- Depende de: F1-T6
- Verificado: —
- Cumple: —
- Devlog: —

### F2-T2 · Soltar de forma selectiva y en modo «ya»  [M] [todo]
- Para qué: enviar solo un mensaje, o hacerlo llegar en el siguiente paso sin esperar al final.
- Skill: `code-quality §references/errors-logging "No tragar errores"`
- Archivos: hooks/tool-release.mjs, hooks/hooks.json, lib/release.mjs, commands/release.md, test/release.test.mjs
- Hecho cuando: `/cmc:release 2` entrega solo ese mensaje; `;;now` (o `cmc release --now` desde otra terminal) marca la cola para entregarse en el siguiente paso del agente por el mecanismo fijado en el ADR 001; `;;end` la deja para el final del turno; cada mensaje se entrega una sola vez.
- Verificar: `npm test` y sesión real con una tarea de varios pasos: el mensaje llega entre dos herramientas.
- Depende de: F2-T1
- Verificado: —
- Cumple: —
- Devlog: —

### F2-T3 · Escribir desde otra terminal con la CLI `cmc`  [M] [todo]
- Para qué: retener mensajes sin tocar el prompt de Claude Code (y plan B si S2 falla).
- Skill: `code-quality §references/security-owasp "Validación en servidor"`
- Archivos: bin/cmc.mjs, lib/sessions.mjs, hooks/session-register.mjs, test/sessions.test.mjs
- Hecho cuando: un hook `SessionStart` registra la sesión (id, carpeta, última actividad); `cmc hold "texto"` desde otra terminal la encuentra por carpeta y encola; con varias sesiones en la misma carpeta, pide elegir; sin sesión activa, lo dice y no guarda nada.
- Verificar: `npm test` y prueba real con dos terminales.
- Depende de: F2-T1
- Verificado: —
- Cumple: —
- Devlog: —

### F2-T4 · Mostrar el indicador de mensajes retenidos  [M] [todo]
- Para qué: saber de un vistazo que hay mensajes esperando.
- Skill: `plugin-authoring` (mods: banda o línea de estado) — skill de Claude Code, no de Senzu
- Archivos: mods/ o statusline/cmc-status.mjs (según lo que permita el sistema de mods), README.md
- Hecho cuando: se ve «✉ 2 held» (y nada cuando la cola está vacía), actualizado al retener y al soltar; si un plugin no puede aportar la línea de estado, queda documentado cómo activarla en `settings.json`.
- Verificar: sesión real: captura con 0, 1 y 2 mensajes retenidos.
- Depende de: F2-T1
- Verificado: —
- Cumple: —
- Devlog: —

### F2-T5 · Conservar la cola tras reiniciar, reanudar o compactar  [S] [todo]
- Para qué: no perder mensajes retenidos si se cierra la terminal.
- Skill: `code-quality §references/testing "Qué testear y qué no"`
- Archivos: lib/sessions.mjs, hooks/session-register.mjs, test/persistence.test.mjs
- Hecho cuando: al reanudar una sesión (`--resume`, `--continue`) la cola sigue ahí y se avisa de cuántos hay; las colas de sesiones de más de N días se limpian.
- Verificar: `npm test` y prueba real: retener, cerrar, `claude --continue`, soltar.
- Depende de: F2-T3
- Verificado: —
- Cumple: —
- Devlog: —

## F3 — Derivar a otro agente

### F3-T1 · Comprobar el fork de sesión a mitad de turno en Windows  [S] [todo]
- Para qué: saber si el segundo agente puede heredar el contexto mientras el principal sigue trabajando.
- Skill: sin skill: experimento
- Archivos: spike/fork-test.mjs, senzu/arquitectura/adr/002-derivacion-y-contexto.md
- Hecho cuando: el ADR responde con evidencia a (a) ¿`claude -p --resume <id> --fork-session` arranca con la sesión origen a mitad de turno y no la altera?, (b) ¿qué ve el fork si el transcript acaba en una llamada a herramienta sin resultado?, (c) ¿cómo se lanza desacoplado en Windows y sobrevive al hook?, (d) ¿qué flags hay que volver a pasar (`--plugin-dir`, permisos, `--worktree`)?, (e) coste en tokens del fork frente a un paquete de contexto; y fija el modo por defecto.
- Verificar: salida de las pruebas pegada en el ADR.
- Depende de: F2-T5
- Verificado: —
- Cumple: —
- Devlog: —

### F3-T2 · Implementar el lanzador de agentes derivados  [M] [todo]
- Para qué: arrancar el segundo agente sin bloquear ni interrumpir al principal.
- Skill: `code-quality §references/security-owasp "Inyección (SQL, comandos, plantillas)"` + `code-quality §references/jobs-and-queues "Anatomía de un job bien hecho"`
- Archivos: lib/dispatch.mjs, lib/agents-registry.mjs, test/dispatch.test.mjs
- Hecho cuando: `dispatch(tarea, sesión)` lanza `claude -p` desacoplado con argumentos en array (sin shell), salida `stream-json` a un log por agente y ficha en el registro (id, pid, tarea, estado, inicio); permisos `acceptEdits` con lista de herramientas configurable, nunca `bypassPermissions`; el estado pasa a `terminado` o `fallido` con su código de salida; cancelar mata el proceso.
- Verificar: `npm test` con un ejecutable falso en lugar de `claude`; prueba real con una tarea de solo lectura.
- Depende de: F3-T1
- Verificado: —
- Cumple: —
- Devlog: —

### F3-T3 · Aislar al agente derivado en un worktree  [M] [todo]
- Para qué: que dos agentes a la vez no pisen los mismos archivos.
- Skill: `code-quality §references/git-and-reviews "Ramas cortas"`
- Archivos: lib/worktree.mjs, lib/dispatch.mjs, test/worktree.test.mjs
- Hecho cuando: con repositorio git, el agente trabaja en un worktree y una rama propios (`cmc/<id>`); sin git, trabaja en la misma carpeta y se avisa; un worktree sin cambios se limpia al terminar y uno con cambios se conserva y se informa de la rama.
- Verificar: `npm test` sobre un repositorio temporal; prueba real: el derivado edita un archivo y el principal no lo ve cambiar.
- Depende de: F3-T2
- Verificado: —
- Cumple: —
- Devlog: —

### F3-T4 · Construir el paquete de contexto ligero  [M] [todo]
- Para qué: derivar tareas pequeñas sin pagar el historial entero (y plan B si S4 falla).
- Skill: `code-quality §references/llm-apps "5. Costes y límites"` + `code-quality §references/llm-apps "6. Seguridad"`
- Archivos: lib/context-pack.mjs, test/context-pack.test.mjs, test/fixtures/transcript.jsonl
- Hecho cuando: a partir del transcript se obtiene un paquete acotado (petición original, últimos N intercambios, archivos tocados, carpeta y rama) que se pasa al agente nuevo; un transcript con formato desconocido no rompe: degrada a «tarea + carpeta» y lo avisa; `--modo fork|paquete` elige.
- Verificar: `npm test` con transcripts de ejemplo, incluido uno malformado.
- Depende de: F3-T2
- Verificado: —
- Cumple: —
- Devlog: —

### F3-T5 · Derivar desde el prompt y ver los agentes  [M] [todo]
- Para qué: mandar una tarea al segundo agente con un gesto y saber cómo va.
- Skill: `code-quality §references/errors-logging "Mensajes accionables"`
- Archivos: hooks/prompt-capture.mjs, commands/dispatch.md, commands/agents.md, bin/cmc.mjs (`dispatch`, `agents`, `log`, `cancel`), test/prompt-dispatch.test.mjs
- Hecho cuando: `>> tarea` a mitad de turno lanza el agente sin que el principal lo vea ni se interrumpa; `/cmc:dispatch 2` deriva un mensaje ya retenido; `/cmc:agents` lista estado, duración y rama; `cmc log <id>` muestra su salida y `cmc cancel <id>` lo detiene; el indicador de F2-T4 muestra los agentes activos.
- Verificar: `npm test` y sesión real: el principal y el derivado trabajando a la vez, con captura del listado.
- Depende de: F3-T3, F3-T4
- Verificado: —
- Cumple: —
- Devlog: —

### F3-T6 · Devolver el resultado del agente derivado a la cola  [M] [todo]
- Para qué: que el trabajo del segundo agente vuelva a la conversación cuando tú quieras.
- Skill: `code-quality §references/security-owasp "Prompt injection y seguridad de LLM"`
- Archivos: lib/dispatch.mjs, lib/queue.mjs, test/dispatch-return.test.mjs
- Hecho cuando: al terminar, el resumen final del derivado (más la rama y los archivos cambiados) entra en la cola como mensaje retenido (modo `held`, el de por defecto), marcado como salida de otro agente y no como instrucción del usuario; si falla, entra el error con la ruta del log.
- Verificar: `npm test` y sesión real: derivar, esperar, `/cmc:queue` muestra el resultado, `/cmc:release` lo entrega.
- Depende de: F3-T5
- Verificado: —
- Cumple: —
- Devlog: —

### F3-T7 · Añadir el retorno automático como ajuste  [S] [todo]
- Para qué: poder elegir que el resultado del segundo agente llegue solo al principal, sin soltarlo a mano.
- Skill: `code-quality §references/security-owasp "Prompt injection y seguridad de LLM"`
- Archivos: lib/dispatch.mjs, lib/release.mjs, lib/config.mjs, test/dispatch-return.test.mjs
- Hecho cuando: el ajuste `dispatch.return` admite `held` (por defecto) y `auto`; con `auto` el resultado se entrega al agente principal en su siguiente paso o, si está parado, al terminar su turno, por el mismo mecanismo que el modo «ya»; se puede fijar por derivación (`>> --auto tarea`); el resultado sigue marcado como salida de otro agente.
- Verificar: `npm test` y sesión real: derivar con `auto` y comprobar que el principal recibe el resultado sin `/cmc:release`.
- Depende de: F3-T6
- Verificado: —
- Cumple: —
- Devlog: —

## F4 — Entrega

### F4-T1 · Añadir la configuración del plugin  [S] [todo]
- Para qué: adaptar prefijos, modo de entrega y permisos sin tocar código.
- Skill: `code-quality §references/typescript "Validación en los bordes con zod"` (el principio, con validación a mano: sin dependencias)
- Archivos: lib/config.mjs, config.default.json, test/config.test.mjs
- Hecho cuando: prefijos, modo de entrega por defecto, modo de contexto, permisos y herramientas del derivado y días de retención se leen de un fichero de usuario validado; un valor inválido cae al valor por defecto con aviso.
- Verificar: `npm test`.
- Depende de: F3-T6
- Verificado: —
- Cumple: —
- Devlog: —

### F4-T2 · Revisar la seguridad del plugin  [M] [todo]
- Para qué: que un mensaje o un transcript no puedan ejecutar nada por su cuenta.
- Skill: `security` (pasada OWASP con evidencia, `/seguridad`)
- Archivos: senzu/seguridad/ (informe), correcciones donde toque
- Hecho cuando: revisados inyección de comandos en el lanzador, rutas (ids de sesión como nombres de carpeta), permisos del derivado, contenido de terceros tratado como datos y logs sin secretos; hallazgos corregidos o aceptados por escrito.
- Verificar: informe con evidencia por hallazgo; `npm test` en verde tras las correcciones.
- Depende de: F4-T1
- Verificado: —
- Cumple: —
- Devlog: —

### F4-T3 · Documentar e instalar desde un marketplace local  [M] [todo]
- Para qué: instalarlo en cualquier proyecto y que otra persona sepa usarlo.
- Skill: sin skill: README (qué hace, instalación, uso, límites conocidos, cómo probar)
- Archivos: README.md, .claude-plugin/marketplace.json, CHANGELOG.md, LICENSE
- Hecho cuando: el README cubre instalación, los cuatro comandos, los prefijos, la CLI, la configuración y los límites (lo no documentado por Claude Code); el plugin se instala desde el marketplace local en un proyecto limpio y pasa el guion de F1-T6 y el de derivación.
- Verificar: `claude plugin validate .`; instalación en una carpeta nueva y guiones pasados, con resultado en el devlog.
- Depende de: F4-T2
- Verificado: —
- Cumple: —
- Devlog: —

---

## Tareas ad hoc (fuera del plan original)

## Cambios al plan
| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-11-21 | Plan creado | — |
| 2026-11-21 | F2-T1 ampliada: el usuario elige el orden de entrega de los mensajes retenidos (además de editar y borrar) | Petición de Peterson: «total control» |
| 2026-11-21 | Producto en inglés (comandos `/cmc:release`, `/cmc:queue`, `/cmc:dispatch`, `/cmc:agents`); devlog en castellano | Decisión de Peterson |
| 2026-11-21 | Q2 resuelta: el derivado edita solo en su worktree, sin permisos sin límite. Q3 resuelta: retorno retenido primero; se añade F3-T7 (retorno automático como ajuste) | Decisión de Peterson |
| 2026-11-21 | `git init` adelantado de F1-T2 al inicio de la sesión | Petición de Peterson: «inicia el repo» |
| 2026-11-21 | ADR 001: `/cmc:release` a mitad de turno actúa al terminar el turno; el modo «ya» de F2-T2 se hace con el prompt `;;now` y `additionalContext` de `UserPromptSubmit` | Evidencia de F1-T1 |
| 2026-11-21 | Q1 resuelta: el plugin se llama `cmc` (Claude Message Control); prefijos `;;` y `>>` por defecto, configurables en F4-T1 | Decisión de Peterson |

## Riesgos y bloqueos
| Riesgo / bloqueo | Impacto | Mitigación / qué se necesita | Estado |
|---|---|---|---|
| `UserPromptSubmit` no se dispara (o interrumpe) con mensajes de mitad de turno: no documentado | Alto: es la captura principal | F1-T1 lo comprueba primero; plan B: captura a mitad de turno solo con la CLI `cmc` desde otra terminal (F2-T3 sube a F1) | Abierto |
| El fork de una sesión a mitad de turno falla o hereda un estado incompleto | Alto para F3 | F3-T1 lo comprueba; plan B: paquete de contexto como modo por defecto (F3-T4) | Abierto |
| El formato del transcript no está documentado y puede cambiar | Medio | Solo lo lee el paquete de contexto, con degradación a «tarea + carpeta» y test con transcript malformado | Abierto |
| El fork hereda todo el historial: coste alto de tokens por derivación | Medio | F3-T1 lo mide; modo paquete para tareas pequeñas; el coste se indica al derivar | Abierto |
| Agente derivado sin supervisión con permisos de edición | Alto | Worktree aislado, `acceptEdits` como máximo por defecto, lista de herramientas, nunca `bypassPermissions`; revisión en F4-T2 | Abierto |
| Tope de 8 continuaciones seguidas del hook `Stop` | Bajo | Entregar toda la cola en una sola continuación | Abierto |
| Un plugin quizá no pueda aportar línea de estado ni atajos de teclado | Bajo | F2-T4 usa el sistema de mods o documenta el ajuste manual en `settings.json` | Abierto |
