/**
 * Tool de generación de SQL para el agente (SPEC-05).
 *
 * Dada una pregunta, recupera las tablas relevantes (SPEC-04) y genera la SQL en
 * el dialecto de la BD objetivo. De momento solo genera: validarla y ejecutarla
 * son SPEC-06 y SPEC-08.
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { retrieveSchemaContext } from '../application/schemaRetrieval'
import { generateSql } from '../application/sqlGeneration'
import { loadTargetDatabases, sqlDialectFor } from '../infrastructure/config/targetDatabases'

const generateSqlTool = tool(
  async ({ pregunta }) => {
    const context = await retrieveSchemaContext(pregunta)
    if (context.tableNames.length === 0) {
      return 'No encontré tablas relevantes. ¿Está vectorizado el esquema? (CLI → "Escanear el esquema").'
    }
    const dialect = sqlDialectFor(loadTargetDatabases()[0])
    const sql = await generateSql(pregunta, context, dialect)
    return `SQL (${sql.dialect}), sobre las tablas ${context.tableNames.join(', ')}:\n\n${sql.text}`
  },
  {
    name: 'generar_sql',
    description:
      'Dada una pregunta en lenguaje natural, recupera las tablas relevantes y genera la consulta SQL de solo lectura que la responde, en el dialecto de la base de datos objetivo. Úsala cuando el usuario pida la consulta SQL o cómo obtener ciertos datos. (La SQL todavía no se valida ni se ejecuta.)',
    schema: z.object({ pregunta: z.string().describe('La pregunta en lenguaje natural') }),
  },
)

export const sqlTools = [generateSqlTool]
