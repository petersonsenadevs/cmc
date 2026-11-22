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
