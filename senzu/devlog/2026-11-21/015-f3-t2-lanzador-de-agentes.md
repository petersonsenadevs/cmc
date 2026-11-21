# 015 — F3-T2: lanzador de agentes derivados

- **Fecha/hora:** 2026-11-21 01:53
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F3-T2
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `lib/dispatch.mjs`: `dispatch()` registra el agente, guarda su prompt en un fichero y lanza un supervisor desacoplado; vuelve enseguida. `buildCommand()` arma la línea de `claude` como array (sin shell): `-p --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools Read,Glob,Grep,Edit,Write --resume <id> --fork-session`. `cancelAgent()` mata el árbol de procesos (`taskkill /T /F` en Windows, grupo de procesos en POSIX).
- `lib/agent-runner.mjs`: el supervisor. Ejecuta `claude`, le pasa el prompt por stdin, vuelca su salida en `output.jsonl` y, al terminar, anota estado (`finished` o `failed`), código de salida, resumen final, id de sesión del fork y coste.
- `lib/agents-registry.mjs`: una carpeta por agente bajo la sesión (`agents/<id>/agent.json`, `prompt.txt`, `output.jsonl`, `stderr.log`). Un agente que figura activo pero cuyos procesos ya no existen se muestra como `lost`.
- El texto del usuario nunca va en la línea de comandos: viaja en un fichero y entra por stdin (tampoco choca con el límite de longitud de Windows).
- Permisos: `acceptEdits` por defecto, lista de herramientas validada; `bypassPermissions` se rechaza siempre (D-002).
- `test-support/fake-claude.mjs`: ejecutable de pega para los tests.

## Commits
- `72e45bb` feat(dispatch): launch a second agent under a detached supervisor

## Decisiones (resumen; detalle en DECISIONES.md)
- D-018 supervisor desacoplado por agente y prompt por stdin (ver DECISIONES.md#dev-015).

## Verificación
```
$ npm test                                   (seis veces seguidas)
ℹ tests 146 · pass 146 · fail 0
$ npm run lint
lint: 36 modules checked, 0 failed

$ node real-dispatch.mjs      (sesión real que lee notes.txt; se deriva «dime el nombre en clave sin usar herramientas»)
origin session bb6c35e0-…
dispatched b901043e in 30 ms; command: claude --model haiku --setting-sources project -p --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools Read,Glob,Grep,Edit,Write --resume bb6c35e0-… --fork-session
state=finished exit=0 after 3.6 s cost=$0.0032…
summary: The project codename is HERON. I know it from the notes.txt file I read earlier in this conversation …
```
- Tests: termina bien, sale con error, resultado marcado como error, ejecutable inexistente, cancelación (los dos procesos mueren y el supervisor no pisa el estado), texto con comillas y `$(…)` que no se ejecuta ni aparece en los argumentos.

## Desviaciones
- Fallo intermitente al depurar: tres tests fallaban a ratos con `EPERM` al borrar su carpeta temporal. Causa: Windows mantiene bloqueada la carpeta que fue directorio de trabajo de un proceso un rato después de que termine. Los procesos de los tests arrancan ahora en la carpeta temporal del sistema. No afecta al producto (el directorio de trabajo es el proyecto, que no se borra).
- La prueba real fijó `--model haiku` a mano; el lanzador no pasa modelo, así que el derivado usa el del usuario por defecto.
- Cancelación en macOS/Linux no ejecutada (solo Windows).

## Próximos pasos
- F3-T3: worktree del agente derivado (`--worktree cmc-<id>`).
