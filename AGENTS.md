# AGENTS.md

## Orquestación y continuidad

El líder clasifica cada solicitud como `small`, `medium` o `large` según alcance, riesgo, integraciones, persistencia y cantidad de archivos. Debe seleccionar el modelo disponible apropiado, registrar la decisión en `.codex/task-status.json` y delegar al subagente correspondiente. No debe fijar un modelo que la plataforma no ofrezca.

Cuando queden aproximadamente 40 % de contexto operativo, debe actualizar `.codex/.context/task-context.toon` con objetivo, decisiones, archivos, pruebas, bloqueos y siguientes pasos. Si la plataforma permite abrir otro chat, se continúa leyendo ese checkpoint; si no, se lee en el chat actual.

Las tareas usan estados `in-progress` y `done` en `.codex/task-status.json`. Solo el leader puede asignar `done`, después de la aprobación del reviewer y una validación final exitosa. Este archivo es la excepción autorizada a la regla general de no modificar JSON.

## Propósito

Este repositorio desarrolla y valida un harness reutilizable para coordinar agentes en repositorios consumidores. El core debe permanecer agnóstico al lenguaje, framework y dominio; las reglas específicas pertenecen a la configuración o instrucciones del consumidor.

## Reglas para agentes

- Antes de cualquier análisis o implementación, ejecutar `init.sh` o `init.ps1`.
- Si falla, diagnosticar y corregir; después ejecutar nuevamente el script.
- Flujo obligatorio: `init → análisis → implementación → pruebas → reviewer → correcciones si aplica → init final`.
- Toda implementación nueva debe incluir pruebas siguiendo las convenciones existentes del repositorio.
- No modificar documentación del proyecto; la actualiza el propietario.
- No modificar comportamiento existente fuera del cambio solicitado.
- No modificar configuración o infraestructura salvo autorización explícita del propietario.
- No leer, mostrar, copiar ni modificar secretos, tokens, credenciales o archivos `.env`.
- Para este repositorio, las modificaciones permitidas son `AGENTS.md`, agentes locales en `.agents/`, `custom-harness/` y scripts de validación. Los archivos de estado y checkpoint solo los gestiona el leader.
- Usar español para reglas de negocio y mensajes funcionales; inglés para nombres, comentarios y código.
- Seguir Conventional Branch y Conventional Commits.
- No crear commits ni publicar cambios; dejar todo preparado para revisión.
- Preservar cambios preexistentes del usuario y usar `apply_patch` para ediciones manuales.
- Resolver políticas con esta precedencia: instrucciones de sistema/usuario, instrucciones del repositorio consumidor, configuración opcional del harness y defaults seguros.

## Roles

- `.agents/leader.md`: coordina y gestiona subagentes; no implementa directamente.
- `.agents/implementer.md`: realiza cambios y pruebas dentro del alcance.
- `.agents/reviewer.md`: valida comportamiento, pruebas, buenas prácticas y convenciones.

El líder solicita revisión después de implementar. Si falla, devuelve el trabajo al implementador y solicita una nueva revisión.

## Mapa del proyecto

- `custom-harness/`: skill autocontenida, referencias, plantillas, scripts y pruebas.
- `.agents/`: contratos locales de leader, implementer y reviewer.
- `.codex/`: estado operativo y checkpoint del leader.
- `init.sh` e `init.ps1`: validación reproducible del repositorio.
- `docs/` y `README.md`: documentación mantenida por el propietario; no modificar.

## Validación final

Un cambio está listo únicamente cuando pasan las pruebas y validaciones, no hay conflictos estructurales, el Markdown tiene estructura válida, los adaptadores preservan las invariantes del core y `reviewer.md` lo aprueba.
