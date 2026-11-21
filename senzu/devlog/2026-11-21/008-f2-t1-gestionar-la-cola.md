# 008 — F2-T1: gestionar la cola (ver, editar, borrar y reordenar)

- **Fecha/hora:** 2026-11-21 01:28
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F2-T1
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- `lib/queue.mjs`: `editMessage`, `removeMessages`, `clearMessages` y `moveMessage`, por posición (1 = el primero que se entrega), todas bajo el cerrojo. Una posición que no existe no cambia nada y devuelve `NO_SUCH_MESSAGE`.
- `lib/control.mjs`: palabras de control tras el prefijo, sin espacio: `;;list`, `;;edit N texto`, `;;rm N…`, `;;clear`, `;;move N M`, `;;up N`, `;;down N`, `;;top N`, `;;bottom N`, `;;end`, `;;help`. La gramática es estricta: lo que no encaja exactamente se retiene como mensaje (`;;list the files` es un mensaje).
- `lib/queue-view.mjs`: listado con posición, hora, id y texto (aplanado y recortado a 160 caracteres).
- `bin/cmc.mjs`: los mismos comandos en la CLI (`cmc list|edit|rm|clear|move|up|down|top|bottom|end --session <id>`), que reutilizan la gramática y la ejecución de las palabras de control.
- `commands/queue.md` → `/cmc:queue`: muestra el listado.
- `README.md`: tabla de palabras de control.
- Corregidas las horas de las entradas 003 a 007 del devlog: estaban estimadas, ahora llevan la hora real de su commit.

## Commits
- `fef6ea4` docs(devlog): close F1-T6 and split the interactive script
- `70a219e` feat(queue): view, edit, delete and reorder held messages

## Decisiones (resumen; detalle en DECISIONES.md)
- D-011 la cola se gestiona con palabras de control, no con argumentos de comando (ver DECISIONES.md#dev-008).

## Verificación
```
$ npm test
ℹ tests 68 · pass 68 · fail 0
$ npm run lint
lint: 21 modules checked, 0 failed

$ node scripts/e2e.mjs --mid ";; reply with the word pineapple" --mid ";; reply with the word mango" --mid ";; reply with the word guava" --mid ";;edit 1 reply with the word papaya" --mid ";;rm 2" --mid ";;top 2" --mid ";;list" --after "/cmc:release"
 10.6s  NOTICE  Held (3 queued). ...
 10.6s  NOTICE  Message 1 updated. 3 held messages, in delivery order: 1. [01:26 · 7d425454] reply with the word papaya 2. ... mango 3. ... guava
 10.6s  NOTICE  Deleted 1 held message(s). 2 held messages, in delivery order: 1. ... papaya 2. ... guava
 10.6s  NOTICE  Message 2 is now first. 2 held messages, in delivery order: 1. ... guava 2. ... papaya
 10.6s  NOTICE  2 held messages, in delivery order: 1. [01:26 · 489e3701] reply with the word guava 2. [01:26 · 7d425454] reply with the word papaya
 24.0s  AGENT   step1, step2, step3
 25.9s  AGENT   guava papaya
 29.4s  QUEUE   0 held after the session: []
```
- Editar, borrar y reordenar a mitad de turno no interrumpen al agente ni le llegan; al soltar recibe exactamente el orden del último listado.

## Desviaciones
- La tarjeta ponía la gestión en `/cmc:queue`. Editar o mover desde un comando obligaría a meter texto del usuario en una línea de shell y pasaría por el agente; se hace con palabras de control (D-011) y `/cmc:queue` queda solo para ver.
- `/cmc:queue` enseña el listado al agente (los mensajes siguen retenidos, pero los ve). El README recomienda `;;list`, que no pasa por él.
- La CLI pide `--session <id>`; encontrar la sesión por carpeta es F2-T3.
- Archivos extra: `lib/control.mjs`, `lib/queue-view.mjs`.

## Próximos pasos
- F2-T2: soltar de forma selectiva y en modo «ya».
