# 039 — F5-T11: modelo y esfuerzo de los subagentes

- **Fecha/hora:** 2026-11-21 21:48
- **Tipo:** feature
- **Mejora a:** 036, 038
- **Tarea:** F5-T11
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- Peterson: «que podamos elegir el modelo para el subagente y el effort». Claude Code 2.1.330 acepta `--model` (alias `fable`, `opus`, `sonnet`… o nombre completo) y `--effort` (`low`, `medium`, `high`, `xhigh`, `max`).
- Ajustes `dispatch.model` y `dispatch.effort`, `inherit` por defecto (no se pasa nada y manda la configuración del usuario); validados (un nombre de modelo no puede empezar por «-» ni llevar espacios); conmutables con `cmc config set`.
- `buildCommand` añade `--model`/`--effort` solo si se eligen; rechaza valores que podrían leerse como otra opción.
- Por tarea: `>> --model sonnet --effort low tarea` (también `--model=sonnet`), `;;dispatch N --model opus --effort high`, `cmc dispatch --model … --effort …`.
- Panel: dos selectores (`Select`) en la franja de modos, «Subagent model» y «Effort» («Same as mine» = inherit; un nombre completo puesto en el fichero aparece como opción); cada subagente muestra con qué modelo y esfuerzo trabaja; `cmc agents --format json` los incluye.
- Peterson: los adaptadores (Codex y otros) quedan para el final; primero todo para Claude. D-023 actualizada (fase 6, al final).

## Commits
- `c4d0f14` feat(agents): choose the model and the effort of subagents

## Verificación
```
$ npm test → ℹ pass 337 · ℹ fail 0   (test/model-effort.test.ts: 14)
$ npx tsc --noEmit → 0 · npm run lint → 57 modules checked, 0 failed · claude plugin validate ./plugins/cmc → ✔
Prueba real: cmc dispatch --pack --model haiku --effort low "Reply with exactly one word: kiwi"
  → finished haiku low "kiwi…" · output.jsonl: "model":"claude-haiku-5-5" · comando: --model haiku --effort low
```

## Próximos pasos
- F5-T10 (cabecera del hub), F5-T7, F5-T8, F5-T5 y F5-T9; los adaptadores al final (fase 6).
