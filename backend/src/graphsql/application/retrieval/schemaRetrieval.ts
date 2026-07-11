/**
 * Recuperación GraphRAG del contexto de esquema (SPEC-04): top-K por significado,
 * expansión por FK en el grafo y acotación final por similitud, para no arrastrar
 * todas las vecinas de una tabla muy conectada (p. ej. `customer`).
 */
import { TableEmbeddingsStore } from '../../infrastructure/postgres/TableEmbeddingsStore'
import { EmbeddingsFactory } from '../../infrastructure/embeddings/EmbeddingsFactory'
import { Neo4jConnection } from '../../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager } from '../../infrastructure/neo4j/SchemaGraphManager'
import { buildSchemaContext, type SchemaContext } from '../../domain/schema/SchemaContext'
import { rankLexically, fuseByReciprocalRank } from './hybridRanking'
import { selectRelevantTables, defaultSchemaSelectionDependencies } from './schemaSelection'
import type { TableSchema } from '../../domain/schema/TableSchema'
import type { TableMatch } from '../../domain/ports/IEmbeddingsStore'
import type { RetrievalTrace, RankedTable, ExpandedTable, ContextTable, InclusionReason } from '../../domain/schema/RetrievalTrace'

/** Candidatas por significado antes de expandir por FK. */
export const SEMANTIC_TOP_K = 5

/** Tope del contexto final. Debe ser ≥ SEMANTIC_TOP_K. */
export const MAX_CONTEXT_TABLES = 8

/** Longitud máxima del camino de FK al buscar conectores (modo 'paths'). */
export const PATH_MAX_LENGTH = 3

/** Tamaño del pool de candidatas que ve el selector LLM (schema linking por razonamiento). */
export const SELECTOR_POOL_SIZE = 30

/**
 * - 'neighbors': solo las vecinas a un salto de FK (comportamiento histórico).
 * - 'paths': además, los conectores en el camino de FK entre anclas (puentes de JOIN sin
 *   los que el JOIN es imposible). Es la expansión por caminos del GraphRAG.
 */
export type ExpansionMode = 'neighbors' | 'paths'

export interface SchemaRetrievalOptions {
  topK?: number
  maxTables?: number
  /** Tablas fijadas a mano (SPEC-08): entran sí o sí si existen; las inexistentes se ignoran. */
  mustInclude?: string[]
  /** Por defecto 'neighbors', para no alterar las métricas ya medidas. */
  expansionMode?: ExpansionMode
  /** Solo en modo 'paths': longitud máxima del camino al buscar conectores. */
  maxPathLength?: number
  /** Fusiona el ranking denso con uno léxico (RRF) para rescatar el pivote de la pregunta. */
  lexical?: boolean
  /** Un LLM elige las tablas del pool por razonamiento; si falla, cae al recorte por score. */
  useSelector?: boolean
  /** Tamaño del pool que ve el selector (por defecto SELECTOR_POOL_SIZE). */
  poolSize?: number
}

/**
 * Palancas del pipeline EN VIVO, compartidas con el modo depuración para que este depure
 * exactamente el circuito que corre. El arnés de evaluación no las usa (defaults = SPEC-04).
 */
export const LIVE_RETRIEVAL_OPTIONS: SchemaRetrievalOptions = {
  expansionMode: 'paths',
  lexical: true,
  useSelector: true,
}

export interface SchemaRetrievalDependencies {
  /** Devuelve TODAS las tablas ordenadas por similitud, no solo las top-K. */
  rankTablesBySimilarity(question: string): Promise<TableMatch[]>
  /** Devuelve las tablas dadas + sus vecinas por FK. */
  expandByForeignKeys(tableNames: string[]): Promise<TableSchema[]>
  /** Modo 'paths': tablas puente en el camino de FK más corto entre las anclas. */
  findConnectingTables?(tableNames: string[], maxPathLength: number): Promise<TableSchema[]>
  /** Modo híbrido: ranking léxico (coincidencia de palabras nombre/columnas) de todas las tablas. */
  rankTablesLexically?(question: string): Promise<TableMatch[]>
  /** Selección con LLM: elige, de un pool de candidatas, las tablas relevantes por razonamiento. */
  selectTables?(question: string, pool: TableSchema[]): Promise<string[]>
}

export const defaultSchemaRetrievalDependencies: SchemaRetrievalDependencies = {
  async rankTablesBySimilarity(question) {
    const store = await TableEmbeddingsStore.fromEnv()
    try {
      const indexed = await store.getIndexedModel()
      if (!indexed) {
        throw new Error(
          'No hay esquema vectorizado todavía. Escanea y vectoriza la BD objetivo primero (CLI → "Escanear el esquema").',
        )
      }
      // Consulto con el mismo modelo con que indexé (mismo espacio vectorial).
      const embeddings = EmbeddingsFactory.forIndexedModel(indexed)
      const vector = await embeddings.embed(question)
      const total = await store.count()
      return await store.searchSimilar(vector, total)
    } finally {
      await store.close()
    }
  },
  async expandByForeignKeys(tableNames) {
    const neo4j = Neo4jConnection.fromEnv()
    try {
      return await new SchemaGraphManager(neo4j).getTablesWithForeignKeyNeighbors(tableNames)
    } finally {
      await neo4j.close()
    }
  },
  async findConnectingTables(tableNames, maxPathLength) {
    const neo4j = Neo4jConnection.fromEnv()
    try {
      return await new SchemaGraphManager(neo4j).getConnectingTables(tableNames, maxPathLength)
    } finally {
      await neo4j.close()
    }
  },
  async rankTablesLexically(question) {
    const store = await TableEmbeddingsStore.fromEnv()
    try {
      return rankLexically(question, await store.getAllTableTexts())
    } finally {
      await store.close()
    }
  },
  selectTables(question, pool) {
    return selectRelevantTables(question, pool, defaultSchemaSelectionDependencies)
  },
}

/**
 * Orden del recorte con presupuesto. El motivo de cada tabla se clasifica una sola vez y
 * gobierna a la vez el recorte y la traza (SPEC-13), para que no puedan divergir.
 */
const CUT_PRIORITY: InclusionReason[] = ['pinned', 'semantic', 'connector', 'fk-target', 'expansion']

interface RetrievalInternals {
  /** Palancas ya resueltas (las mismas que reporta la traza). */
  levers: RetrievalTrace['levers']
  ranked: TableMatch[]
  scoreByName: Map<string, number>
  pinned: string[]
  topKNames: string[]
  /** Motivo de inclusión de cada tabla expandida; su orden en CUT_PRIORITY es la prioridad. */
  reasonByName: Map<string, InclusionReason>
  expanded: TableSchema[]
  /** Recorte por score (fallback y contexto por defecto). */
  limited: TableSchema[]
  /** Selección con LLM: si se intentó, el tamaño del pool que vio y lo que eligió (puede ser nada). */
  selection: { poolSize: number; chosen: string[] } | null
  /** Tablas que eligió el selector, ya completadas por grafo; null si no se usó o no eligió. */
  selected: TableSchema[] | null
}

function uniqueNames(first: string[], second: string[]): string[] {
  return Array.from(new Set(first.concat(second)))
}

/** Destinos de FK: las tablas que las `ofNames` referencian, leídas de la metadata ya recuperada. */
function referencedTargets(tables: TableSchema[], ofNames: Set<string>): Set<string> {
  const referenced = new Set<string>()
  for (const table of tables) {
    if (!ofNames.has(table.name)) continue
    for (const fk of table.foreignKeys) {
      referenced.add(fk.referencesTable)
    }
  }
  return referenced
}

/** Añade a `base` las tablas de `extra` que aún no están (dedup por nombre). Muta `base`. */
function mergeAbsentTables(base: TableSchema[], extra: TableSchema[]): void {
  const present = new Set(base.map((table) => table.name))
  for (const table of extra) {
    if (!present.has(table.name)) {
      base.push(table)
      present.add(table.name)
    }
  }
}

function resolveLevers(options: SchemaRetrievalOptions): RetrievalTrace['levers'] {
  return {
    semanticTopK: options.topK ?? SEMANTIC_TOP_K,
    maxContextTables: options.maxTables ?? MAX_CONTEXT_TABLES,
    expansionMode: options.expansionMode ?? 'neighbors',
    maxPathLength: options.maxPathLength ?? PATH_MAX_LENGTH,
    lexical: options.lexical ?? false,
    useSelector: options.useSelector ?? false,
    poolSize: options.poolSize ?? SELECTOR_POOL_SIZE,
  }
}

/** Ranking denso (pgvector) y, en modo híbrido, fusionado con el léxico por RRF (independientes → en paralelo). */
async function rankTables(
  question: string,
  deps: SchemaRetrievalDependencies,
  levers: RetrievalTrace['levers'],
): Promise<TableMatch[]> {
  const [dense, lexical] = await Promise.all([
    deps.rankTablesBySimilarity(question),
    levers.lexical && deps.rankTablesLexically ? deps.rankTablesLexically(question) : null,
  ])
  return lexical ? fuseByReciprocalRank([dense, lexical]) : dense
}

interface StructuralRescue {
  connectors: TableSchema[]
  connectorNames: string[]
  fkTargetNames: string[]
}

/**
 * Rescates estructurales del modo 'paths', que la similitud dejaría fuera del recorte:
 * conectores (puentes de JOIN entre anclas) y destinos de FK de las anclas (sus dimensiones).
 */
async function rescueByPaths(
  candidateNames: string[],
  expanded: TableSchema[],
  deps: SchemaRetrievalDependencies,
  maxPathLength: number,
): Promise<StructuralRescue> {
  const anchorSet = new Set(candidateNames)
  const connectors = deps.findConnectingTables ? await deps.findConnectingTables(candidateNames, maxPathLength) : []
  const connectorNames = connectors.map((table) => table.name).filter((name) => !anchorSet.has(name))

  const connectorSet = new Set(connectorNames)
  const present = new Set([...expanded, ...connectors].map((table) => table.name))
  const fkTargetNames = [...referencedTargets(expanded, anchorSet)].filter(
    (name) => present.has(name) && !anchorSet.has(name) && !connectorSet.has(name),
  )
  return { connectors, connectorNames, fkTargetNames }
}

interface ReasonGroups {
  pinned: string[]
  topK: string[]
  connectors: string[]
  fkTargets: string[]
}

/** Motivo de inclusión de cada tabla, clasificado una sola vez (gobierna recorte y traza). */
function classifyReasons(expanded: TableSchema[], groups: ReasonGroups): Map<string, InclusionReason> {
  const pinnedSet = new Set(groups.pinned)
  const topKSet = new Set(groups.topK)
  const connectorSet = new Set(groups.connectors)
  const fkTargetSet = new Set(groups.fkTargets)
  const reasonByName = new Map<string, InclusionReason>()
  for (const { name } of expanded) {
    if (pinnedSet.has(name)) reasonByName.set(name, 'pinned')
    else if (topKSet.has(name)) reasonByName.set(name, 'semantic')
    else if (connectorSet.has(name)) reasonByName.set(name, 'connector')
    else if (fkTargetSet.has(name)) reasonByName.set(name, 'fk-target')
    else reasonByName.set(name, 'expansion')
  }
  return reasonByName
}

/**
 * Orden del recorte: prioridad del motivo (CUT_PRIORITY) y, dentro de cada nivel, por score.
 * Todo compite por el mismo presupuesto, así el rescate estructural no expulsa a las candidatas.
 */
function orderByPriority(
  expanded: TableSchema[],
  reasonByName: Map<string, InclusionReason>,
  scoreByName: Map<string, number>,
): TableSchema[] {
  const priorityOf = (name: string) => CUT_PRIORITY.indexOf(reasonByName.get(name) ?? 'expansion')
  const scoreOf = (name: string) => scoreByName.get(name) ?? 0
  return [...expanded].sort(
    (a, b) => priorityOf(a.name) - priorityOf(b.name) || scoreOf(b.name) - scoreOf(a.name),
  )
}

/**
 * El selector LLM elige las tablas del pool por razonamiento; sus JOIN se completan por grafo.
 * Si no elige nada o el LLM falla, `selected` queda null y el contexto cae al recorte por score.
 */
async function runSelector(
  question: string,
  ordered: TableSchema[],
  pinned: string[],
  selectTables: NonNullable<SchemaRetrievalDependencies['selectTables']>,
  deps: SchemaRetrievalDependencies,
  levers: RetrievalTrace['levers'],
): Promise<Pick<RetrievalInternals, 'selection' | 'selected'>> {
  const pool = ordered.slice(0, Math.max(levers.poolSize, pinned.length))
  const poolNames = new Set(pool.map((table) => table.name))
  let chosen: string[] = []
  try {
    chosen = (await selectTables(question, pool)).filter((name) => poolNames.has(name))
  } catch {
    chosen = []
  }
  // Las fijadas (SPEC-08) entran elija lo que elija el LLM.
  const selected = chosen.length > 0 ? await completeSelectionForJoins(uniqueNames(pinned, chosen), deps, levers.maxPathLength) : null
  return { selection: { poolSize: pool.length, chosen }, selected }
}

/** Circuito único compartido por `retrieveSchemaContext` y `explainSchemaRetrieval`. */
async function runRetrieval(
  question: string,
  deps: SchemaRetrievalDependencies,
  options: SchemaRetrievalOptions,
): Promise<RetrievalInternals> {
  const levers = resolveLevers(options)
  const ranked = await rankTables(question, deps, levers)
  const scoreByName = new Map(ranked.map((match) => [match.tableName, match.score]))
  const pinned = (options.mustInclude ?? []).filter((name) => scoreByName.has(name))
  const topKNames = ranked.slice(0, levers.semanticTopK).map((match) => match.tableName)
  const candidateNames = uniqueNames(pinned, topKNames)
  const expanded = await deps.expandByForeignKeys(candidateNames)

  let connectorNames: string[] = []
  let fkTargetNames: string[] = []
  if (levers.expansionMode === 'paths') {
    const rescue = await rescueByPaths(candidateNames, expanded, deps, levers.maxPathLength)
    mergeAbsentTables(expanded, rescue.connectors)
    connectorNames = rescue.connectorNames
    fkTargetNames = rescue.fkTargetNames
  }

  const reasonByName = classifyReasons(expanded, { pinned, topK: topKNames, connectors: connectorNames, fkTargets: fkTargetNames })
  const ordered = orderByPriority(expanded, reasonByName, scoreByName)
  const limited = ordered.slice(0, Math.max(levers.maxContextTables, pinned.length))

  const selectorResult =
    levers.useSelector && deps.selectTables
      ? await runSelector(question, ordered, pinned, deps.selectTables, deps, levers)
      : { selection: null, selected: null }

  return { levers, ranked, scoreByName, pinned, topKNames, reasonByName, expanded, limited, ...selectorResult }
}

/**
 * Completa la selección del LLM con lo justo para escribir los JOIN: las tablas elegidas +
 * sus destinos de FK (dimensiones) + los conectores entre ellas (puentes). Sin recortar por
 * score: aquí ya hay pocas tablas y todas las quiere el usuario.
 */
async function completeSelectionForJoins(
  selectedNames: string[],
  deps: SchemaRetrievalDependencies,
  maxPathLength: number,
): Promise<TableSchema[]> {
  const withNeighbors = await deps.expandByForeignKeys(selectedNames)
  const fkTargets = referencedTargets(withNeighbors, new Set(selectedNames))
  const connectors = deps.findConnectingTables ? await deps.findConnectingTables(selectedNames, maxPathLength) : []
  const keep = new Set<string>([...selectedNames, ...fkTargets, ...connectors.map((table) => table.name)])

  const result = withNeighbors.filter((table) => keep.has(table.name))
  mergeAbsentTables(result, connectors)
  return result
}

export async function retrieveSchemaContext(
  question: string,
  deps: SchemaRetrievalDependencies = defaultSchemaRetrievalDependencies,
  options: SchemaRetrievalOptions = {},
): Promise<SchemaContext> {
  const { limited, selected } = await runRetrieval(question, deps, options)
  // El selector, si eligió, manda; si no, el recorte por score de siempre.
  return buildSchemaContext(selected ?? limited)
}

/**
 * Igual que `retrieveSchemaContext`, pero con la traza del circuito (SPEC-13).
 * No altera la recuperación: compone la traza sobre los mismos pasos.
 */
export async function explainSchemaRetrieval(
  question: string,
  deps: SchemaRetrievalDependencies = defaultSchemaRetrievalDependencies,
  options: SchemaRetrievalOptions = {},
): Promise<RetrievalTrace> {
  const internals = await runRetrieval(question, deps, options)
  const { ranked, scoreByName, pinned, topKNames, reasonByName, expanded, limited, selection, selected } = internals

  // Si el selector eligió, el contexto real es su selección (completada); si no, el recorte.
  const finalTables = selected ?? limited

  const topKSet = new Set(topKNames)
  const ranking: RankedTable[] = ranked.map((match) => ({
    tableName: match.tableName,
    score: match.score,
    isCandidate: topKSet.has(match.tableName),
  }))

  // Cada sección de la traza es la vista por motivo de la MISMA clasificación del recorte.
  const withScore = (name: string): ExpandedTable => ({ tableName: name, score: scoreByName.get(name) ?? 0 })
  const byScoreDescending = (a: ExpandedTable, b: ExpandedTable) => b.score - a.score
  const addedFor = (reason: InclusionReason): ExpandedTable[] =>
    expanded
      .filter((table) => reasonByName.get(table.name) === reason)
      .map((table) => withScore(table.name))
      .sort(byScoreDescending)

  // Con selección del LLM, el motivo lo dan las tablas elegidas (lo demás completa sus JOIN);
  // las fijadas siguen siendo 'pinned'. Sin selección, el motivo del recorte por score.
  const pinnedSet = new Set(pinned)
  const chosenSet = new Set(selection?.chosen ?? [])
  const reasonFor = (name: string): InclusionReason => {
    if (!selected) return reasonByName.get(name) ?? 'expansion'
    if (pinnedSet.has(name)) return 'pinned'
    return chosenSet.has(name) ? 'selector' : 'fk-target'
  }

  const finalContext: ContextTable[] = finalTables.map((table) => ({
    tableName: table.name,
    score: scoreByName.get(table.name) ?? 0,
    reason: reasonFor(table.name),
  }))

  return {
    question,
    ranking,
    candidates: topKNames,
    expansionAdded: addedFor('expansion'),
    connectorsAdded: addedFor('connector'),
    fkTargetsAdded: addedFor('fk-target'),
    selection,
    finalContext,
    context: buildSchemaContext(finalTables),
    levers: internals.levers,
  }
}
