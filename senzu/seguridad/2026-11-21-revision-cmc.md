# Revisión de seguridad — cmc 1.0.0 (2026-11-21)

- **Alcance:** `plugins/cmc/**` (hooks, núcleo, CLI, comandos, módulo del indicador), en la rama `feat/typescript`.
- **Método:** skill `security` (`references/metodo-revision.md`): mapa de superficie, herramientas automáticas, pasada con evidencia por hallazgo, severidad, arreglo con test y re-verificación. La pasada a fondo la hizo un subagente de solo lectura, sin ver las conclusiones del agente principal; los arreglos y la re-verificación, el agente principal.
- **Tarea:** F4-T2 · **Devlog:** entrada 027.

## Resumen

cmc no expone nada a la red y no tiene dependencias en tiempo de ejecución: el riesgo está en lo que hace en la máquina del usuario con su texto. No hay ningún hallazgo crítico ni alto. Se encontraron tres medios (pérdida de mensajes ante un fallo de disco, inyección de prompt a través del resumen de contexto y permisos del agente derivado más amplios de lo documentado) y cinco bajos. Todos están corregidos, con test de regresión. Quedan dos sospechas aceptadas con su motivo.

## Superficie

| Entrada | Quién la controla | Dónde |
|---|---|---|
| Prompt del usuario (`;;`, `>>`, palabras de control) | el usuario | hook `UserPromptSubmit` → `lib/capture.ts` |
| JSON del hook por stdin (`session_id`, `cwd`, `transcript_path`) | Claude Code | `lib/hook-io.ts` |
| Transcript de la sesión (incluye lo que el agente leyó de webs y ficheros) | **no confiable** | `lib/context-pack.ts` |
| Salida de un agente derivado | **no confiable** | `lib/agent-runner.ts`, `lib/agent-return.ts` |
| `config.json` | el usuario | `lib/config.ts` |
| Argumentos de la CLI | el usuario | `bin/cmc.ts` |
| Procesos lanzados (`claude`, `git`, `taskkill`) | cmc | `lib/dispatch.ts`, `lib/worktree.ts` |

## Herramientas automáticas

```
$ npm audit --audit-level=high
found 0 vulnerabilities
$ (dependencias del plugin) plugins/cmc/package.json → dependencies: {}
$ búsqueda de secretos en lo versionado (claves, tokens, contraseñas, claves privadas) → sin resultados
$ búsqueda de red en el plugin (fetch, http, https, net) → sin resultados
```
`gitleaks`, `semgrep` y `osv-scanner` no están instalados en esta máquina; se sustituyeron por las búsquedas anteriores y la revisión manual.

## Hallazgos

| Id | Severidad | Qué | Estado |
|---|---|---|---|
| F1 | Media | El hook `Stop` sacaba los mensajes de la cola antes de escribir su estado: si esa escritura fallaba (antivirus, fichero de solo lectura), los mensajes se perdían | Corregido |
| F2 | Media | El resumen de contexto citaba el transcript sin neutralizar: un `</session-summary>` o un `gitBranch`/`cwd` con saltos de línea salían del bloque marcado como contexto y podían suplantar la tarea | Corregido |
| F3 | Media | El agente derivado solo recibía `--allowedTools` (preaprobar), no una restricción: heredaba los `permissions.allow` del proyecto y el usuario, y el README prometía «sin shell, sin red» | Corregido |
| F4 | Baja | Al retirar un worktree «limpio» se borraban los ficheros que el agente dejó en rutas de `.gitignore` | Corregido |
| F5 | Baja | `state.json` se leía y reescribía sin cerrojo: dos escritores a la vez (hook `Stop`, supervisor, CLI) podían perder una marca | Corregido |
| F6 | Baja | Con un pid reutilizado (registro «running» de antes de reiniciar), `;;cancel` podía matar un proceso ajeno; en POSIX, un `kill` fallido lanzaba un error sin capturar | Corregido |
| F7 | Baja | Las líneas de continuación de un mensaje liberado solo se sangraban tras `\n`: con `\r` o U+2028 un informe de agente podía simular un elemento nuevo de la lista | Corregido |
| F8 | Baja | En POSIX, cola, prompts y logs se creaban con 0644/0755: legibles por otros usuarios de la máquina | Corregido |
| S1 | Sospecha | Un transcript enorme podía hacer pasar del tiempo límite al hook de `>>`, que entonces dejaría pasar la tarea al agente principal | Mitigado |
| S2 | Sospecha | Una regla de herramienta con coma (`Read(x,Bash)`) podría partirse en dos herramientas al pasarla a `--allowedTools` | Corregido |
| S3 | Sospecha | Al romper un cerrojo caducado (más de 10 s) dos procesos podrían borrarse el cerrojo recién creado el uno al otro | Aceptado |

### Arreglos

- **F1** (`lib/release.ts`): el hook toma y limpia las entregas pendientes en una sola operación con cerrojo, y saca los mensajes de la cola como último paso antes de responder. Si algo falla antes, los mensajes siguen retenidos. *Test:* `F1 — the Stop hook never loses held messages` (estado imposible de escribir → la cola conserva el mensaje y se entrega al volver a funcionar).
- **F2** (`lib/context-pack.ts`): todo lo que viene del transcript (mensajes, carpeta, rama, rutas) se cita en una línea y con `<`/`>` sustituidos por `‹`/`›`; la tarea del usuario va antes del resumen. *Test:* `F2 — transcript content cannot leave the summary` (un único cierre de bloque y una única cabecera de tarea con un transcript hostil).
- **F3** (`lib/dispatch.ts`, `lib/config.ts`): se pasa también `--tools` con las herramientas integradas configuradas, que limita las que el agente tiene, digan lo que digan los ajustes del proyecto. *Test:* `F3 — …`. *Prueba real:* pedirle al derivado que use Bash → «NO-BASH-TOOL … Bash is disabled for this session». **Contrapartida medida:** con el prompt distinto el fork pierde la caché; una derivación de prueba pasó de unos 0,003 $ a 0,156 $ (modelo haiku). Nuevo ajuste `dispatch.restrictTools` (por defecto `true`) para quien prefiera el coste bajo.
- **F4** (`lib/worktree.ts`): `git status --ignored` cuenta los ficheros ignorados como trabajo; ese worktree se conserva. *Test:* `F4 — …`. *Prueba real:* el worktree del agente que solo lee se sigue retirando.
- **F5** (`lib/session-state.ts`, `lib/queue.ts`): el estado se cambia con `updateStateWith`, bajo el mismo cerrojo que la cola. *Test:* `F5 — …` (ocho procesos a la vez, ninguna marca perdida).
- **F6** (`lib/agents-registry.ts`, `lib/dispatch.ts`): un registro activo de antes del último arranque del equipo es `lost` y no se cancela; el `kill` de reserva en POSIX ya no lanza. *Test:* `F6 — …`.
- **F7** (`lib/release.ts`): se sangra tras cualquier salto de línea (`\r\n`, `\r`, `\n`, U+2028, U+2029, U+0085). *Test:* `F7 — …`.
- **F8** (`atomic-write.ts`, `paths.ts`, `agents-registry.ts`, `agent-runner.ts`, `dispatch.ts`, `log.ts`): ficheros `0600` y carpetas `0700`. *Test:* `F8 — …` (se salta en Windows, que no usa esos permisos).
- **S1** (`lib/context-pack.ts`): un transcript de más de 4 MB se lee por su cabeza (512 KB) y su cola (2 MB). *Test:* lectura de un transcript de más de 4 MB que conserva la primera y la última petición.
- **S2** (`lib/config.ts`): la regla de herramienta no admite comas. *Test:* incluido en `F3 — …`.
- **S3:** aceptado. Solo ocurre tras un cerrojo abandonado más de 10 s (un proceso muerto a mitad de operación) y el peor caso es una operación de cola concurrente más; la cola sigue escribiéndose de forma atómica.

## Revisado y correcto

- **Inyección de comandos:** todos los procesos se lanzan con argumentos en array y sin shell; la tarea entra por stdin; los nombres de worktree y rama son `cmc-<8 hex>`; las líneas `` !`…` `` de los comandos solo expanden variables del plugin, nunca argumentos del usuario.
- **Rutas:** ids de sesión y de agente validados antes de usarlos como carpeta; la limpieza por antigüedad no sigue enlaces ni junctions; la retirada de worktrees solo actúa sobre la rama del agente, sin `--force`.
- **Permisos del derivado:** ninguna vía hacia `bypassPermissions` ni `--dangerously-skip-permissions`.
- **Datos:** el texto de los mensajes no va al log; no hay código de red; los ajustes inválidos caen a sus valores por defecto.

## Re-verificación

```
$ npx tsc --noEmit → exit 0
$ npm test → tests 241 · pass 241 · fail 0      (13 tests de seguridad nuevos)
$ npm run lint → 48 modules checked, 0 failed
Prueba real del aislamiento (repositorio git temporal): el derivado que edita conserva su worktree con notes.txt; el que solo lee se retira.
Prueba real de herramientas: el derivado no tiene Bash.
```

## Pendiente fuera de esta revisión

- F8 y F6 en macOS/Linux solo están cubiertos por tests en Windows (F8 se salta allí).
- Si `cmc` está instalado para el usuario, el agente derivado también lo carga y su sesión aparece como abierta para la CLI (entrada 023). No es un fallo de seguridad.
