# 022 — F3-T4: paquete de contexto ligero

- **Fecha/hora:** 2026-11-21 02:47
- **Tipo:** feature
- **Mejora a:** —
- **Tarea:** F3-T4
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- `plugins/cmc/lib/context-pack.ts`: `buildContextPack` lee el transcript de la sesión y saca un resumen acotado: carpeta y rama, la primera petición del usuario, los últimos 5 intercambios (700 caracteres por mensaje), los ficheros que la sesión cambió y los que solo leyó (25 como máximo, relativos a la carpeta).
- Solo cuenta lo que el usuario escribió: se descartan resultados de herramientas, notas generadas por la aplicación, comandos y prompts de subagentes.
- Formato desconocido, fichero ilegible o sin ruta: no rompe. El paquete se queda en «tarea + carpeta» y lleva un aviso que se guarda en la ficha del agente (`contextWarning`).
- `packPrompt`: el resumen va dentro de `<session-summary>`, etiquetado como contexto y no como instrucciones; la tarea del usuario va fuera.
- `dispatch({ mode: 'pack', transcriptPath })`: el agente arranca como sesión nueva (sin `--resume`) con ese prompt.

## Commits
- `67db3b8` feat(dispatch): add the context pack as a light alternative to the fork

## Decisiones (resumen; detalle en DECISIONES.md)
- Aplica D-016 (fork por defecto, paquete como alternativa). Sin decisiones nuevas.

## Verificación
```
$ npx tsc --noEmit → exit 0 · npm run lint → 40 modules checked, 0 failed
$ npm test → tests 170 · pass 170 · fail 0     (9 nuevos; transcript de ejemplo, uno de formato desconocido, uno vacío y uno inexistente)

Sobre un transcript real de Claude Code 2.1.330 (sesión de la prueba de F3-T3):
<session-summary>
Folder: <S>\rw2\repo (branch main)
First request of the user there: Read notes.txt with the Read tool and reply with the single word ok.
Latest exchanges, oldest first:
- User: Read notes.txt with the Read tool and reply with the single word ok.
  Agent: ok
Files that session read: notes.txt
</session-summary>
(prompt completo: 938 caracteres)
```

## Desviaciones
- No se ha lanzado un agente real en modo paquete: los tests usan el ejecutable de pega, y sobre un transcript real solo se ha generado el prompt. La prueba con Claude Code va en F3-T5, cuando `>> --pack tarea` exista.
- El respaldo automático «si el fork no arranca, usar el paquete» no está hecho: hoy el modo se elige; si el fork falla, el agente queda `failed` con el motivo.
- El `--modo fork|paquete` de la tarjeta se expone en F3-T5 como parte del gesto.

## Próximos pasos
- F3-T5: derivar desde el prompt (`>> tarea`) y ver los agentes.
