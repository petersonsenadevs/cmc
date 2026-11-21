# 013 — F3-T1: el fork de sesión a mitad de turno, medido

- **Fecha/hora:** 2026-11-21 01:52
- **Tipo:** decisión
- **Mejora a:** —
- **Tarea:** F3-T1
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `spike/fork-probe.mjs`: crea un repositorio git de prueba, arranca una sesión origen (leer un fichero y tres pasos `sleep 8; echo`) y, a los dos segundos del segundo paso, lanza cuatro forks con `claude -p --resume <id> --fork-session`: en la misma carpeta, en otra carpeta, con `--worktree` y desacoplado desde un proceso lanzador que termina enseguida. Después mide una sesión nueva con un paquete de contexto de tres líneas.
- ADR `senzu/arquitectura/adr/002-derivacion-y-contexto.md` con la evidencia y el diseño de la derivación.

## Resultados
| Pregunta | Respuesta |
|---|---|
| (a) ¿El fork arranca con el origen a mitad de turno y no lo altera? | Sí: id de sesión propio, respuesta en unos 5 s; el origen termina su tarea igual |
| (b) ¿Qué ve si el transcript acaba en una herramienta sin resultado? | La ve como interrumpida, con resultado desconocido; no la repite |
| (c) ¿Se puede lanzar desacoplado y que sobreviva al proceso que lo lanza? | Sí, en Windows: `detached`, salida a fichero, `windowsHide`, `unref()` |
| (d) ¿Qué flags hay que volver a pasar? | Todos los de la línea de comandos (modelo, permisos, plugin). `--resume` encuentra la sesión desde otra carpeta y `--worktree` se combina con el fork |
| (e) ¿Coste frente al paquete de contexto? | Fork: 45 767 tokens de entrada (43 726 de caché), 0,00089 $. Paquete: 25 109 tokens, 0,00174 $ |

## Commits
- `59af571` docs(adr): record session fork behaviour and dispatch design

## Decisiones (resumen; detalle en DECISIONES.md)
- D-016 modo de contexto por defecto: fork; D-017 aislamiento con el `--worktree` de Claude Code (ver DECISIONES.md#dev-013).

## Verificación
```
$ node spike/fork-probe.mjs <scratch>
 13.4s  ORIGIN-TOOL  #3 sleep 8; echo step2
 15.4s  FORK         origin 10448be4-… is mid-turn; starting forks
 15.5s  DETACHED     launcher exited 0 after starting pid 28772
 19.9s  FORK-SAME    exit=0 session=05c2e32e-… sameAsOrigin=false
 19.9s  FORK-SAME    inputTokens=45767 cost=$0.00088901 answer: HERON is the codename from notes.txt; … step1 finished (output "step1"), while step2 was interrupted before its result came back …
 20.7s  FORK-OTHERCWD exit=0 … answer: HERON is the codename; … Only step1 is confirmed finished …
 22.2s  FORK-WORKTREE exit=0 … answer: Codename HERON (from notes.txt); …
 22.8s  ORIGIN-TOOL  #4 sleep 8; echo step3
 31.9s  ORIGIN       HERON — step1, step2, step3
 32.3s  DETACHED     finished after its launcher exited. session=b6a0a435-… answer: HERON is the codename …
 32.3s  BRANCHES     * main + worktree-cmc-spike-fork
 35.2s  PACK         inputTokens=25109 cost=$0.00173911 answer: Project codename is HERON; …
```

## Desviaciones
- Una sola ejecución válida (la primera falló solo al leer la salida: `--output-format json` devuelve una lista de mensajes), en Windows y con el origen en modo headless.
- Contra lo que suponía el plan, el fork salió más barato que el paquete en esta sesión corta: casi todo su historial se lee de caché. Con sesiones largas, caché caducada u otro modelo, se invierte.
- F3-T3 cambia de forma: el worktree lo crea Claude Code (`--worktree`), no el plugin.
- No se ha probado en macOS ni Linux el lanzamiento desacoplado (allí `detached` es el caso habitual y `windowsHide` no hace nada).

## Próximos pasos
- X-T1: integrar las correcciones de portabilidad.
- F3-T2: lanzador de agentes derivados.
