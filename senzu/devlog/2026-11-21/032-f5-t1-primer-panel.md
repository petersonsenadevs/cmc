# 032 — F5-T1: primer panel de control (pendiente de la prueba de Peterson)

- **Fecha/hora:** 2026-11-21 18:37
- **Tipo:** feature
- **Mejora a:** 030, 031
- **Tarea:** F5-T1
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- `hooks/panel.ts` (nuevo): `/cmc` abre un panel del motor junto al chat (`$.ui.open`, `closeOnEscape`), pintado por un hook `ui.render` sobre `Pane`: cabecera «✉ N held», una fila por mensaje con **Send** y **Delete**, y **Send all** y **Clear**. Estado vacío con la indicación de cómo retener.
- Cada clic pasa por la CLI (`send`, `take <id>`, `clear`) y repinta al momento; cada segundo se compara el fichero de la cola y, si cambió, `$.ui.invalidate('ui.render')`.
- Los botones actúan por id del mensaje, no por posición: si la cola cambió entre pintar y hacer clic, se borra o envía el mensaje correcto.
- Sin JSX: los elementos se llaman como funciones (`Box({ ... })`), así el panel se prueba con `node --test` como el resto.
- Sin panel (sin pantalla o terminal estrecha) `/cmc` lo dice y sugiere `/held`.

## Commits
- `265bdcb` feat(panel): open a control panel with the held messages and buttons

## Verificación
```
$ npm test → ℹ pass 292 · ℹ fail 0   (test/panel.test.ts: 10 tests)
$ npx tsc --noEmit → 0 · npm run lint → 54 modules checked, 0 failed · claude plugin validate ./plugins/cmc → ✔
$ claude -p "/cmc" (sin pantalla) → cmc: The cmc panel cannot be shown here … use /held.   $0
```

## Pendiente (para cerrar F5-T1)
- Prueba de Peterson en su terminal: que el panel se ve, que un clic con el ratón en Send/Delete actúa y que se repinta solo al retener otro mensaje; ancho mínimo en su pantalla.
