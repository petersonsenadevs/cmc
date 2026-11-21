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
