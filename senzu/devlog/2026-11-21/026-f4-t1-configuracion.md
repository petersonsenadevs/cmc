# 026 — F4-T1: configuración del plugin

- **Fecha/hora:** 2026-11-21 03:25
- **Tipo:** feature
- **Mejora a:** 012, 024
- **Tarea:** F4-T1
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- `plugins/cmc/lib/config.ts`: `config.json` en el directorio de datos del plugin, con `holdPrefix`, `dispatchPrefix`, `dispatch.context` (fork|pack), `dispatch.return` (held|auto), `dispatch.permissionMode` (default|acceptEdits|plan), `dispatch.tools` y `retentionDays`.
- Validación a mano, sin dependencias. Cada valor erróneo cae a su valor por defecto con un aviso; los ajustes desconocidos también se avisan (para no tragarse una errata); un fichero que no es JSON deja todo por defecto. Nunca se acepta `bypassPermissions`. Los prefijos: 1 a 4 símbolos, sin letras, dígitos, espacios ni `/`, y uno no puede empezar por el otro.
- Los avisos salen al arrancar una sesión (`systemMessage`) y en `cmc config`.
- Conectado en todas partes: prefijos en la captura, valores por defecto de la derivación (con `--fork` y `--held` para invertir lo que fije la configuración), permisos y herramientas del derivado (hook y CLI), retención de sesiones, y la ayuda y los recibos de cmc nombran los prefijos en uso, sin tocar nunca el texto del usuario.
- CLI: `cmc config` (muestra lo vigente y los problemas) y `cmc config init` (escribe el fichero con los valores por defecto; nunca pisa uno existente, aunque esté mal).
- README: sección «Settings».

## Commits
- `17698d5` feat(config): add validated user settings

## Decisiones (resumen; detalle en DECISIONES.md)
- D-031 la configuración vive en `config.json` del directorio de datos, no en `userConfig` del manifiesto (ver DECISIONES.md#dev-025).

## Verificación
```
$ npx tsc --noEmit → exit 0 · npm run lint → 47 modules checked, 0 failed
$ npm test → tests 228 · pass 228 · fail 0   (tres veces; 17 tests nuevos)

Sesión real con { "holdPrefix": "%%" } en el directorio de datos:
  NOTICE     Held (1 queued). Release with /cmc:release. Original prompt: %% reply with the word quince
  NOTICE     1 held message(s) will be released when this turn ends. Original prompt: %%end
  DELIVERED  Stop hook feedback: [cmc] The user released their held message with "%%end": 1. reply with the word quince
  AGENT      quince
(después se retiró el fichero de prueba del directorio de datos)
```

## Desviaciones
- Fallo encontrado por los tests y corregido: una lista JSON (`[]`) pasaba por objeto válido.
- No hay `cmc config set`: el fichero se edita a mano tras `cmc config init`.
- La tarjeta hablaba de «modo de entrega por defecto»: tras D-030 no hay modos de entrega que elegir; el ajuste equivalente es `dispatch.return`.

## Próximos pasos
- F4-T2: revisión de seguridad.
