/**
 * Tools del esquema para el agente.
 *
 * Permiten que el agente escanee la BD objetivo e ingiera su esquema en Neo4j,
 * y que consulte el resumen de lo ingerido. La ingesta usa la primera BD del
 * catálogo (la del `.env`).
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { ingestSchema, getSchemaSummary } from '../application/schemaIngestion'
import { retrieveSchemaContext } from '../application/schemaRetrieval'
import { loadTargetDatabases, targetDatabaseLabel } from '../infrastructure/config/targetDatabases'

const ingestSchemaTool = tool(
  async () => {
    const target = loadTargetDatabases()[0]
    const summary = await ingestSchema(target)
    return `Esquema de "${targetDatabaseLabel(target)}" ingerido en Neo4j: ${summary.tables} tablas, ${summary.columns} columnas y ${summary.relationships} relaciones.`
  },
  {
    name: 'ingerir_esquema',
    description:
      'Escanea la base de datos objetivo configurada y vuelca su esquema (tablas, columnas y relaciones) a Neo4j. Úsala cuando el usuario pida escanear, cargar o ingerir el esquema.',
    schema: z.object({}),
  },
)

const schemaSummaryTool = tool(
  async () => {
    const summary = await getSchemaSummary()
    return `Esquema en Neo4j: ${summary.tables} tablas, ${summary.columns} columnas y ${summary.relationships} relaciones.`
  },
  {
    name: 'resumen_esquema',
    description:
      'Devuelve un resumen del esquema ya ingerido en Neo4j (número de tablas, columnas y relaciones).',
    schema: z.object({}),
  },
)

const schemaLinkingTool = tool(
  async ({ pregunta }) => {
    const context = await retrieveSchemaContext(pregunta)
    if (context.tableNames.length === 0) {
      return 'No encontré tablas relevantes. ¿Está vectorizado el esquema? (CLI → "Escanear el esquema").'
    }
    return `Para "${pregunta}" usaría estas tablas: ${context.tableNames.join(', ')}.`
  },
  {
    name: 'schema_linking',
    description:
      'Averigua qué tablas del esquema son relevantes para una pregunta (búsqueda semántica + expansión por claves foráneas). Úsala SIEMPRE que el usuario pregunte por datos, por qué tablas usar o dónde está cierta información. No adivines nombres de tablas: consulta esta herramienta.',
    schema: z.object({ pregunta: z.string().describe('La pregunta en lenguaje natural') }),
  },
)

export const schemaTools = [ingestSchemaTool, schemaSummaryTool, schemaLinkingTool]
