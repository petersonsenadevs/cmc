# 035 — F5-T2: diseño del panel aprobado (ADR 003)

- **Fecha/hora:** 2026-11-21 20:55
- **Tipo:** decisión
- **Mejora a:** 034
- **Tarea:** F5-T2
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- ADR 003 (`senzu/arquitectura/adr/003-panel-de-control.md`): el panel como centro de control («la UI debe ser el centro neurálgico», Peterson). Maqueta con mensajes, caja para retener, subagentes con su resultado y actividad en lugar de avisos sueltos; filas que se seleccionan; teclado; anchos; estado vacío; paleta propuesta.
- Peterson aprobó la maqueta y añadió: (1) ver lo que se envía a cada subagente y lo que responde → vista de conversación por subagente (§6); (2) Send debe enviar directo «como Ctrl+Enter».
- Ctrl+Enter, consultado en la documentación (keybindings, interactive-mode, mods API, mediante un subagente): es `chat:sendNow`; envía al momento, pasa a segundo plano lo que puede y si no interrumpe y envía. Ninguna llamada de plugin lo pulsa ni lo invoca; `$.prompt.submit` espera a que la sesión esté parada y `$.session.send` no es la caja de entrada local.
- Decisión D-038 (sustituye D-037): con el agente trabajando, Send pone el texto en la caja de entrada (`$.prompt.fill` funciona a mitad de turno) y la fila dice «Ctrl+Enter to send it now»; el mensaje sale de la cola cuando de verdad se envía (lo ve el hook `prompt.submit`).
- Colores: propuesta de paleta propia de cmc en el ADR; Peterson aún no ha elegido.

## Commits
- (los del cierre de este paso; ver INDEX)

## Verificación
- Peterson aprobó la maqueta (mensaje del 2026-11-21: «sí lo apruebo»), con las dos aclaraciones recogidas en §3 y §6.

## Próximos pasos
- F5-T3: sección de mensajes con el nuevo Send (D-038), filas seleccionables, edición en fila, caja para retener y actividad.
