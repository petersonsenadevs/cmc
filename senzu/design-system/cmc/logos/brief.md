# Brief del logotipo — cmc (Claude Message Control)

- **Fecha:** 2026-11-21 · **Autor del producto:** Peterson Sena (r3v3rs3) · **Tarea:** F5-T10
- **Para qué:** el logotipo del README (GitHub, marketplace) y, en pequeño, de la pestaña y la cabecera del panel. En la terminal
  se usa una marca en bloques de texto (abajo), así que el logotipo puede tener detalle.
- **Se genera con ChatGPT** (generación de imágenes). Aquí van el concepto, las reglas y los prompts listos para pegar.

## Qué es cmc (para quien lo diseñe)

Un plugin de Claude Code que es un **hub de control** de la conversación con un agente de IA: retiene lo que escribes mientras el
agente trabaja y lo suelta cuando quieres, sin interrumpirlo; y reparte tareas a subagentes que trabajan en paralelo y te devuelven
su resultado. Idea central: **tú decides cuándo llega cada mensaje** — orden, control, flujo, sin ruido.

Personalidad: técnica, precisa, tranquila; herramienta de desarrollador, no de marketing. Nada de robots, cerebros ni chispas mágicas.

## Concepto (tres direcciones; elegir una)

1. **El mensaje retenido.** Un bocadillo de chat cuyo borde es un corchete o una pausa (`‖`): el mensaje está ahí, esperando a que lo
   sueltes. Lectura inmediata de «mensaje en espera».
2. **El hub.** Un punto central del que salen tres o cuatro líneas que acaban en nodos pequeños (los subagentes), dentro de un
   cuadrado de esquinas redondeadas como una ventana de terminal. Lectura de «centro de control».
3. **El monograma.** Las letras `cmc` en minúscula, geométricas, de peso medio, donde la `m` central es un pequeño hub (sus dos
   arcos como dos flujos que salen de un tronco). Funciona como texto y como icono.

Recomendación: la **3** para el README (se lee el nombre) con el símbolo de la **2** como icono cuadrado aparte.

## Reglas visuales

- **Paleta (decidida):** violeta `#7C5CFF` como color principal; acentos opcionales ámbar `#F5A524` (trabajando), verde `#2BB673`
  (hecho). Sobre fondo oscuro `#0D0D12` o claro `#FFFFFF`: debe funcionar en los dos.
- **Formas:** geométricas, trazo uniforme, esquinas suavemente redondeadas, plano (sin degradados fuertes, sin 3D, sin sombras).
- **Legible a 32 px** (favicon/icono) y elegante a 512 px.
- **Tipografía del nombre:** sans geométrica o monoespaciada limpia (referencias: JetBrains Mono, Inter, Space Grotesk), minúsculas.
- **Evitar:** el logotipo o los colores de Anthropic/Claude (es un plugin independiente, no oficial), robots, cerebros, rayos,
  emojis, texto pequeño ilegible.

## Entregables

| Fichero | Qué | Tamaño |
|---|---|---|
| `logos/final/logo-dark.png` | Monograma + nombre, para fondo oscuro, fondo transparente | 1200×400 |
| `logos/final/logo-light.png` | Igual, para fondo claro | 1200×400 |
| `logos/final/icon.png` | Solo el símbolo, cuadrado, fondo transparente | 512×512 |
| `logos/final/logo.svg` | Si se puede vectorizar (ideal para el README) | — |

Cuando estén, se copian a `plugins/cmc/assets/` y el README los usa con `<picture>` (oscuro/claro).

## Prompts para ChatGPT (copiar y pegar)

**Monograma con nombre (README):**

> Design a minimal, flat vector logo for a developer tool called "cmc" (Claude Message Control), a control hub that holds chat
> messages and dispatches tasks to sub-agents. Lowercase geometric letters "cmc"; the middle "m" subtly forms a hub: a central stem
> with two arcs flowing out like two message streams. Uniform stroke weight, softly rounded corners, no gradients, no 3D, no shadows.
> Main color violet #7C5CFF on a transparent background, readable on dark (#0D0D12) and light backgrounds. To the right, the wordmark
> "Claude Message Control" in a clean geometric sans, and below it small "by r3v3rs3". Wide format 1200×400. Professional, calm,
> technical. Do not use the Anthropic or Claude logo, no robots, no brains, no sparkles.

**Icono cuadrado:**

> A minimal flat app icon, 512×512, transparent background: a rounded square outline like a terminal window, with a small central dot
> connected by three short lines to three smaller nodes (a control hub dispatching to sub-agents). Violet #7C5CFF, one small amber
> #F5A524 node as an accent. Uniform stroke, no gradients, no shadows, legible at 32 px.

**Variante «mensaje retenido»:**

> A minimal flat logo mark: a chat speech bubble whose right edge is a pause symbol (two vertical bars), meaning "message on hold,
> released when you decide". Violet #7C5CFF, uniform stroke, rounded corners, transparent background, legible at 32 px, no text.

Pide a ChatGPT 3–4 variantes de la que elijas y, sobre la mejor: «same design, version for light background» y «only the symbol,
square 512×512».

## Marca en la terminal (ya hecha, sin esperar al logotipo)

En la cabecera del panel y arriba del README, dos líneas de medios bloques, en violeta:

```
▄▀▀ █▀▄▀█ ▄▀▀   Claude Message Control
▀▄▄ █ ▀ █ ▀▄▄   by r3v3rs3
```
