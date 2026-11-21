# 014 — X-T1: portabilidad entre Windows, macOS y Linux

- **Fecha/hora:** 2026-11-21 01:54
- **Tipo:** fix
- **Mejora a:** 004, 010
- **Tarea:** X-T1
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
Peterson pidió que el plugin fuera multi-OS, con cuidado en barras y rutas. Revisión del código hecha por el agente principal; correcciones aplicadas por un subagente y revisadas después.

- **Renombrados atómicos** (`lib/atomic-write.mjs`, nuevo): la cola, el estado y el registro de sesión escribían con temporal + `renameSync`. En Windows ese renombrado falla un instante si otro proceso tiene abierto el destino (el indicador lo lee cada segundo; un antivirus), y un fallo dentro del hook dejaba pasar al agente un mensaje que se quería retener. Ahora se reintenta hasta 10 veces (unos 1,1 s) solo en Windows; en POSIX esos códigos son errores reales y se lanzan.
- **Carpetas por ruta real** (`lib/sessions.mjs`): en macOS la carpeta temporal es un enlace (`/var` → `/private/var`) y la CLI no habría encontrado la sesión. Se comparan rutas reales, sin distinguir mayúsculas en Windows y macOS, y se corrige el caso de la raíz del disco.
- **Cerrojo** (`lib/queue.mjs`): `EPERM` solo significa «ocupado» en Windows; en POSIX se lanza en vez de esperar 5 s. Al soltar el cerrojo se reintenta el borrado.
- **Entrada de los hooks** (`lib/hook-io.mjs`): lectura de stdin en bucle que tolera `EAGAIN` (POSIX) y `EOF` (Windows), en vez de `readFileSync(0)`.
- **Fichero suelto en `sessions/`** (p. ej. `.DS_Store`): ya no rompe el listado de sesiones.
- **`scripts/e2e.mjs`**: respeta `CLAUDE_CONFIG_DIR` y `CLAUDE_BIN`, y explica qué hacer si `claude` no es un ejecutable real.
- **Bit de ejecución** en git para `bin/cmc.mjs` y los cuatro hooks con shebang.
- `spike/fork-test.mjs` pasa a llamarse `spike/fork-probe.mjs`: `node --test` lo tomaba por un test.

## Commits
- `3def3df` docs(devlog): close F3-T1
- `d8e4cf4` fix: make file writes, folder matching and locks portable across OSes

## Decisiones (resumen; detalle en DECISIONES.md)
- Ninguna nueva: aplica la regla multi-OS de la entrada 012.

## Verificación
```
$ npm test
ℹ tests 135 · pass 135 · fail 0 · skipped 0
$ npm run lint
lint: 31 modules checked, 0 failed
$ claude plugin validate .
✔ Validation passed with warnings
$ git ls-files -s bin hooks
100755 bin/cmc.mjs   100755 hooks/prompt-capture.mjs   100755 hooks/session-register.mjs   100755 hooks/stop-release.mjs   100755 hooks/tool-release.mjs

$ node scripts/e2e.mjs --mid ";; reply with the word guava" --cli "hold reply with the word mango" --mid ";;end"
  8.3s  NOTICE     Held (1 queued). ...
 10.1s  CLI        cmc hold reply with the word mango → Held (2 queued).
 23.3s  DELIVERED  Stop hook feedback: [cmc] The user released their held messages with ";;end": 1. reply with the word guava 2. reply with the word mango
 24.8s  AGENT      guava mango
 28.6s  QUEUE      0 held after the session: []
```
- 18 tests nuevos: reintento del renombrado (con renombrado inyectado), carpetas con enlace real en los dos sentidos y a través de la CLI, carpeta borrada, raíz del disco, mayúsculas, cerrojo por plataforma, fichero suelto en `sessions/`.

## Lo que NO se ha podido comprobar
- **Nada se ha ejecutado en macOS ni en Linux.** El caso `/var` → `/private/var`, la rama de macOS sin distinción de mayúsculas, el `EPERM` del cerrojo en POSIX, `ENOTDIR` y `EAGAIN` están cubiertos por razonamiento o por tests con la plataforma inyectada.
- Una colisión real de renombrado en Windows solo se ha simulado.
- El bit de ejecución no se ve en un checkout de Windows; solo se confirmó el modo en el índice de git.
- En `commands/*.md`, un directorio de datos en ruta UNC (`\\servidor\recurso`) podría perder una barra bajo bash; depende de cómo sustituya Claude Code la variable y no se ha podido probar.

## Próximos pasos
- Probar la suite en macOS y Linux (lo ideal, un CI con las tres plataformas: va con F4).
- F3-T2: lanzador de agentes derivados.
