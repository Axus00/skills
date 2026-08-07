# AGENTS.md

## Orquestación y continuidad

El líder clasifica cada solicitud como `small`, `medium` o `large` según alcance, riesgo, integraciones, persistencia y cantidad de archivos. Debe seleccionar el modelo disponible apropiado, registrar la decisiÃ³n en `.codex/task-status.json` y delegar al subagente correspondiente.

Cuando queden aproximadamente 40 % de contexto operativo, debe actualizar `.codex/context/task-context.toon` con objetivo, decisiones, archivos, pruebas, bloqueos y siguientes pasos. Si la plataforma permite abrir otro chat, se continÃºa leyendo ese checkpoint; si no, se lee en el chat actual.

Las tareas usan estados `in-progress` y `done` en `.codex/task-status.json`. Solo el leader puede asignar `done`, despuÃ©s de la aprobación del reviewer y una validación final exitosa. Este archivo es la excepciÃ³n autorizada a la regla general de no modificar JSON.

## Propósito

Esta API ASP.NET Core .NET 9 construye y procesa archivos Excel de solicitudes de producto para gestionar negociaciones. Genera plantillas, valida sus hojas y campos contra `db_solicitudesproducto`, `db_masterdatahub` y APIs externas, y guarda o actualiza la información válida para el aplicativo.

Acepta archivos `.xlsx` y `.xls`.

## Flujo funcional

Las hojas esperadas son `Comercial y Atr. Categoría`, `Maestras` (oculta y con listas de valores), `Segmentación`, `Regionalidad` y `Excepciones Variables Surtido`.

El flujo es: leer Excel, validar estructura y datos, consultar dependencias externas, aplicar reglas de negocio, persistir y devolver el resultado con sus errores. Ante cualquier incongruencia se debe detener el procesamiento y no persistir información parcial o inválida.

## Reglas para agentes

- Antes de cualquier análisis o implementación, ejecutar `init.sh` o `init.ps1`.
- Si falla, diagnosticar y corregir; después ejecutar nuevamente el script.
- Flujo obligatorio: `init → análisis → implementación → pruebas → reviewer → correcciones si aplica → init final`.
- Toda implementación nueva debe incluir pruebas unitarias siguiendo las convenciones de `src/test/`.
- No modificar funciones SQL; se administran directamente en la base de datos.
- No modificar documentación del proyecto; la actualiza el propietario.
- No modificar el comportamiento que ya se tiene en los métodos, solo realizar los cambios o implementaciones que el propietario solicita.
- No modificar `appsettings`, `.json`, `.yaml`, Docker, Helm, Dapr, pipelines, `launchSettings`, `.http` ni otros archivos de configuración o infraestructura.
- No leer, mostrar, copiar ni modificar secretos, tokens, credenciales o archivos `.env`.
- Las modificaciones permitidas son archivos `.cs`, `AGENTS.md`, agentes locales en `agents/` y scripts de validación.
- Usar español para reglas de negocio y mensajes funcionales; inglés para nombres, comentarios y código.
- Seguir Conventional Branch y Conventional Commits.
- No crear commits ni publicar cambios; dejar todo preparado para revisión.

## Roles

- `agents/leader.md`: coordina y gestiona subagentes; no implementa directamente.
- `agents/implementer.md`: realiza cambios de código y pruebas.
- `agents/reviewer.md`: valida comportamiento, compilación, pruebas, buenas prácticas y convenciones.

El líder solicita revisión después de implementar. Si falla, devuelve el trabajo al implementador y solicita una nueva revisión.

## Mapa del proyecto

- `src/api/`: API, dominio, aplicación, infraestructura, adaptadores y controladores.
- `src/api/Application/`: casos de uso, servicios, DTOs y puertos.
- `src/api/Domain/`: errores y reglas del dominio.
- `src/api/Infrastructure/`: Excel, HTTP, Dapr, base de datos, resiliencia, observabilidad e inyección.
- `src/api/Controllers/`: endpoints HTTP de exportación y carga.
- `src/test/`: pruebas unitarias organizadas según el código probado.
- `dapr/`, `charts/`, `pipeline/` y `Dockerfile`: infraestructura y despliegue; no modificar normalmente.
- `documentacion/`: documentación funcional y técnica; no modificar salvo instrucción explícita.

## Validación final

Un cambio está listo únicamente cuando compila, pasan las pruebas, no hay conflictos estructurales, el Markdown tiene estructura válida y `reviewer.md` lo aprueba.
