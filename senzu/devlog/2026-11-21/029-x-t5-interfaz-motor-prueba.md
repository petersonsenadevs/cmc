# 029 — X-T5: prueba de la interfaz en el motor de plugins

- **Fecha/hora:** 2026-11-21 18:01
- **Tipo:** feature
- **Mejora a:** 006, 011
- **Tarea:** X-T5
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- La prueba interactiva de Peterson (captura de pantalla) mostró que retener con el hook `UserPromptSubmit` deja el mensaje en la barra del chat, imprime tres líneas por mensaje y no ofrece forma visible de gestionarlo. Volver a pulsar Enter lo retenía otra vez («2 held» con un solo mensaje).
- `hooks/interface.ts` (nuevo): en el módulo del motor, `prompt.submit` retiene `;; texto` al pulsar Enter y lo descarta con un aviso de una línea; si la barra sigue mostrando el texto, la vacía. Comandos propios `/held` y `/send` (`immediate`: corren con el agente trabajando; respuesta solo para la persona, el modelo no la ve).
- Todo lo que toca la cola pasa por la CLI (`hold --stdin`, `list`, `send`, `take`), así que cerrojo, escrituras atómicas y reglas son las del núcleo. Si la capa del motor falla, el prompt sigue a los hooks de comando de siempre.
- `hooks/module.ts` (nuevo): único módulo que carga el motor; un solo `session.start` arranca indicador e interfaz (el validador del motor no deja dos).
- Núcleo: `sendMessages` (ahora si el agente está parado, al terminar el turno si trabaja) y `takeMessages` (por id).
- Lint: se salta los `.d.ts` que Claude Code escribe en `.claude-plugin/types` al cargar el módulo; el `tsconfig.json` que escribe en `plugins/cmc` va al `.gitignore`.

## Fallo real encontrado y corregido
- Primera versión de `/send`: vaciaba la cola y después enviaba. En una sesión real sin interfaz el motor rechazó el envío y el mensaje («mango») se perdió.
- Arreglo (D-034): `send` no saca nada; se envía, y solo si el motor acepta el prompt (ni rechazo ni `drop`) se llama a `take <ids>`. Si no, el mensaje sigue retenido y se avisa. Dos tests de regresión (envío rechazado, envío descartado por un hook).

## Commits
- `ef2548f` feat(interface): hold on enter and add /held and /send commands

## Decisiones (resumen; detalle en DECISIONES.md)
- D-034: un mensaje solo sale de la cola cuando su envío se ha aceptado (ver DECISIONES.md#dev-028).

## Verificación
```
$ npm test → ℹ pass 259 · ℹ fail 0   (17 tests nuevos en test/interface.test.ts)
$ npx tsc --noEmit → 0 · npm run lint → 51 modules checked, 0 failed
$ claude plugin validate ./plugins/cmc → ✔ Validation passed with warnings (icono; reglas del directorio público)

Sesión real (claude -p, haiku, --plugin-dir):
  ";; di también mango"  → Prompt dropped by a hook: cmc: held (1). /held shows them, /send sends them.   $0
  "/send" (sin interfaz) → Could not send them now; they are still held. /cmc:release sends them as a prompt.   $0
  "/held"                → 1 held message, in delivery order: 1. [17:59 · 162cbf8e] di también mango   $0
```
- Nota de banco de pruebas: Git Bash convierte `/held` en `C:/Program Files/Git/held` al pasarlo a un programa; hay que exportar `MSYS_NO_PATHCONV=1` (los `/cmc:release` se libraban por los dos puntos).

## Pendiente de ver (solo en el terminal interactivo)
- Que la barra se vacía de verdad, cómo se ve el aviso corto, que `/held` y `/send` salen al escribir `/` y que `/send` con el agente parado arranca el turno.

## Próximos pasos
- Guion interactivo de Peterson; según lo que vea, construir /edit, /drop, /move, /agent y el panel.
