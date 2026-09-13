<img src="./assets/axus-profile.jpeg" align="right" width="150" alt="Retrato de Fernando Gómez, creador de Custom Harness">

# Custom Harness: ingeniería multiagente bajo tu control

Soy Fernando Gómez y construí **Custom Harness** para convertir el trabajo con agentes de código en un proceso que puedas entender, adaptar y gobernar. Coordina leader, implementer y reviewer sin quitarte el control sobre las decisiones ni sobre tu repositorio.

Lo hice porque la velocidad no sirve de mucho cuando un mismo agente planea, implementa y aprueba su propio trabajo. La separación de roles, las pruebas y una revisión independiente devuelven al desarrollo con IA los límites que exige la ingeniería real.

Mi filosofía es sencilla: herramientas pequeñas, componibles y fáciles de cambiar. El harness aporta disciplina sin adueñarse de tu proceso; tú defines las políticas, el contexto y el nivel de autonomía.

<br clear="right">

## La idea

Los agentes de código pueden avanzar rápido y aun así dejar un resultado difícil de confiar: el mismo agente planea, implementa y aprueba; las tareas grandes consumen el contexto; una validación tardía descubre cambios parciales; y cada repositorio termina copiando reglas que pertenecían a otro proyecto.

Custom Harness convierte ese trabajo en un ciclo explícito y verificable:

```text
init → contexto → análisis → implementación → pruebas → reviewer → correcciones → init final
```

El proyecto combina dos piezas distintas:

- **Una skill para el agente:** enseña a recuperar contexto, clasificar tareas, separar responsabilidades y respetar las políticas del repositorio consumidor.
- **Un instalador de harness:** aplica archivos concretos de coordinación al repositorio objetivo mediante plantillas para Codex, Claude Code o Cursor.

Instalar la skill no modifica automáticamente tu repositorio. Aplicar las plantillas sí crea archivos en el target, siempre después de un preflight visible.

## Qué resuelve

- Evita que el leader implemente o apruebe su propio trabajo.
- Clasifica solicitudes como `small`, `medium` o `large` según alcance y riesgo.
- Delega cambios al implementer y exige revisión independiente del reviewer.
- Conserva estado en `.harness/task-status.json` y continuidad en `.harness/context/task-context.toon`.
- Mantiene comandos, permisos, rutas protegidas e idioma como políticas configurables del consumidor.
- Detiene la instalación ante colisiones, symlinks, hardlinks o rutas de backup inseguras.
- Ofrece `--dry-run`, instalación idempotente y validación semántica de los adaptadores.
- Recupera contexto durable del proyecto con Memanto y activa Grill Mode solo cuando faltan decisiones bloqueantes.
- Funciona con Node.js 18 o superior, sin instalar paquetes ni depender de Python.

## Cómo funciona

| Responsabilidad | Contrato |
| --- | --- |
| **Dispatcher** | Ejecuta el init, registra `initialized` e invoca al leader. No analiza ni implementa. |
| **Leader** | Aplica el gate de contexto, clasifica, registra, delega y coordina. No implementa ni se autoaprueba. |
| **Implementer** | Modifica solo el alcance delegado, preserva cambios existentes y ejecuta pruebas. |
| **Reviewer** | Revisa sin editar, aporta evidencia y aprueba o rechaza explícitamente. |

La clasificación orienta el nivel de razonamiento y el grado de coordinación, sin fijar nombres de modelos que una plataforma podría no ofrecer:

| Clase | Señales típicas |
| --- | --- |
| `small` | Cambio localizado, bajo riesgo y pocos archivos. |
| `medium` | Varios archivos, una integración o ambigüedad moderada. |
| `large` | Arquitectura transversal, persistencia, seguridad, distribución o alto impacto. |

Solo el leader puede marcar una tarea como `done`, y únicamente cuando el reviewer aprobó y el init final pasó. Todas las transiciones y checkpoints pasan por el motor de estado `.harness/bin/workflow_state.js`; ningún rol edita el estado a mano.

## Contexto persistente con Memanto

Custom Harness puede usar [Memanto](https://github.com/moorcheh-ai/memanto) como capa de memoria persistente antes del análisis, la delegación o la implementación. La idea no es convertir la memoria en otra fuente de estado del workflow, sino recuperar decisiones durables del proyecto y evitar que tengas que repetirlas en cada sesión.

El flujo de contexto es:

```text
solicitud
  │
  ▼
repositorio actual
  │
  ▼
Memanto recall (si está disponible)
  │
  ▼
¿hay contexto suficiente?
  │
  ├── sí ──► continuar con el branch
  │
  └── no
        │
        ▼
      Grill Mode
        │
        ▼
      resolver decisiones bloqueantes
        │
        ▼
      persistir conocimiento durable
        │
        ▼
      continuar con review / install-adapt / package
```

El Project Context Gate prioriza propósito del proyecto, plataforma objetivo, arquitectura, estructura existente de agentes, decisiones técnicas, restricciones de compatibilidad, convenciones, expectativas de pruebas y seguridad, enfoques descartados, limitaciones conocidas y definición de terminado.

El gate es proporcional a la solicitud: los follow-ups bien delimitados reutilizan el contexto ya establecido, y solo se pregunta cuando una incertidumbre puede cambiar materialmente la arquitectura, compatibilidad, seguridad, comportamiento destructivo, distribución o criterios de aceptación.

Las fuentes de contexto siguen esta precedencia: instrucciones de mayor prioridad, evidencia actual del repositorio, instrucciones explícitas de la conversación actual, memorias durables recuperadas desde Memanto y, por último, supuestos. Si una memoria antigua entra en conflicto con evidencia más reciente, el harness conserva la evidencia actual y solo pide aclaración cuando el conflicto afecta la tarea.

Memanto es opcional. Si no está disponible, el harness continúa con la evidencia del repositorio y la conversación, y deja constancia del fallback en el siguiente checkpoint. Instalarlo requiere autorización explícita; el harness nunca lo instala por su cuenta.

### Grill Mode

Cuando falta información realmente bloqueante, Custom Harness agrupa entre 2 y 5 preguntas de alto impacto en lugar de iniciar una entrevista completa. Por ejemplo:

> Recuperé desde el repositorio y la memoria que el target actual es Codex, pero faltan dos decisiones:
>
> 1. ¿Custom Harness debe reemplazar el workflow de agentes existente o coexistir con él?
> 2. ¿El harness instalado debe seguir funcionando en repositorios que no tengan Node.js disponible?

Si autorizas explícitamente usar supuestos razonables, el trabajo continúa documentándolos. Esos supuestos no se guardan como decisiones durables hasta que sean confirmados.

### Qué se guarda y qué no

Memanto se reserva para conocimiento reutilizable entre tareas y sesiones: decisiones de arquitectura, plataformas soportadas, requisitos de compatibilidad, restricciones del consumidor, convenciones del proyecto, objetivos durables y enfoques rechazados con su motivo.

No se persisten salidas temporales de comandos, fallos transitorios de pruebas, stack traces, patches intermedios, conclusiones especulativas, supuestos no confirmados ni secretos.

La separación de responsabilidades es explícita:

```text
repositorio                 → estado real del código y la configuración
.harness/task-status.json   → estado operacional de la ejecución actual
Memanto                     → conocimiento durable del proyecto entre sesiones
```

Por eso, Memanto no reconstruye fases, reviewers, checkpoints ni estados done/rejected. Ese estado sigue perteneciendo al harness.

La lógica del gate vive en [`custom-harness/references/project-context.md`](./custom-harness/references/project-context.md); la instalación, conexión y verificación de Memanto en [`custom-harness/references/memanto.md`](./custom-harness/references/memanto.md). Ambos archivos se instalan en `.harness/references/` del repositorio consumidor, así que el gate llega a Codex, Claude Code y Cursor por igual.

## Instalación rápida

### Opción 1: instalar la skill en tu agente

El CLI de [skills.sh](https://www.skills.sh/docs/cli) permite seleccionar la skill y el agente de destino:

```bash
npx skills@latest add Axus00/skills
```

Selecciona `custom-harness` y Codex, Claude Code o Cursor según tu entorno. Después puedes pedir al agente que use `custom-harness` para adaptar un repositorio.

> Este comando instala conocimiento para el agente. No ejecuta por sí solo el instalador sobre tu proyecto.

### Opción 2: clonar el repositorio

Esta vía es la más transparente para inspeccionar, desarrollar y ejecutar los scripts directamente:

```bash
git clone https://github.com/Axus00/skills.git
cd skills
./init.sh
```

Requisitos:

- Node.js 18 o superior. No hace falta `npm install`: los scripts no tienen dependencias.
- Bash para `init.sh`, o PowerShell para `init.ps1`.

Si `node` no está en el `PATH`, apunta la variable `HARNESS_NODE` al ejecutable que quieras usar.

## Aplicar el harness a un repositorio

Ejecuta estos comandos desde el clone de `skills`. Sustituye `/ruta/al/proyecto` por el repositorio consumidor.

### 1. Previsualizar

```bash
node custom-harness/scripts/install_harness.js \
  --target /ruta/al/proyecto \
  --platform codex \
  --dry-run
```

El dry-run muestra el plan completo sin escribir. Si encuentra contenido diferente o una ruta estructural insegura, informa una colisión y aborta.

### 2. Instalar

```bash
node custom-harness/scripts/install_harness.js \
  --target /ruta/al/proyecto \
  --platform codex
```

Puedes repetir `--platform` para generar varios adaptadores en una sola operación:

```bash
node custom-harness/scripts/install_harness.js \
  --target /ruta/al/proyecto \
  --platform codex \
  --platform claude \
  --platform cursor
```

### 3. Validar

```bash
node custom-harness/scripts/validate_harness.js \
  --target /ruta/al/proyecto \
  --platform codex
```

Para varios adaptadores, repite `--platform` igual que durante la instalación. La validación comprueba estructura, contratos por rol, ciclo de trabajo, gate de contexto, estado, checkpoint y gates de finalización.

### 4. Operar el estado

En el repositorio consumidor, los roles registran transiciones y checkpoints con el motor instalado:

```bash
node .harness/bin/workflow_state.js check
node .harness/bin/workflow_state.js checkpoint --help
node .harness/bin/workflow_state.js transition --help
```

El motor rechaza análisis sin init exitoso, implementers no delegados, fases fuera de orden, revisiones incompletas, init final sin aprobación y `done` sin init final.

## Elegir adaptador

Todos los adaptadores conservan las mismas invariantes, pero usan las convenciones de cada producto:

| Plataforma | Archivos principales | Consideración |
| --- | --- | --- |
| **Codex** | `AGENTS.md`, `.codex/agents/{leader,implementer,reviewer}.toml` y `.agents/skills/custom-harness/SKILL.md` | Agentes personalizados nativos; la skill es solo un puntero de descubrimiento. |
| **Claude Code** | `CLAUDE.md`, `.claude/agents/*.md` y `.claude/skills/custom-harness/SKILL.md` | Define agentes nativos con herramientas acordes a cada rol; el reviewer no recibe herramientas de edición. |
| **Cursor** | `.cursor/rules/custom-harness.mdc` | Si no hay subagentes aislados, exige pases separados y registra la degradación como `review-pass`. |

Los tres comparten el núcleo portable instalado en `.harness/`:

- `contract.md`: el único contrato de comportamiento; los archivos de cada plataforma apuntan a él.
- `bin/workflow_state.js`: motor de estado y checkpoints.
- `references/project-context.md` y `references/memanto.md`: gate de contexto y procedimiento Memanto.
- `config.toml`: decisiones del consumidor (comandos, rutas protegidas, idioma, publicación).
- `task-status.json` y `context/task-context.toon`: estado y checkpoint de la tarea actual.

## Actualizar, reemplazar y retirar

El instalador es idempotente: volver a ejecutarlo con el mismo contenido produce operaciones `unchanged`.

Para actualizar desde el código fuente:

```bash
git pull --ff-only
node custom-harness/scripts/install_harness.js \
  --target /ruta/al/proyecto \
  --platform codex \
  --dry-run
```

Si aceptas reemplazar archivos divergentes, ejecuta de nuevo con `--force`. Esta opción es deliberadamente explícita y crea respaldos confinados al target en `.harness/backups/` antes de reemplazar:

```bash
node custom-harness/scripts/install_harness.js \
  --target /ruta/al/proyecto \
  --platform codex \
  --force
```

No existe todavía un comando automático de desinstalación. Para retirar el harness, revisa el diff y restaura o elimina únicamente los archivos generados mediante tu sistema de control de versiones. No borres `.harness/` sin comprobar antes si contiene estado o configuración que quieras conservar.

## Arquitectura resumida

```text
Skill y políticas del consumidor
              │
              ▼
       Core independiente
 contexto · clasificación · workflow · estado
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
    Codex   Claude   Cursor
      │       │        │
      └──── validación ┘
```

El core define invariantes y estado; `.harness/config.toml` conserva decisiones del consumidor; los adaptadores cambian sintaxis y capacidades, no el significado del flujo. Las referencias técnicas están dentro de [`custom-harness/references/`](./custom-harness/references/).

## Seguridad

- Las instrucciones de sistema, usuario y repositorio siempre tienen prioridad sobre los defaults del harness.
- El instalador preflighta destinos y backups antes de mutar archivos.
- Las colisiones abortan toda la operación por defecto; `--force` requiere una decisión explícita.
- Symlinks, destinos con múltiples hardlinks, ancestros inválidos y backups fuera del target se rechazan.
- La configuración no se ejecuta como comandos durante la instalación; el motor de estado no puede lanzar procesos y el validador lo comprueba.
- Estado y checkpoints no deben contener secretos, tokens, credenciales ni payloads sensibles.
- Memanto se usa solo para contexto durable; no reemplaza el estado operativo del harness ni debe almacenar secretos o evidencia transitoria.
- Una tarea no puede pasar a `done` sin review aprobada y validación final exitosa.

## Estructura del repositorio

```text
.
├── custom-harness/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   ├── assets/templates/{shared,codex,claude,cursor}/
│   ├── references/
│   │   ├── architecture.md
│   │   ├── configuration.md
│   │   ├── adapters.md
│   │   ├── distribution.md
│   │   ├── project-context.md
│   │   └── memanto.md
│   ├── scripts/
│   │   ├── install_harness.js
│   │   ├── validate_harness.js
│   │   ├── workflow_state.js
│   │   └── toml_lite.js
│   └── tests/*.test.js
├── .agents/{leader,implementer,reviewer}.md
├── assets/axus-profile.jpeg
├── AGENTS.md
├── CLAUDE.md
├── init.sh
└── init.ps1
```

`init.sh` e `init.ps1` verifican rutas requeridas, marcadores de conflicto y Markdown, validan la skill y ejecutan la suite de pruebas con el runner integrado de Node.js.

## Roadmap

Hoy el repositorio ofrece una skill válida y un CLI local en JavaScript sin dependencias. Los siguientes canales están diseñados, pero **aún no están publicados**:

- Un paquete npm común consumible mediante npm/npx, pnpm y Bun, que reexporte los scripts actuales sin paso de build.
- Una .NET tool distribuida como paquete NuGet separado.
- Versionado sincronizado y pruebas de conformidad sobre el mismo core para ambos wrappers.

Hasta que esos artefactos existan, usa `npx skills` para instalar la skill o clona este repositorio para aplicar el harness con Node.js.

## Contribuir

Las contribuciones son bienvenidas. Antes de abrir un pull request:

1. Mantén el core independiente del framework y coloca las políticas específicas en el consumidor.
2. Añade regresiones para cualquier cambio de comportamiento.
3. Ejecuta `./init.sh`.
4. Comprueba que el instalador siga siendo idempotente y que los tres adaptadores conserven sus invariantes.
5. Usa Conventional Commits para describir el cambio.

## Licencia

Publicado bajo la [licencia MIT](./LICENSE).

## Autor

Creado y mantenido por **Fernando Gómez** — [@Axus00](https://github.com/Axus00).

Si este enfoque te resulta útil, adapta las políticas a tu equipo, prueba el flujo en un repositorio real y comparte los casos en los que el harness todavía pueda ser más claro o seguro.
