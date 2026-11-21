# 016 — X-T2: el repositorio pasa a ser un marketplace

- **Fecha/hora:** 2026-11-21 02:00
- **Tipo:** refactor
- **Mejora a:** 003
- **Tarea:** X-T2
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- Peterson avisó de que quería instalar por marketplace y luego plugin. El plugin estaba en la raíz del repositorio, mezclado con `senzu/`, `.claude/` y los tests (ya anotado como problema en la entrada 003), y el marketplace se había dejado para F4-T3.
- Reestructuración: `.claude-plugin/plugin.json`, `hooks/`, `lib/`, `bin/` y `commands/` se mueven a `plugins/cmc/` (con `git mv`, conservando historia). En la raíz queda `.claude-plugin/marketplace.json`, con el marketplace `r3v3rs3` y el plugin `cmc` apuntando a `./plugins/cmc`.
- `test/`, `test-support/`, `scripts/`, `docs/` y `package.json` siguen en la raíz y no se instalan; sus rutas apuntan ahora a `plugins/cmc/`.
- README: sección «Install» con los dos comandos. Guion manual y convenciones actualizados.

## Commits
- `45c8d6c` refactor: make the repo a marketplace, plugin in plugins/cmc

## Decisiones (resumen; detalle en DECISIONES.md)
- D-021 marketplace `r3v3rs3` en la raíz y plugin en `plugins/cmc/` (ver DECISIONES.md#dev-016).

## Verificación
```
$ npm test
ℹ tests 146 · pass 146 · fail 0
$ npm run lint
lint: 36 modules checked, 0 failed
$ claude plugin validate .
Validating marketplace manifest: …\.claude-plugin\marketplace.json
✔ Validation passed
$ claude plugin validate ./plugins/cmc
✔ Validation passed          (avisos: falta LICENSE e icono, de F4-T3)

Instalación real, con CLAUDE_CONFIG_DIR apuntando a una carpeta de prueba (no toca la configuración del usuario):
$ claude plugin marketplace add D:/Agent_Cli_Tolling/claud-code-message-control
✔ Successfully added marketplace: r3v3rs3 (declared in user settings)
$ claude plugin install cmc@r3v3rs3
✔ Successfully installed plugin: cmc@r3v3rs3 (scope: user)
$ claude plugin list
  ❯ cmc@r3v3rs3   Version: 0.1.0   Status: ✔ enabled
Ficheros instalados: plugins/cache/r3v3rs3/cmc/0.1.0/{.claude-plugin,bin,commands,hooks,lib}  (nada de senzu/, test/ ni .claude/)

$ node scripts/e2e.mjs --mid ";; reply with the word guava" --mid ";;end"
 25.0s  DELIVERED  Stop hook feedback: [cmc] The user released their held message with ";;end": 1. reply with the word guava
 26.2s  AGENT      guava
```

## Desviaciones
- El aviso de la validación sobre `CLAUDE.md` en la raíz del plugin desaparece: ya no está dentro del plugin.
- No se ha instalado en la configuración real de Peterson: lo hace él con los dos comandos del README.
- No se ha lanzado una sesión con el plugin instalado desde el marketplace (solo con `--plugin-dir`): el directorio de datos tendrá otro nombre que `cmc-inline`, y la CLI lo localiza por la marca `cmc.json` (D-013), pero eso no se ha ejecutado.
- Queda de F4-T3: licencia, icono, `CHANGELOG`, y cómo poner la CLI `cmc` en el PATH tras instalar.

## Próximos pasos
- Decidir con Peterson JavaScript + JSDoc comprobado o TypeScript (pregunta abierta).
- F3-T3: worktree del agente derivado.
