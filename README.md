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

init → análisis → implementación → pruebas → reviewer → correcciones → init final

```

El proyecto combina dos piezas distintas:

- **Una skill para el agente:** enseña a clasificar tareas, separar responsabilidades y respetar las políticas del repositorio consumidor.

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

## Cómo funciona

| Responsabilidad | Contrato |

| --- | --- |

| **Leader** | Clasifica, registra, delega y coordina. No implementa ni se autoaprueba. |

| **Implementer** | Modifica solo el alcance delegado, preserva cambios existentes y ejecuta pruebas. |

| **Reviewer** | Revisa sin editar, aporta evidencia y aprueba o rechaza explícitamente. |

La clasificación orienta el nivel de razonamiento y el grado de coordinación, sin fijar nombres de modelos que una plataforma podría no ofrecer:

| Clase | Señales típicas |

| --- | --- |

| `small` | Cambio localizado, bajo riesgo y pocos archivos. |

| `medium` | Varios archivos, una integración o ambigüedad moderada. |

| `large` | Arquitectura transversal, persistencia, seguridad, distribución o alto impacto. |

Solo el leader puede marcar una tarea como `done`, y únicamente cuando el reviewer aprobó y el init final pasó.

## Contexto persistente con Memanto

Custom Harness puede usar Memanto como una capa de memoria persistente antes del análisis, la delegación o la implementación. La idea no es convertir la memoria en otra fuente de estado del workflow, sino recuperar decisiones durables del proyecto y evitar que el usuario tenga que repetirlas en cada sesión.

El flujo de contexto es:

solicitud
│
▼
repositorio actual
│
▼
Memanto recall
│
▼
¿hay contexto suficiente?
│
├── sí ───────────────► continuar con el branch
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

El Project Context Gate prioriza contexto como:

propósito del proyecto;

plataforma objetivo;

arquitectura del repositorio;

estructura existente de agentes;

decisiones técnicas importantes;

restricciones de compatibilidad;

convenciones de código;

expectativas de pruebas y seguridad;

enfoques descartados;

limitaciones conocidas;

definición de terminado.

El gate se evalúa cuando se activa la skill, pero Grill Mode no se ejecuta en cada solicitud. Las tareas pequeñas o los follow-ups bien delimitados reutilizan el contexto ya establecido. Solo se pregunta cuando una incertidumbre puede cambiar materialmente la arquitectura, compatibilidad, seguridad, comportamiento destructivo, distribución o criterios de aceptación.

Las fuentes de contexto siguen esta precedencia:

instrucciones de mayor prioridad;

evidencia actual del repositorio;

instrucciones explícitas del usuario en la conversación actual;

memorias durables recuperadas desde Memanto;

supuestos.

Memanto nunca reemplaza el estado real del repositorio ni las instrucciones actuales. Si una memoria antigua entra en conflicto con evidencia más reciente, el harness conserva la evidencia actual y solo pide aclaración cuando el conflicto afecta la tarea.

### Grill Mode

Cuando falta información realmente bloqueante, Custom Harness agrupa entre 2 y 5 preguntas de alto impacto en lugar de iniciar una entrevista completa.

Por ejemplo:

Recuperé desde el repositorio y la memoria que el target actual es Codex, pero faltan dos decisiones:

¿Custom Harness debe reemplazar el workflow de agentes existente o coexistir con él?

¿El harness instalado debe seguir funcionando en repositorios que no tengan Python disponible?

Si el usuario autoriza explícitamente usar supuestos razonables, el trabajo puede continuar documentándolos. Esos supuestos no se guardan como decisiones durables hasta que sean confirmados.

### Qué se guarda y qué no

Memanto se reserva para conocimiento reutilizable entre tareas y sesiones.

Ejemplos de información durable:

decisiones de arquitectura;

plataformas soportadas;

requisitos de compatibilidad;

restricciones del consumidor;

convenciones del proyecto;

objetivos durables;

enfoques rechazados y su motivo.

No se persisten como memoria durable:

salidas temporales de comandos;

fallos transitorios de pruebas;

stack traces;

patches intermedios;

conclusiones especulativas;

supuestos no confirmados.

La separación de responsabilidades es explícita:

repositorio
└── estado real del código y la configuración

.harness/task-status.json
└── estado operacional de la ejecución actual

Memanto
└── conocimiento durable del proyecto entre sesiones

Por eso, Memanto no reconstruye fases, reviewers, checkpoints ni estados done/rejected. Ese estado sigue perteneciendo al harness.

La lógica detallada del gate vive dentro de la skill, en custom-harness/references/grill-me.md, y custom-harness/SKILL.md decide cuándo aplicarla.

## Instalación rápida

### Opción 1: instalar la skill en tu agente

El CLI de [skills.sh](https://www.skills.sh/docs/cli) permite seleccionar la skill y el agente de destino:

```bash

npx skills@latest add Axus00/skills

```

Selecciona `custom-harness` y Codex, Claude Code o Cursor según tu entorno. Después puedes pedir al agente que use `custom-harness` para adaptar un repositorio.

> Este comando instala conocimiento para el agente. No ejecuta por sí solo el instalador Python sobre tu proyecto.

### Opción 2: clonar el repositorio

Esta vía es la más transparente para inspeccionar, desarrollar y ejecutar los scripts directamente:

```bash

git clone https://github.com/Axus00/skills.git

cd skills

./init.sh

```

Requisitos para los scripts locales:

- Python 3.

- Bash para `init.sh`, o PowerShell para `init.ps1`.

- Node.js únicamente si eliges la instalación mediante `npx skills`.

## Aplicar el harness a un repositorio

Ejecuta estos comandos desde el clone de `skills`. Sustituye `/ruta/al/proyecto` por el repositorio consumidor.

### 1. Previsualizar

```bash

python3 custom-harness/scripts/install_harness.py \

--target /ruta/al/proyecto \

--platform codex \

--dry-run

```

El dry-run muestra el plan completo sin escribir. Si encuentra contenido diferente o una ruta estructural insegura, informa una colisión y aborta.

### 2. Instalar

```bash

python3 custom-harness/scripts/install_harness.py \

--target /ruta/al/proyecto \

--platform codex

```

Puedes repetir `--platform` para generar varios adaptadores en una sola operación:

```bash

python3 custom-harness/scripts/install_harness.py \

--target /ruta/al/proyecto \

--platform codex \

--platform claude \

--platform cursor

```

### 3. Validar

```bash

python3 custom-harness/scripts/validate_harness.py \

--target /ruta/al/proyecto \

--platform codex

```

Para varios adaptadores, repite `--platform` igual que durante la instalación. La validación comprueba estructura, contratos por rol, ciclo de trabajo, estado, checkpoint y gates de finalización.

## Elegir adaptador

Todos los adaptadores conservan las mismas invariantes, pero usan las convenciones de cada producto:

| Plataforma | Archivos principales | Consideración |

| --- | --- | --- |

| **Codex** | `AGENTS.md` y `.agents/{leader,implementer,reviewer}.md` | Aprovecha coordinación de subagentes cuando está disponible. |

| **Claude Code** | `CLAUDE.md` y `.claude/agents/*.md` | Define agentes nativos con herramientas acordes a cada rol. |

| **Cursor** | `.cursor/rules/custom-harness.mdc` | Si no hay subagentes aislados, exige pases separados y registra la degradación. |

Los tres comparten:

- `.harness/config.toml`

- `.harness/task-status.json`

- `.harness/context/task-context.toon`

## Actualizar, reemplazar y retirar

El instalador es idempotente: volver a ejecutarlo con el mismo contenido produce operaciones `unchanged`.

Para actualizar desde el código fuente:

```bash

git pull --ff-only

python3 custom-harness/scripts/install_harness.py \

--target /ruta/al/proyecto \

--platform codex \

--dry-run

```

Si aceptas reemplazar archivos divergentes, ejecuta de nuevo con `--force`. Esta opción es deliberadamente explícita y crea respaldos confinados al target en `.harness/backups/` antes de reemplazar:

```bash

python3 custom-harness/scripts/install_harness.py \

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

clasificación · workflow · estado

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

- La configuración no se ejecuta como comandos durante la instalación.

- Estado y checkpoints no deben contener secretos, tokens, credenciales ni payloads sensibles.

- Memanto se usa solo para contexto durable; no reemplaza el estado operativo del harness ni debe almacenar secretos o evidencia transitoria.

- Una tarea no puede pasar a `done` sin review aprobada y validación final exitosa.

## Estructura del repositorio

```text

.

├── custom-harness/

│   ├── SKILL.md

│   ├── agents/openai.yaml

│   ├── assets/templates/

│   ├── references/

│   │   └── grill-me.md

│   ├── scripts/

│   └── tests/

├── .agents/

├── assets/axus-profile.jpeg

├── AGENTS.md

├── init.sh

└── init.ps1

```

## Roadmap

Hoy el repositorio ofrece una skill válida y un CLI Python local. Los siguientes canales están diseñados, pero **aún no están publicados**:

- Un paquete npm común consumible mediante npm/npx, pnpm y Bun.

- Una .NET tool distribuida como paquete NuGet separado.

- Versionado sincronizado y pruebas de conformidad sobre el mismo core para ambos wrappers.

Hasta que esos artefactos existan, usa `npx skills` para instalar la skill o clona este repositorio para aplicar el harness con Python.

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
