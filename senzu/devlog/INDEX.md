# Índice de Devlog

Registro correlativo de todas las entradas del proyecto.

| Nº  | Fecha      | Título                                     | Tipo     | Mejora a | Tarea |
|-----|------------|--------------------------------------------|----------|----------|-------|
| 001 | 2026-11-21 | Setup inicial: Senzu, brief y plan         | infra    | —        | —     |
| 002 | 2026-11-21 | F1-T1: los hooks a mitad de turno, medidos | decisión | —        | F1-T1 |
| 003 | 2026-11-21 | F1-T2: esqueleto del plugin                | feature  | —        | F1-T2 |
| 004 | 2026-11-21 | F1-T3: cola por sesión en el core          | feature  | —        | F1-T3 |
| 005 | 2026-11-21 | F1-T4: captura de mensajes con prefijo     | feature  | —        | F1-T4 |
| 006 | 2026-11-21 | F1-T5: soltar la cola (manual y fin de turno) | feature | —       | F1-T5 |
| 007 | 2026-11-21 | F1-T6: cierre de la fase 1                 | docs     | —        | F1-T6 |
| 008 | 2026-11-21 | F2-T1: gestionar la cola                   | feature  | —        | F2-T1 |
| 009 | 2026-11-21 | F2-T2: soltar selectivo y modo «ya»        | feature  | —        | F2-T2 |
| 010 | 2026-11-21 | F2-T3: CLI `cmc` desde otra terminal       | feature  | —        | F2-T3 |
| 011 | 2026-11-21 | F2-T4: indicador de mensajes retenidos     | feature  | —        | F2-T4 |
| 012 | 2026-11-21 | F2-T5: la cola se conserva al reanudar     | feature  | 010      | F2-T5 |
| 013 | 2026-11-21 | F3-T1: el fork de sesión a mitad de turno  | decisión | —        | F3-T1 |
| 014 | 2026-11-21 | X-T1: portabilidad Windows, macOS y Linux  | fix      | 004, 010 | X-T1  |
| 015 | 2026-11-21 | F3-T2: lanzador de agentes derivados       | feature  | —        | F3-T2 |
| 016 | 2026-11-21 | X-T2: marketplace y plugin en plugins/cmc  | refactor | 003      | X-T2  |
| 017 | 2026-11-21 | /adoptar: convenciones del proyecto        | decisión | 002      | —     |
| 018 | 2026-11-21 | Decisión corregida: TypeScript             | decisión | 017      | X-T3  |
| 019 | 2026-11-21 | X-T3: migración a TypeScript               | refactor | 018      | X-T3  |
| 020 | 2026-11-21 | TypeScript frente a JavaScript: comparación | fix      | 019      | X-T3  |
| 021 | 2026-11-21 | F3-T3: worktree del agente derivado        | feature  | 015      | F3-T3 |
| 022 | 2026-11-21 | F3-T4: paquete de contexto ligero          | feature  | —        | F3-T4 |
| 023 | 2026-11-21 | F3-T5: derivar desde el prompt (>>)        | feature  | 015, 021, 022 | F3-T5 |
| 024 | 2026-11-21 | F3-T6/T7: resultado del derivado a la cola | feature  | 015, 023 | F3-T6, F3-T7 |
| 025 | 2026-11-21 | X-T4: «ya» sin entregas a mitad de turno     | fix      | 009, 020 | X-T4  |
| 026 | 2026-11-21 | F4-T1: configuración del plugin            | feature  | 012, 024 | F4-T1 |
| 027 | 2026-11-21 | F4-T2: revisión de seguridad y arreglos    | fix      | 015, 021, 022, 024, 025 | F4-T2 |
| 028 | 2026-11-21 | F4-T3: documentación e instalación         | docs     | 016      | F4-T3 |
| 029 | 2026-11-21 | X-T5: prueba de la interfaz en el motor     | feature  | 006, 011 | X-T5 |
| 030 | 2026-11-21 | X-T5: menú /held y aviso de fin de turno   | feature  | 029      | X-T5 |
| 031 | 2026-11-21 | X-T6: lo retenido llega al acabar el turno | feature  | 006, 029, 030 | X-T6 |
| 032 | 2026-11-21 | F5-T1: primer panel de control             | feature  | 030, 031 | F5-T1 |
| 033 | 2026-11-21 | F5-T1: estado, avisos y To agent en el panel | fix    | 032      | F5-T1 |
| 034 | 2026-11-21 | F5-T1: Send inmediato por el canal nativo  | feature  | 025, 033 | F5-T1 |
| 035 | 2026-11-21 | F5-T2: diseño del panel aprobado           | decisión | 034      | F5-T2 |
