# Estructura del proyecto

Esta guía explica cómo está organizado el código y por qué: el árbol del repo, las capas
(clean architecture), el patrón con el que entra todo recurso externo y cómo se prueba.
El **porqué de cada decisión**, con las alternativas que descarté, está en
[`arquitectura.md` §7](design/arquitectura.md); aquí me centro en que el árbol se entienda.

## El repo a primer nivel

```
tfm-sql-agents/
├── agents/                  # los prompts de cada agente, en Markdown editable (sin recompilar)
├── backend/                 # todo el código TypeScript (aquí va el único npm install)
│   ├── src/
│   │   ├── cli/             # capa de presentación: arranque guiado, menús y flujos
│   │   ├── graphsql/        # el sistema en sí, en capas (explicado justo debajo)
│   │   ├── datasets/        # seeds deterministas de las BDs de demo (arcadia, nebula)
│   │   └── evaluation/      # los scripts del arnés de evaluación (npm run evaluate)
│   └── tests/               # unit / integration / diagnostic (ver más abajo)
├── descriptions/            # descripciones de tablas por BD (JSON); al repo solo van los .example
├── docs/                    # instalación, uso, arquitectura, evaluación, glosario, proceso
├── setup/                   # scripts de init que cargan los contenedores al crearse
├── docker-compose.yml       # la infraestructura local: Postgres+pgvector y Neo4j
├── docker-compose.hub.yml   # la demo desde Docker Hub, sin clonar el repo
└── install.ps1 / install.sh # el instalador de un comando
```

Dos detalles que no son casuales:

- **Los prompts son ficheros de texto** (`agents/*.md`), no strings embebidos en el código.
  Se editan con cualquier editor y el cambio se nota en el siguiente arranque, sin recompilar.
- **`descriptions/` está en el `.gitignore`** salvo los `.example`: las descripciones de una
  base de datos real son esquema confidencial de empresa y no deben entrar nunca en el repo
  ni en una imagen distribuible.

## Las capas (clean architecture)

Dentro de `backend/src/graphsql/` sigo clean architecture, y la idea cabe en una frase:
**las dependencias apuntan hacia dentro**. El centro no sabe nada de la infraestructura;
la infraestructura sí conoce el centro.

```
graphsql/
├── domain/           # el centro: tipos y reglas puras, sin ninguna dependencia externa
├── application/      # casos de uso: QUÉ hace cada paso (scan, retrieval, sql, evaluation)
├── infrastructure/   # adaptadores: cómo se habla con Postgres, Neo4j, el LLM, embeddings…
└── orchestration/    # los grafos LangGraph: CUÁNDO y en qué orden se ejecutan los pasos
```

- **`domain/`** son reglas que podría probar en una pizarra. Por ejemplo, `SqlSafetyPolicy`
  decide si una SQL es de solo lectura: es una función pura, no importa ni un framework.
  Aquí también viven los **puertos** (`domain/ports/`): interfaces como `IChatModel` o
  `ITargetDatabase` que dicen *qué necesito* de un recurso externo, sin decir cuál.
- **`application/`** son los casos de uso, agrupados por funcionalidad para que el árbol
  cuente la historia del sistema: `scan/` (escanear el esquema), `retrieval/` (encontrar
  las tablas), `sql/` (generar, juzgar, ejecutar), `evaluation/` (medir). Un caso de uso
  sabe *qué* hace su paso —"juzgar esta SQL"— pero no cuándo le toca ni con qué proveedor
  de LLM.
- **`infrastructure/`** son los adaptadores que cumplen los puertos: una carpeta por
  recurso (`postgres/`, `neo4j/`, `llm/`, `embeddings/`, `sqlserver/`…). Es la única capa
  que sabe que existe OpenAI o Neo4j.
- **`orchestration/`** es la máquina de estados de LangGraph que cablea los casos de uso:
  el bucle Judge↔SQL, la pausa de aprobación humana. Vive en el anillo exterior a
  propósito: **ningún caso de uso importa LangGraph**, así que la lógica se prueba sin el
  framework. No envuelvo LangGraph en un puerto: lo elegí precisamente por sus primitivas
  nativas (checkpointer, `interrupt_before`), y abstraerlas sería pagar una indirección
  para no usar lo que lo hace valioso.

El CLI (`src/cli/`) es entero capa de presentación y se organiza igual de simple:
`startup/` deja la sesión lista (comprobar Docker, elegir proveedor LLM), `flows/` tiene
un fichero por opción del menú (consultar, escanear, depurar la recuperación…), y las
utilidades compartidas (colores, cajas) viven en la raíz.

## Puerto + adaptador + factory

Todo recurso externo entra por el mismo patrón de tres piezas. Con el LLM como ejemplo:

1. **El puerto** (`domain/ports/IChatModel.ts`): la interfaz. "Necesito algo que reciba
   mensajes y devuelva texto." No dice OpenAI ni LM Studio; dice qué necesito.
2. **Los adaptadores** (`OpenAIChatModel`, `LocalChatModel`): cada uno cumple el puerto
   hablando con su proveedor real. Un fichero por clase, en PascalCase.
3. **La factory** (`ChatModelFactory`): el único sitio donde se decide cuál construir,
   leyendo la configuración. Construye **solo** el elegido, no los dos.

Lo que me compra: soportar un proveedor nuevo es escribir un adaptador y añadir un caso a
la factory — ningún caso de uso cambia, porque ninguno pregunta jamás
`if (proveedor === ...)`. Así es como el mismo código corre en la nube (OpenAI) o 100%
local (LM Studio) sin tocar nada, y como entró SQL Server como base de datos objetivo sin
reescribir el pipeline. El mismo trío existe para los embeddings, la BD objetivo, Neo4j y
el almacén vectorial.

## Cómo se prueba

Los casos de uso reciben sus colaboradores **inyectados**, con la implementación real como
valor por defecto. El Judge, por ejemplo, declara lo que necesita:

```ts
export interface SqlJudgingDependencies {
  createChatModel(): IChatModel                            // el juez LLM
  checkSyntax(sql: SqlStatement): Promise<SqlSyntaxCheck>  // el EXPLAIN contra la BD
}

export const defaultSqlJudgingDependencies: SqlJudgingDependencies = {
  createChatModel: () => ChatModelFactory.fromEnv('generation'),
  checkSyntax: (sql) => checkSqlSyntax(sql),
}
```

En producción nadie pasa nada y se usan las reales; en un test le paso un doble que
devuelve un veredicto enlatado y pruebo toda la lógica de orquestación —las ramas, los
errores, los límites— **sin Docker y sin gastar tokens**. De ahí salen las tres suites de
`backend/tests/`, separadas por lo que necesitan para correr:

- **`unit/`** (`npm test`) — corren siempre, offline, en milisegundos, con dobles. Son los
  que exijo en verde antes de cerrar nada.
- **`integration/`** (`npm run test:integration`, opt-in) — los mismos casos de uso con la
  infraestructura real, reservados para lo que un doble no puede demostrar: que el cursor
  corta de verdad en el límite de filas, que la búsqueda semántica real traduce "clientes"
  a `customer`. Necesitan `docker compose up`.
- **`diagnostic/`** (`npm run test:diagnostic`, opt-in) — no prueban la aplicación sino el
  *entorno*: ¿responden los contenedores, existen las BDs, está el seed bien cargado? Para
  descartar rápido un "¿es un bug o es que no tengo Docker levantado?".

La estrategia completa (incluido por qué evito la redundancia entre suites) está en
[`arquitectura.md` §9](design/arquitectura.md).

## Normas transversales

Dos reglas que aplico en todas las capas:

- **Legibilidad antes que ahorrar líneas.** Prefiero código que se lee de arriba abajo a
  un truco compacto que obliga a pararse. Si dudo entre elegante y obvio, gana obvio.
- **Zod en las fronteras, TypeScript por dentro.** Valido con esquemas declarativos todo
  dato cuya forma no controlo — el `.env`, las respuestas JSON del LLM, las filas que
  devuelven las BDs — con valores de caída (`.catch()`) para que un campo mal formado no
  tumbe un veredicto entero. Los tipos internos del dominio no llevan Zod: ahí ya vigila
  el compilador.
