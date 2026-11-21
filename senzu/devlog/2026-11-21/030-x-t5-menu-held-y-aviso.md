# 030 — X-T5: menú /held, aviso al acabar el turno y Esc

- **Fecha/hora:** 2026-11-21 18:17
- **Tipo:** feature
- **Mejora a:** 029
- **Tarea:** X-T5
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Prueba de Peterson: la retención limpia funciona («ahora sí, me gusta»), pero pidió que sea intuitivo y fácil de manejar. Además, «di también piña» se quedó en la cola al terminar el agente: no hubo `/send` ni `;;end` (comprobado en el estado y el transcript de su sesión 08da61f1), y nada le recordó que estaba retenido.
- `/held` abre ahora el diálogo nativo de Claude Code (`$.ui.ask`): primero eliges el mensaje (hasta tres a la vista, «Send all N», y el número escrito en «Other» para los demás), luego la acción: Send · Edit · Delete · Hand to an agent. Un texto escrito en «Other» sustituye al mensaje en su sitio. «Edit» devuelve `;;edit N texto` a la barra para cambiarlo con calma. Con un solo mensaje se salta el primer paso.
- Sin diálogo (`-p`) o al cerrarlo: lista simple con las órdenes equivalentes; nada cambia.
- `turn.complete`: si al acabar un turno queda algo retenido, una línea en el transcript (no la ve el modelo): «cmc: 1 message is still held. /held to send, edit or delete, /send to send all.»
- Esc: un turno interrumpido no ejecuta el hook Stop y cmc seguía creyendo que el agente trabajaba (límite conocido del README). Ahora `turn.complete` con `reason: aborted` llama a `cmc idle`.
- CLI: `list --format json`, `dispatch --message N`, `idle`, y `--` para que un texto que empieza por guiones no se lea como opción.
- El aviso de sesión reanudada apunta a `/held`.

## Commits
- `0581005` feat(interface): add the /held menu and a reminder when a turn ends

## Verificación
```
$ npm test → ℹ pass 273 · ℹ fail 0   (14 tests nuevos: menú, aviso, Esc, CLI)
$ npx tsc --noEmit → 0 · npm run lint → 51 modules checked, 0 failed
$ claude plugin validate ./plugins/cmc → ✔ Validation passed with warnings

Sesión real (claude -p, haiku, --plugin-dir):
  ";; di también piña" → cmc: held (1). /held to send, edit or delete.   $0
  "Responde solo: hola" → ¡Hola! · y en el stream: cmc: 1 message is still held. /held to send, edit or delete, /send to send all.
  "/held" (sin diálogo) → cmc: 1 held: 1 · di también piña · /send [N] sends · ;;edit N text edits · ;;rm N deletes
```

## Pendiente de ver (terminal interactivo)
- Que el diálogo de `/held` se abre con el agente trabajando y se maneja con flechas; dónde y cómo se ve el aviso de fin de turno.

## Próximos pasos
- Prueba de Peterson; luego reordenar desde el menú si hace falta, y documentar en el README.
