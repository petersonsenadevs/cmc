# Brief — Plugin de Claude Code `cmc` (Claude Message Control)

- **Fecha:** 2026-11-21 · **Solicitado por:** Peterson Sena (r3v3rs3) · **Stack:** plugin de Claude Code · Node 24 ESM (`.mjs`) sin dependencias ni build · `node --test`

## Objetivo (una frase)
Dar a quien trabaja con Claude Code el control de cuándo llegan sus mensajes al agente (retenerlos y soltarlos a voluntad, sin interrumpirlo) y la opción de derivar un mensaje a otro agente que herede el contexto y trabaje en paralelo.

## Usuarios y resultado observable
- Quién lo usa: desarrolladores con Claude Code en terminal (Windows 11 primero) durante turnos largos del agente.
- Qué puede hacer cuando esté hecho:
  1. Escribir `;; cambia también el README` mientras el agente trabaja: el mensaje queda retenido, el agente no lo ve y no se interrumpe.
  2. Ver cuántos mensajes hay retenidos, editarlos, borrarlos y soltarlos cuando quiera: uno o todos, «ya» (en el siguiente paso del agente) o «al terminar» (cuando acabe su turno).
  3. Escribir `>> revisa los tests del módulo X`: arranca un segundo agente con el contexto de la sesión, en su propia copia de trabajo, a la vez que el principal; se ve su estado, su salida y se puede cancelar.
  4. Recibir el resultado del agente derivado como mensaje retenido, para decidir cuándo lo ve el agente principal.

## Alcance
- **IN:**
  - Captura de mensajes retenidos por prefijo en el propio prompt (hook `UserPromptSubmit`) y por CLI externa `cmc` desde otra terminal.
  - Cola por sesión, persistente en `${CLAUDE_PLUGIN_DATA}`: listar, editar, borrar, reordenar.
  - Liberación: manual (`/cmc:release`), «al terminar» (hook `Stop`) y «ya» (inyección en el siguiente paso del agente); selectiva o total.
  - Indicador visible de mensajes retenidos y agentes derivados.
  - Derivación a otro agente: `claude -p --resume <sesión> --fork-session` (contexto completo) o «paquete de contexto» ligero; aislamiento en git worktree; registro, estado, log y cancelación.
  - Retorno del resultado del agente derivado a la cola retenida.
  - Configuración (prefijos, modo de entrega por defecto, permisos del agente derivado), README, validación y marketplace local.
- **OUT (explícito, con motivo):**
  - Cambiar la cola nativa de Claude Code (Enter a mitad de turno sin prefijo): no hay ajuste documentado; el plugin no puede retener lo que se envía sin prefijo.
  - Canales MCP (`--channels`): en vista previa, exigen lista aprobada o flag de desarrollo; se reconsidera cuando sean estables.
  - Conversación continua entre el agente principal y el derivado: la mensajería entre sesiones solo pasa texto plano; aquí el derivado ejecuta una tarea y devuelve un resultado.
  - Fusión automática del worktree del agente derivado: la decide el usuario.
  - Soporte de Codex u otros CLI, y de la app de escritorio/web: primero la CLI de Claude Code.
  - Publicación en un marketplace público: requiere decisión aparte.

## Restricciones
- Técnicas: Claude Code ≥ 2.1.330 (instalada); Node ≥ 20; Windows 11 primero, sin romper macOS/Linux; sin dependencias de npm; el estado nunca se escribe en `${CLAUDE_PLUGIN_ROOT}`; el formato interno del transcript no está documentado y puede cambiar.
- Producto/marca: producto en inglés (código, comentarios, textos del plugin, nombres de comandos, README, documentación y ADR); devlog en castellano; autoría de Peterson Sena (r3v3rs3) en la cabecera de cada fichero del core y en `plugin.json`.
- Datos/seguridad: los mensajes y el contexto se quedan en local; el texto del usuario nunca se interpola en una línea de shell; el agente derivado nunca arranca con permisos sin límite por defecto.
- Plazo / prioridad: sin fecha; primero la retención (F1–F2), después la derivación (F3).

## Definición de hecho global
- [ ] `node --test` en verde · [ ] `claude plugin validate .` sin errores · [ ] probado en una sesión real con `claude --plugin-dir .` · [ ] sin secretos · [ ] cabecera de autoría en los ficheros del core · [ ] devlog al día · [ ] sin push ni publicación sin aprobación

## Supuestos (escritos para poder refutarlos)
- S1. El plugin se llama `cmc` (comandos `/cmc:…`); prefijo de retención `;;` y de derivación `>>`, configurables.
- S2. `UserPromptSubmit` se dispara también con los mensajes escritos a mitad de turno y, al bloquearlos, no interrumpe al agente. **No documentado**: lo comprueba F1-T1; si falla, la captura a mitad de turno pasa a hacerse solo con la CLI externa `cmc`.
- S3. Un comando `/cmc:release` escrito a mitad de turno se expande al entregarse. No documentado: lo comprueba F1-T1.
- S4. `claude -p --resume <id> --fork-session` funciona con una sesión que está a mitad de turno. No documentado: lo comprueba F3-T1; si falla, el modo por defecto pasa a ser el paquete de contexto.
- S5. Sin repositorio git no hay worktree: el agente derivado trabaja en la misma carpeta y se avisa.

## Preguntas abiertas
| Pregunta | Dueño | Bloquea | Respuesta |
|---|---|---|---|
| Q1. ¿Nombre y prefijos `;;` / `>>`? | Peterson | F1-T2 | Resuelta 2026-11-21: `cmc` (Claude Message Control); prefijos por defecto, configurables |
| Q2. ¿Qué permisos tiene el agente derivado? | Peterson | F3-T2 | Resuelta 2026-11-21: `acceptEdits` dentro de su worktree, lista de herramientas configurable, nunca `bypassPermissions` |
| Q3. ¿Cómo vuelve el resultado del derivado? | Peterson | F3-T6 | Resuelta 2026-11-21: primero retenido (lo sueltas tú); después, retorno automático como ajuste (F3-T7) |
