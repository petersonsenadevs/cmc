# Decisiones — 2026-11-21

## dev-001 — Alcance y forma del producto
- **Contexto:** arranque del proyecto; tres preguntas abiertas en el brief.
- **Opciones:** nombres y prefijos varios; derivado con o sin permisos amplios; retorno automático o retenido.
- **Elección:** D-001 el plugin se llama `cmc`, prefijos `;;` (retener) y `>>` (derivar), configurables. D-002 el derivado edita solo en su worktree con `acceptEdits` como máximo, nunca `bypassPermissions`. D-003 el resultado del derivado vuelve retenido; el retorno automático es un ajuste. D-004 producto en inglés (código, comandos, README, ADR); devlog y plan en castellano.
- **Motivo:** decisiones de Peterson al planificar.
- **Consecuencias:** fijan F1-T2, F3-T2, F3-T6 y F3-T7.

## dev-002 — Captura y liberación (ADR 001)
- **Contexto:** nada de lo que hace falta estaba documentado para mensajes de mitad de turno.
- **Opciones:** captura por hook `UserPromptSubmit` o solo por CLI externa; liberación por comando, por `Stop` o por contexto inyectado.
- **Elección:** D-005 captura con `UserPromptSubmit` bloqueando los prompts con prefijo. D-006 liberación manual con `/cmc:release` (a mitad de turno actúa al terminar) y al final del turno con `Stop` + `decision: block` en una sola continuación. D-007 modo «ya» con el prompt de control `;;now` y `additionalContext` de `UserPromptSubmit`, con cabecera «[cmc] The user released their held messages…»; `PostToolUse` solo para la CLI externa y como mejor esfuerzo. D-008 el comando recibe `${CLAUDE_PLUGIN_DATA}` y `${CLAUDE_SESSION_ID}` como argumentos (no hay variables de entorno en `!`) y lleva `disable-model-invocation: true`.
- **Motivo:** evidencia de ocho ejecuciones (entrada 002).
- **Consecuencias:** el plan B (captura solo por CLI) no hace falta; el modo «ya» depende de la redacción y se vuelve a probar en F2-T2.

## dev-004 — Cerrojo de la cola
- **Contexto:** un hook y la CLI pueden tocar la cola a la vez; la tarjeta pedía un vaciado atómico por renombrado.
- **Opciones:** solo renombrar el fichero al vaciar; o cerrojo por directorio y reescritura con temporal + renombrado.
- **Elección:** D-009 cerrojo por directorio (`mkdir` atómico, caduca a los 10 s) en todas las operaciones, más reescritura atómica.
- **Motivo:** con solo renombrar, un `add` que escribe mientras otro proceso vacía puede caer en el fichero ya leído y perderse; además F2 necesita editar, borrar y reordenar, que son leer-modificar-escribir.
- **Consecuencias:** las operaciones son síncronas y cortas; si el cerrojo no se obtiene en 5 s se devuelve `QUEUE_BUSY`.

## dev-006 — Cómo se pide la entrega al terminar el turno
- **Contexto:** un `/comando` escrito a mitad de turno no se procesa hasta que el turno acaba (ADR 001), así que no sirve para pedir «entrégalo al terminar».
- **Opciones:** un modo persistente en la configuración; un argumento de `/cmc:release`; una palabra de control tras el prefijo.
- **Elección:** D-010 la palabra de control `;;end` (pegada al prefijo, sin espacio) arma una entrega de un solo uso que ejecuta el hook `Stop`. `;; end` con espacio es un mensaje normal.
- **Motivo:** `UserPromptSubmit` sí se dispara a mitad de turno, y es el mismo gesto que retener.
- **Consecuencias:** el modo por defecto configurable queda para F4-T1; `;;now` (F2-T2) seguirá el mismo patrón.

## dev-008 — Cómo se gestiona la cola desde la sesión
- **Contexto:** editar, borrar y reordenar necesitan argumentos (posición, texto nuevo).
- **Opciones:** argumentos de `/cmc:queue`; o palabras de control tras el prefijo, atendidas por el hook `UserPromptSubmit`.
- **Elección:** D-011 palabras de control (`;;list`, `;;edit N texto`, `;;rm N`, `;;move N M`, `;;up`, `;;down`, `;;top`, `;;bottom`, `;;clear`), con gramática estricta; `/cmc:queue` solo muestra el listado.
- **Motivo:** los argumentos de un comando se sustituyen dentro de la línea de shell (texto del usuario en shell, prohibido por el brief), el comando no se procesa a mitad de turno y todo lo que hace pasa por el agente y gasta tokens. Las palabras de control las contesta el plugin: el agente no ve nada.
- **Consecuencias:** un mensaje que empiece exactamente como una palabra de control necesita el espacio tras el prefijo (`;; clear` retiene «clear»); F2-T2 sigue el mismo patrón para soltar.

## dev-009 — Entrega «ya» armada desde fuera de la sesión
- **Contexto:** la CLI externa no puede hablar con el agente; solo dejar una nota que lean los hooks.
- **Opciones:** entregar solo al terminar el turno; o entregar tras la siguiente herramienta con `PostToolUse`.
- **Elección:** D-012 `cmc release --now` deja la selección en el estado de la sesión; el hook `PostToolUse` la entrega como `additionalContext` con la cabecera factual y, si el agente no da más pasos, la entrega el hook `Stop`.
- **Motivo:** medido en sesión real: con la cabecera factual el modelo sí obedece lo que llega por `PostToolUse` (el fallo del spike era la redacción imperativa).
- **Consecuencias:** un proceso de Node por herramienta; se entrega una sola vez por cualquiera de las dos vías.

## dev-010 — Cómo encuentra la CLI el directorio de datos
- **Contexto:** fuera de Claude Code no existe `CLAUDE_PLUGIN_DATA`, y el nombre del directorio de datos depende de cómo se instaló el plugin (`cmc-inline` con `--plugin-dir`).
- **Opciones:** un fichero puntero en la carpeta del usuario (`~/.cmc`); o una marca dentro del propio directorio de datos y que la CLI recorra `~/.claude/plugins/data/*`.
- **Elección:** D-013 el hook `SessionStart` deja `cmc.json` en el directorio de datos y la CLI busca esa marca; `--data-dir` o `CMC_DATA_DIR` lo fijan a mano.
- **Motivo:** no se escribe estado fuera de `${CLAUDE_PLUGIN_DATA}`, como pide el brief.
- **Consecuencias:** la CLI no ve una sesión hasta que su `SessionStart` se ha ejecutado con el plugin cargado.

## dev-011 — Cómo se muestra el indicador
- **Contexto:** el plan dudaba de que un plugin pudiera aportar la línea de estado.
- **Opciones:** script de `statusLine` que el usuario activa a mano en `settings.json`; o un módulo de hooks del motor de plugins (`modules` en `hooks/hooks.json`) con `$.ui.status`.
- **Elección:** D-014 módulo de hooks `hooks/indicator.mjs` que lee la cola cada segundo y fija `✉ N held`.
- **Motivo:** se instala con el plugin, sin tocar la configuración del usuario, y no pisa su `statusLine` propia.
- **Consecuencias:** el módulo corre en el motor (sin Node), así que no comparte código con el core; exige una versión de Claude Code con módulos de hooks (la 2.1.330 los tiene). El mismo motor ofrece el evento `prompt.submit` y la «puerta» `queue`, que podrían capturar un mensaje al teclearlo y no al acabar la herramienta: anotado como mejora posible, fuera del plan.

## dev-012 — Retención de sesiones inactivas
- **Contexto:** cada sesión deja una carpeta con su cola en el directorio de datos.
- **Opciones:** no borrar nunca; borrar al cerrar la sesión; borrar por antigüedad.
- **Elección:** D-015 se borran las sesiones sin actividad desde hace más de 30 días, al arrancar otra sesión.
- **Motivo:** borrar al cerrar impediría reanudar con la cola intacta; no borrar nunca acumula mensajes olvidados.
- **Consecuencias:** lo retenido en una sesión abandonada más de 30 días se pierde; el plazo será configurable (F4-T1) y 0 desactiva la limpieza.

## dev-013 — Derivación: contexto y aislamiento (ADR 002)
- **Contexto:** `>> tarea` debe arrancar un segundo agente con el contexto de la sesión, en paralelo y sin alterarla.
- **Opciones:** fork de la sesión (`--resume <id> --fork-session`) o paquete de contexto; worktree creado por el plugin o por Claude Code.
- **Elección:** D-016 el modo por defecto es el fork, en el modelo de la sesión origen; el paquete queda como alternativa (`--mode pack`) y como respaldo. D-017 el aislamiento usa el `--worktree <nombre>` de Claude Code (`cmc-<id>`); sin git no se pasa y se avisa.
- **Motivo:** medido: el fork arranca a mitad de turno sin alterar el origen, ve la herramienta pendiente como interrumpida y, por la caché, costó menos que el paquete en una sesión corta.
- **Consecuencias:** F3-T3 ya no crea el worktree: lo nombra, lo localiza y lo limpia. El fork hereda toda la conversación; el prompt de derivación lo acota a la tarea.

## dev-015 — Cómo se lanza y se vigila un agente derivado
- **Contexto:** el hook que deriva debe volver enseguida, pero alguien tiene que saber cuándo y cómo acaba el agente.
- **Opciones:** lanzar `claude` desacoplado y deducir su final del log; o un proceso supervisor por agente.
- **Elección:** D-018 un supervisor desacoplado (`lib/agent-runner.mjs`) ejecuta `claude`, le pasa el prompt por stdin, guarda la salida y anota el estado final. La línea de comandos se construye como array y nunca lleva texto del usuario.
- **Motivo:** el supervisor da un estado fiable (terminado, fallido, cancelado) y un sitio donde, en F3-T6, devolver el resultado a la cola; stdin evita inyección y el límite de longitud de la línea de comandos en Windows.
- **Consecuencias:** dos procesos por agente; cancelar mata el árbol (`taskkill /T /F` en Windows, grupo de procesos en POSIX).

## dev-016 — El repositorio es un marketplace
- **Contexto:** el plugin estaba en la raíz del repositorio, junto a `senzu/`, `.claude/` y los tests, y el marketplace se dejaba para F4-T3. Peterson quería instalarlo añadiendo un marketplace y después el plugin.
- **Opciones:** plugin en la raíz con `marketplace.json` apuntando a `./`; o plugin en su propia carpeta.
- **Elección:** D-021 marketplace `r3v3rs3` en la raíz (`.claude-plugin/marketplace.json`) y plugin en `plugins/cmc/`; tests, scripts y documentación de desarrollo se quedan fuera.
- **Motivo:** la instalación copia la carpeta del plugin: así solo viaja el producto. Deja sitio para más plugins del mismo autor.
- **Consecuencias:** `--plugin-dir` apunta ahora a `plugins/cmc`; la CLI instalada queda en la caché de plugins de Claude Code (F4-T3 documentará cómo ponerla en el PATH).

## dev-017 — Lenguaje y orden de los adaptadores
- **Contexto:** Peterson preguntó por qué el plugin es JavaScript puro y planteó sacar más adaptadores (Codex y otros).
- **Opciones:** JavaScript con JSDoc sin comprobar; JavaScript con `tsc --checkJs` en desarrollo; TypeScript ejecutado por Node. Adaptadores ahora o después.
- **Elección:** D-022 JavaScript sobre Node, sin TypeScript ni compilación. D-023 primero se termina Claude Code; los adaptadores van después, en una fase 5.
- **Motivo:** de Peterson: Claude Code ya usa Node para funcionar, y Senzu y Corvus están hechos así; los adaptadores, cuando lo de Claude esté perfecto.
- **Consecuencias:** no se añade TypeScript ni como dependencia de desarrollo; el «types» de `verify-build` seguirá en rojo hasta que Senzu se reinstale con los comandos reales del proyecto. En la fase 5 habrá que separar de `lib/` lo específico de Claude Code y volver a ejecutar `/adoptar`.

## dev-018 — El plugin va en TypeScript
- **Contexto:** D-022 fijó «JavaScript sin TypeScript» a partir de una respuesta de Peterson que el agente interpretó mal. Peterson lo aclaró: quería TypeScript.
- **Opciones:** TypeScript compilado a `dist/`; TypeScript ejecutado directamente por Node; JavaScript con JSDoc comprobado.
- **Elección:** D-024 TypeScript ejecutado directamente por Node (ficheros `.ts`, sin compilar), con `typescript` solo como dependencia de desarrollo para `tsc --noEmit`. Sustituye a D-022.
- **Motivo:** es lo que quiere Peterson, y sin compilación la instalación por marketplace sigue copiando la carpeta tal cual.
- **Consecuencias:** sube el Node mínimo (a confirmar en la documentación); solo se puede usar sintaxis borrable (sin `enum`); hay que borrar las convenciones selladas y volver a ejecutar `/adoptar`.

## dev-019 — Tipado estricto sin escapes
- **Contexto:** al migrar a TypeScript había que decidir cuánto rigor.
- **Opciones:** `strict` con `any` donde cueste; o estricto del todo.
- **Elección:** D-025 `strict` + `noUncheckedIndexedAccess`, sin `any`, `@ts-ignore` ni `!`; lo que entra por un hook o sale de `JSON.parse` es `unknown` y se estrecha; solo sintaxis borrable (`erasableSyntaxOnly`), porque Node no transforma el código.
- **Motivo:** el plugin intercepta los mensajes del usuario; el tipado estricto destapó seis fallos reales en la primera pasada.
- **Consecuencias:** `npm run types` (`tsc --noEmit`) forma parte de la verificación de cada tarea.

## dev-020 — Lanzador de los hooks y caché de compilación
- **Contexto:** con los hooks en TypeScript, cada invocación pasó de unos 42 ms a unos 95 ms: Node quita los tipos de cada módulo en cada arranque. El hook `PostToolUse` corre en cada herramienta del agente.
- **Opciones:** aceptar los 50 ms; activar la caché de compilación desde el propio hook `.ts` (72 ms: el fichero de entrada sigue pagando la carga del eliminador de tipos); o un lanzador en JavaScript que la active antes de cargar el núcleo.
- **Elección:** D-026 `hooks/run.js`, único fichero JavaScript del plugin y sin lógica: llama a `enableCompileCache()` y carga `lib/hooks.ts`, que resuelve el hook por nombre. `hooks.json` invoca `node run.js <nombre>`.
- **Motivo:** medido: 45 ms por hook, 3 ms más que en JavaScript.
- **Consecuencias:** un fichero `.js` en un plugin por lo demás TypeScript; la caché vive en la carpeta temporal del sistema y Node la invalida sola cuando cambia el código.

## dev-021 — El bloqueo que Claude Code deja en el worktree
- **Contexto:** Claude Code bloquea el worktree de una sesión (`git worktree lock`, motivo «claude session <nombre> (pid N)») y no lo desbloquea al terminar; git se niega a retirar un worktree bloqueado.
- **Opciones:** forzar el borrado (`remove -f -f`); dejar todos los worktrees; o levantar solo el bloqueo propio y ya muerto.
- **Elección:** D-027 se desbloquea únicamente cuando el motivo es la sesión de ese mismo agente y su proceso ya no existe; después se retira sin forzar si no hay cambios. Un worktree con cambios se conserva, ya desbloqueado.
- **Motivo:** nunca se pierde trabajo (git sigue negándose si hay cambios) y no se toca un bloqueo ajeno o de una sesión viva.
- **Consecuencias:** depende del texto del motivo que escribe Claude Code; si cambiara, el worktree limpio se quedaría (bloqueado) y se informaría como conservado.

## dev-022 — Derivar un mensaje retenido
- **Contexto:** la tarjeta pedía `/cmc:dispatch 2`.
- **Opciones:** comando con argumento; palabra de control.
- **Elección:** D-028 `;;dispatch N [--pack]`, contestada por el plugin; el mensaje sale de la cola solo cuando el agente ha arrancado.
- **Motivo:** el mismo de D-011: los argumentos de un comando acaban en su línea de shell, y el comando no se procesa a mitad de turno.
- **Consecuencias:** `/cmc:agents` existe solo para ver, sin argumentos.

## dev-023 — Cuándo llega el resultado automático
- **Contexto:** la tarjeta F3-T7 pedía entregar el resultado del derivado en el siguiente paso del principal o, si está parado, al terminar su turno.
- **Opciones:** a mitad de turno por `PostToolUse` más el fin de turno; o solo al fin de turno (`Stop`).
- **Elección:** D-029 solo al terminar un turno.
- **Motivo:** medido en la entrada 020: a mitad de turno el modelo ignora el texto más de la mitad de las veces y el mensaje ya ha salido de la cola. Al fin de turno se obedeció siempre.
- **Consecuencias:** con el principal parado, el resultado espera al final del siguiente turno; el plugin no puede despertar una sesión en reposo.

## dev-024 — Sin entregas a mitad de turno
- **Contexto:** a mitad de turno el modelo ignoró lo entregado 7 de 12 veces y el mensaje ya había salido de la cola (entrada 020). Peterson dejó la decisión al agente.
- **Opciones:** (a) buscar una redacción o canal fiable; (b) entregar al final del turno; (c) no sacar el mensaje de la cola hasta confirmar.
- **Elección:** D-030 opción (b). `;;now` entrega al momento solo con el agente parado y espera al final del turno si trabaja; `cmc release` siempre al final del turno; fuera el hook `PostToolUse`.
- **Motivo:** el final del turno y el turno nuevo se obedecieron siempre (7 de 7 tras el cambio); (a) no tiene base medida y (c) necesitaría saber qué hizo el modelo con el texto.
- **Consecuencias:** sustituye a D-007 en su parte de mitad de turno y a D-012. El estado guarda si hay un turno en marcha; un turno interrumpido con Esc deja ese dato desfasado hasta el siguiente.

## dev-025 — Dónde viven los ajustes
- **Contexto:** prefijos, valores por defecto de la derivación, permisos del derivado y retención debían poder cambiarse sin tocar código.
- **Opciones:** `userConfig` del manifiesto (lo gestiona Claude Code); o un `config.json` propio en el directorio de datos.
- **Elección:** D-031 `config.json` en `${CLAUDE_PLUGIN_DATA}`, validado por cmc, con `cmc config` y `cmc config init`.
- **Motivo:** lo leen igual los hooks y la CLI desde otra terminal (que no recibe `userConfig`), admite listas (`dispatch.tools`) y sobrevive a las actualizaciones del plugin como el resto del estado.
- **Consecuencias:** el usuario edita JSON a mano; los errores no paran nada y se avisan al arrancar la sesión.
