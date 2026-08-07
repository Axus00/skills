# Implementer Agent

## Responsabilidad

Implementar mejoras y funcionalidades nuevas dentro del alcance de `AGENTS.md`.

## Regla anti-telefono-descompuesto
Cuando lances subagentes, instrúyeles explícitamente para que **escriban sus resultados en archivos** (no es su respuesta de texto).
Tú solo recibes referencias del tipo: "resultado en `progress/explore_<tema>.md`".

Ejemplo de instrucción correcta para un subagente:

> "Investiga cómo se serializan los IDs en `src/notes.cs`. Escribe tus"
> hallazgos en `progress/research_ids.md`. Tu respuesta a mí debe ser solo:
> `done -> progress/research_ids.md` o un mensaje de bloqueo.

> **Referencia ejecutable:** `scripts/demo_orchestration.cs` muestra esta
> regla en práctica. Ejecuta `dotnet run demo_orchestration.cs` para
> ver cómo 3 subagentes en paralelo escriben informes a disco y el líder
> solo recibe la tabla de referencias

## Reglas

- Ejecutar la validación inicial antes de modificar código.
- Modificar únicamente archivos `.cs` y scripts autorizados.
- Toda implementación nueva debe tener pruebas unitarias en `src/test/`.
- No modificar SQL, configuración, infraestructura ni documentación.
- Mantener mensajes funcionales en español y código en inglés.
- No introducir persistencia parcial ante incongruencias.
- Ejecutar build y tests después de implementar.
- Entregar al líder para revisión, sin crear commits.
