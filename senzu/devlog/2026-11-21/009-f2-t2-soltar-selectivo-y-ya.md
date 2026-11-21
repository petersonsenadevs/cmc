# 009 — F2-T2: soltar de forma selectiva y en modo «ya»

- **Fecha/hora:** 2026-11-21 01:31
- **Tipo:** feature
- **Mejora a:** 006
- **Tarea:** F2-T2
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- Palabra de control `;;now [N…]`: el prompt pasa y los mensajes elegidos (o toda la cola) van como `additionalContext` de `UserPromptSubmit`, así que llegan en el siguiente paso del agente. Sin nada retenido, el prompt se bloquea para no abrir un turno vacío.
- `;;end [N…]`: entrega selectiva al terminar el turno. La selección se guarda por id de mensaje, no por posición, así que sobrevive a reordenar o borrar después.
- CLI `cmc release [N…] [--now|--end]`: arma la entrega desde fuera de la sesión. Con `--now` (por defecto) la entrega el nuevo hook `PostToolUse` (`hooks/tool-release.mjs`) tras la siguiente herramienta; si el agente no da más pasos, la entrega el hook `Stop`.
- `lib/session-state.mjs`: el estado pasa de una marca a dos selecciones pendientes (`atEnd`, `atNextStep`: nada, todo o una lista de ids), que se acumulan.
- `scripts/e2e.mjs`: opción `--cli` para lanzar la CLI desde fuera a mitad de turno.
- README y ADR 001 actualizados (el canal `PostToolUse` sí funciona con la cabecera factual).

## Commits
- `cd0b501` docs(devlog): close F2-T1
- `39919c8` feat(release): add selective release and release now

## Decisiones (resumen; detalle en DECISIONES.md)
- Aplica D-007 y D-011. D-012: `cmc release --now` usa `PostToolUse` con respaldo en `Stop` (ver DECISIONES.md#dev-009).

## Verificación
```
$ npm test
ℹ tests 85 · pass 85 · fail 0
$ npm run lint
lint: 23 modules checked, 0 failed

$ node scripts/e2e.mjs --mid ";; reply with the word papaya" --mid ";; reply with the word mango" --mid ";;now 2" --after ";;now"
  8.8s  NOTICE     Held (2 queued). ...
  8.8s  DELIVERED  ;;now 2
 24.6s  AGENT      step1, step2, step3 — mango
 25.7s  DELIVERED  ;;now
 25.7s  AGENT      papaya
 29.3s  QUEUE      0 held after the session: []

$ node scripts/e2e.mjs --mid ";; reply with the word guava" --cli "release --now"
  8.4s  NOTICE     Held (1 queued). ...
  9.9s  CLI        cmc release --now → 1 held message(s) will be released at the agent's next step, or when its turn ends if it takes none.
 23.4s  AGENT      step1, step2, step3 — guava
 26.8s  QUEUE      0 held after the session: []
```

## Desviaciones
- La tarjeta pedía `/cmc:release 2`. La selección se hace con `;;now 2` o `;;end 2` (D-011): los argumentos de un comando acaban dentro de su línea de shell.
- El modo «ya» depende de cómo pondere el modelo un texto que llega a mitad de tarea: una ejecución por vía, las tres obedecidas. El README lo presenta como mejor esfuerzo y el fin de turno como camino fiable.
- El hook `PostToolUse` añade un proceso de Node por cada herramienta del agente (lee un fichero de estado y sale).

## Próximos pasos
- F2-T3: escribir desde otra terminal con la CLI `cmc` (encontrar la sesión por carpeta).
