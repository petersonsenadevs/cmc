# 012 — F2-T5: la cola se conserva al reiniciar, reanudar o compactar

- **Fecha/hora:** 2026-11-21 01:50
- **Tipo:** feature
- **Mejora a:** 010
- **Tarea:** F2-T5
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- La cola ya vivía en disco por sesión; quedaba comprobar que una sesión reanudada conserva su id (lo conserva) y avisar. El hook `SessionStart` devuelve ahora `systemMessage` con «cmc: N held message(s) are waiting in this session» cuando hay mensajes retenidos; tras una compactación no dice nada.
- Una entrega pendiente (`;;end`) también sobrevive al reinicio.
- Limpieza: al arrancar una sesión se borran las carpetas de sesiones sin actividad desde hace más de 30 días (`pruneSessions`), nunca la que arranca y solo carpetas con nombre de id de sesión. El número de días será configurable en F4-T1.
- `scripts/e2e.mjs` imprime el id de sesión y la carpeta de trabajo (útil con `--keep`).
- Regla nueva de Peterson durante la tarea: **el plugin debe ser multi-OS**. Anotada en MEMORIA y en el borrador de convenciones; la revisión y las correcciones van en la tarjeta ad hoc X-T1 (en curso, con un subagente).

## Commits
- `15b2d79` docs(devlog): close F2-T4
- `76db5b2` feat(sessions): remind of held messages on resume and prune old sessions

## Decisiones (resumen; detalle en DECISIONES.md)
- D-015 retención de 30 días por defecto para sesiones inactivas (ver DECISIONES.md#dev-012).

## Verificación
```
$ npm test
ℹ tests 117 · pass 117 · fail 0
$ npm run lint
lint: 29 modules checked, 0 failed

$ node scripts/e2e.mjs --mid ";; reply with the word guava" --mid ";; reply with the word mango" --keep
 23.0s  AGENT      step1, step2, step3
 26.6s  QUEUE      2 held after the session: ["reply with the word guava","reply with the word mango"]
 26.6s  SESSION    21ac41be-39d2-4560-aeb8-1be675565efb in ...\cmc-e2e-5UXRWN (kept)

$ claude -p "/cmc:release" --continue --plugin-dir <plugin>      (en esa carpeta, proceso nuevo)
SYSTEM hook_response {"systemMessage":"cmc: 2 held message(s) are waiting in this session. Type ;;list to see them."}
RESUMED session 21ac41be-39d2-4560-aeb8-1be675565efb
AGENT guava
mango
```

## Desviaciones
- La prueba real se hizo contra una copia del commit (`git archive`), no contra el árbol de trabajo, porque el subagente de X-T1 estaba editando `lib/` a la vez.
- Cómo pinta la interfaz interactiva el aviso de reanudación no se ha visto (misma limitación que F1-T6b).

## Próximos pasos
- X-T1: integrar y verificar las correcciones de portabilidad.
- F3-T1: comprobar el fork de sesión a mitad de turno.
