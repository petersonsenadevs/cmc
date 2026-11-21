# 036 — F5-T3: el panel como centro de control (pestañas, modos, filas, subagentes, actividad)

- **Fecha/hora:** 2026-11-21 21:06
- **Tipo:** feature
- **Mejora a:** 032, 033, 034
- **Tarea:** F5-T3 (y adelanta parte de F5-T4 y F5-T5)
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: «la UI más interactiva, con opciones cómodas y modos»; eligió la paleta violeta. ADR 003 §7 recoge los modos.
- **Núcleo:** ajuste `holdTarget` (`main` | `subagent`): con `subagent`, lo que se escribe tras el prefijo arranca un subagente en vez de esperar al principal (hook de comando y módulo, con `cmc hold --typed`). `setMode()` y `cmc config set <modo> <valor>` para `sendAtEnd`, `holdTarget`, `dispatch.context`, `dispatch.return`, conservando el resto del fichero y sin sobrescribir uno roto. `cmc agents --format json`.
- **Panel** (`hooks/panel.ts`, reescrito): cabecera con el estado del agente; pestañas Messages · Subagents · Activity (teclas 1 2 3); franja de modos (botón primario el que está en vigor; un clic lo cambia en `config.json`); filas que se eligen con un clic y muestran sus acciones (Send now, To subagent, Edit, ↑, ↓, Delete; teclas s a e d); qué pasará con cada mensaje; edición en la propia fila (`Input`); caja para retener sin prefijo (o para un subagente en modo Subagent); Send all y Clear; subagentes con estado coloreado, tiempo y contexto, y al elegir uno, lo que se le envió, con qué contexto, su respuesta, su rama y ficheros, Stop y «Send result to main»; actividad en lugar de toasts (las dos últimas líneas bajo cada vista); paleta violeta.
- **Send now** (D-038): agente parado → prompt nuevo al momento; trabajando → el texto va a la caja de entrada (tras el borrador, si lo hay) para Ctrl+Enter; el mensaje sale de la cola cuando el hook `prompt.submit` ve que se envió.

## Commits
- `3f39477` feat(panel): make the panel the place to control everything

## Verificación
```
$ npm test → ℹ pass 312 · ℹ fail 0   (test/panel.test.ts reescrito: 25 tests; config: modos y holdTarget)
$ npx tsc --noEmit → 0 · npm run lint → 54 modules checked, 0 failed · claude plugin validate ./plugins/cmc → ✔
$ cmc config set holdTarget subagent / dispatch.context pack → escritos conservando "holdPrefix"; "sendAtEnd maybe" rechazado
```

## Pendiente
- Prueba de Peterson en su terminal (aspecto, clics, Input, Ctrl+Enter).
- Pasos del subagente mientras trabaja y escribirle (F5-T6), pasar resultados entre subagentes (F5-T7), apertura automática (F5-T8).
