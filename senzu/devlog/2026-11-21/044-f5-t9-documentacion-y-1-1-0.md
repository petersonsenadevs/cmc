# 044 — F5-T9: documentación del hub y versión 1.1.0

- **Fecha/hora:** 2026-11-21 22:14
- **Tipo:** docs
- **Mejora a:** 028
- **Tarea:** F5-T9
- **Stack:** TypeScript sobre Node ≥ 22.18 (plugin de Claude Code, sin compilación)

## Qué se hizo
- README reescrito para 1.1: el hub (vistas, Send now con Ctrl+Enter, modos), retener y enviar desde el chat (`/held`, `/send`, palabras de control), subagentes (conversación, `;;tell`, modelo y esfuerzo, worktree, permisos), la CLI, el fichero de ajustes completo y los límites actuales (se quitan los que ya no lo son: Esc, el aviso de tres líneas). Instalación desde `petersonsenadevs/cmc` (a confirmar al crear el repositorio).
- `docs/manual-test.md` para 1.1: A (sin interfaz), B (lo básico en la terminal), C (el hub, 14 comprobaciones para Peterson).
- CHANGELOG 1.1.0; versión 1.1.0 en plugin.json, marketplace.json y los dos package.json; descripciones al día.

## Commits
- `e249cad` docs: document the hub and release 1.1.0

## Verificación
```
$ npm test → ℹ pass 343 · ℹ fail 0 · npx tsc --noEmit → 0 · npm run lint → 57 modules checked, 0 failed
$ claude plugin validate . → ✔ Validation passed · claude plugin validate ./plugins/cmc → ✔
$ MSYS_NO_PATHCONV=1 node scripts/e2e.ts --mid ";; also say the word pineapple"   (A1 del guion nuevo)
  7.9s NOTICE  cmc: held (1) · goes to the agent when its turn ends · /held to change it
 20.2s DELIVERED Stop hook feedback: [cmc] The user typed this message while you were working; cmc held it until your turn ended: 1. also say the word pineapple
 20.8s AGENT   pineapple · QUEUE 0 held
```

## Pendiente
- Peterson: parte C del guion en su terminal.
- Publicar (requiere su aprobación expresa): crear el repositorio, subir la rama, PR a main, etiqueta v1.1.0, `repository` en plugin.json.
- Logotipo (brief listo). Fase 6: adaptadores.

## Añadido después
- Insignias en el README (versión, licencia, Claude Code, Node, TypeScript, plataformas, hub): estáticas, sin depender de que exista el repositorio. La de Claude Code en gris, no en el naranja de Anthropic (cmc no es oficial).

## Subida
- Remoto `origin` = https://github.com/petersonsenadevs/cmc (repositorio creado vacío por Peterson). `git push -u origin feat/typescript` → `* [new branch] feat/typescript -> feat/typescript` (893ef6d). 115 commits, todos con autor Peterson Sena y sin líneas de co-autor ni firmas de agente (comprobado). No se ha tocado `main`.

## Historia reescrita (autoría)
- Peterson reescribió la historia de `feat/typescript` para firmar los 116 commits con su correo personal en lugar del del trabajo (que GitHub atribuía a otra cuenta suya) y la subió con `--force-with-lease` él mismo (el agente no fuerza pushes). Copia previa en la rama local `backup/antes-de-reescribir`.
- Comprobado: mismo árbol de ficheros antes y después (`f33bf42`); 116 de 116 commits con el correo personal como autor y committer; remoto `feat/typescript` = local `d878f91`.
- **Los identificadores de commit citados en el devlog y el plan hasta la entrada 044 son los de antes de reescribir**: el contenido de cada commit es el mismo, el hash no. Para encontrar uno, buscar por su mensaje (`git log --grep`).
- Pendiente: `main` en el remoto sigue apuntando a la historia vieja (`39238c3`); Peterson la actualiza con `git push --force-with-lease origin feat/typescript:main`.
