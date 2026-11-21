# 001 — Setup inicial: Senzu, brief y plan

- **Fecha/hora:** 2026-11-21 01:01
- **Tipo:** infra
- **Mejora a:** —
- **Tarea:** —
- **Stack:** node (plugin de Claude Code, ESM sin dependencias)

## Qué se hizo
- Senzu instalado en el proyecto (perfil librería: calidad, seguridad, operaciones).
- Brief en `senzu/plan/brief.md` y plan en `senzu/plan/PLAN.md`: 4 fases, 21 tareas.
- Resueltas con Peterson las tres preguntas abiertas: nombre `cmc` y prefijos `;;` / `>>` (Q1), permisos del agente derivado (Q2) y retorno del resultado (Q3).
- Repositorio git creado (`git init -b main`) y rama de trabajo `feat/f1-hold-and-release`. El plan lo preveía en F1-T2; se adelantó a petición de Peterson.
- `.gitignore`: fuera de git la memoria local de Corvusmem (`.corvusmem/`, puede llevar datos personales) y el estado de sesión.

## Commits
- El commit `chore: set up senzu, brief and plan for the cmc plugin` (primero de la rama; su hash está en la entrada 002).

## Decisiones (resumen; detalle en DECISIONES.md)
- D-001 a D-004 (ver DECISIONES.md#dev-001).

## Verificación
- `git status -sb` → `## No commits yet on feat/f1-hold-and-release`.

## Próximos pasos
- F1-T1: comprobar el comportamiento real de los hooks a mitad de turno.
