# 046 — X-T10: artículo para dev.to con capturas reales del hub

- **Fecha/hora:** 2026-11-22
- **Tipo:** docs
- **Mejora a:** 044
- **Tarea:** X-T10
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: «tenemos un token de dev.to, hagamos una publicación en inglés… captura /cmc más el logo y firma como reverse junto con el git».
- Capturas reales de una sesión de demo (`D:\cmc-demo`, ventana propia de Windows Terminal, `--setting-sources project,local`, sin `NO_COLOR`): Peterson escribió en la demo y el agente solo capturó (enviar teclas desde fuera acabó una vez en la ventana equivocada; ver Lo que no funcionó).
- `docs/images/`: `held-delivered.png` (lo retenido llega al acabar el turno), `hub-messages.png` (hub con dos retenidos y el agente trabajando), `hub-subagent.png` (subagente haiku y su chat). Sin datos personales: solo `D:\cmc-demo`.
- Borrador del artículo en inglés: `senzu/informes/2026-11-22-articulo-devto.md` (front matter de dev.to, `published: false`, portada = logo oscuro, firma r3v3rs3 → github.com/petersonsenadevs). Las imágenes apuntan a `main` en raw.githubusercontent: hay que llevar este commit a `main` antes de publicar.

## Lo que no funcionó
- `SendKeys` desde un proceso en segundo plano: si Windows no da el foco a la ventana de demo, las teclas van a la ventana activa (escribió `/exit` en la sesión del agente). No volver a enviar teclas sin comprobar `GetForegroundWindow`; mejor que conduzca la persona.
- La consola clásica (conhost) no tiene los glifos; la ventana heredaba `NO_COLOR=1` y salía sin color.

## Próximos pasos
- Peterson revisa el texto; llevar a `main`; con su aprobación expresa, subirlo a dev.to como borrador por la API (`DEVTO_API_KEY`, sin leerla ni mostrarla).

## Subida a dev.to (aprobada por Peterson: «súbelo como borrador y usa tags suficientes para atraer público»)
- Borrador creado por la API: id 5091026, usuario r3v3rs3, `published: false`.
- URL (borrador): https://dev.to/r3v3rs3/cmc-stop-interrupting-claude-code-hold-your-messages-hand-tasks-to-subagents-47j2-temp-slug-4774289
- Etiquetas (máximo 4 en dev.to): ai, programming, productivity, opensource (las de más público; Claude va en el título).
- Imágenes del cuerpo desde `feat/typescript` (cargan ya, 200); portada = logo de `main` (200).

## Verificación
```
$ verify-build → lint PASS · types PASS · test PASS (344) · build SKIP (no hay script)
$ curl raw.githubusercontent.com/... → held-delivered 200 · hub-messages 200 · hub-subagent 200 · logo 200
$ POST https://dev.to/api/articles → 201, published: false
```

## Portada y 1.1.1 (2026-11-22, más tarde)
- Peterson: «la imagen de portada no cabe». Portada nueva `docs/images/cover.png` a 1000×420 (el tamaño de dev.to), con el logo oscuro centrado.
- Artículo al día con la 1.1.1: abreviaturas `-m -e -w -s -a`, la pestaña Help y el enlace al repositorio con el texto «cmc».
- Borrador actualizado por la API: `PUT /api/articles/5091026` → 200, `published: false`, portada servida por media2.dev.to a 1000×420.

## Publicado (Peterson: «publícalo»)
- Imágenes y portada apuntando a `main` (ya con v1.1.1; las cuatro dan 200).
- `PUT /api/articles/5091026` con `published: true` → 200. Público desde 2026-11-22T00:57:54Z: https://dev.to/r3v3rs3/cmc-stop-interrupting-claude-code-hold-your-messages-hand-tasks-to-subagents-25m6 (la página responde 200).
- Release 1.1.1: notas en `senzu/informes/2026-11-22-release-1.1.1.md`; la crea Peterson en GitHub (aquí no hay `gh` ni se toca su token).
