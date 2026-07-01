/**
 * Flujo de CLI: escanear el esquema de la BD objetivo.
 *
 * Primero pregunto todo (BD objetivo, descripciones y confirmación con su aviso de
 * coste) y luego reconstruyo Neo4j y pgvector JUNTOS, con la misma decisión de
 * descripciones, para que los dos almacenes nunca queden desincronizados.
 */
import chalk from 'chalk'
import { select, confirm } from '@inquirer/prompts'
import { loadTargetDatabases, targetDatabaseLabel, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { ingestSchema } from '../graphsql/application/schemaIngestion'
import { vectorizeSchema } from '../graphsql/application/schemaVectorization'
import { getIndexedModel } from '../graphsql/application/getIndexedModel'
import { EmbeddingsFactory } from '../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { EmbeddingProvider } from '../graphsql/infrastructure/embeddings/EmbeddingProvider'
import { hasDescriptionsFile, loadDescriptions, DESCRIPTIONS_DIR } from '../graphsql/infrastructure/config/descriptions'
import type { IEmbeddings } from '../graphsql/domain/ports/IEmbeddings'
import { warnIfLocalModelMissing } from './ui'

export async function runSchemaScan(): Promise<void> {
  const targets = loadTargetDatabases()

  // --- Fase 1: preguntar todo ---
  const target = await select({
    message: 'Elige la base de datos objetivo a escanear',
    choices: targets.map((t) => ({ name: targetDatabaseLabel(t), value: t })),
  })
  const descriptions = await askDescriptions()
  const embeddingProvider = await askEmbeddingProvider()
  const embeddings = EmbeddingsFactory.create(embeddingProvider)

  // Un escaneo reconstruye Neo4j Y pgvector JUNTOS, con la misma decisión de
  // descripciones: así los dos almacenes nunca quedan desincronizados. La
  // confirmación (con su aviso de coste) gatea el escaneo completo; si no la doy,
  // no se toca nada.
  const confirmed = await confirmScan(embeddingProvider, embeddings)
  if (!confirmed) {
    console.log(chalk.dim('\nEscaneo cancelado: no se ha tocado ni Neo4j ni el índice vectorial.\n'))
    return
  }

  // --- Fase 2: reconstruir ambos almacenes con la misma decisión de descripciones ---
  console.log(chalk.dim(`\nEscaneando "${targetDatabaseLabel(target)}" e ingiriendo en Neo4j...\n`))
  try {
    const summary = await ingestSchema(target, descriptions)
    console.log(
      chalk.green('✔ Esquema en Neo4j:') +
        ` ${summary.tables} tablas, ${summary.columns} columnas, ${summary.relationships} relaciones.\n`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No he podido ingerir el esquema en Neo4j.'))
    console.log(chalk.dim('¿Están disponibles la BD objetivo y Neo4j? (docker compose up -d)'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
    return
  }

  const vectorized = await executeVectorization(target, embeddingProvider, embeddings, descriptions)
  if (!vectorized) {
    console.log(
      chalk.red(
        '⚠ Neo4j se actualizó pero la vectorización falló: el índice vectorial ha quedado DESINCRONIZADO respecto a Neo4j. Vuelve a escanear cuando el proveedor de embeddings esté disponible para realinearlos.\n',
      ),
    )
  }
}

/** Si hay un fichero de descripciones (no el de ejemplo), pregunto si incluirlas. */
async function askDescriptions(): Promise<Map<string, string> | undefined> {
  if (!hasDescriptionsFile()) {
    return undefined
  }
  const include = await confirm({
    message: `He encontrado descripciones en ${DESCRIPTIONS_DIR}/. ¿Incluirlas (en Neo4j y en la vectorización)?`,
    default: true,
  })
  return include ? loadDescriptions() : undefined
}

/** Submenú de proveedor de embeddings: con cuál vectorizar el esquema. */
function askEmbeddingProvider(): Promise<EmbeddingProvider> {
  return select({
    message: '¿Con qué proveedor de embeddings vectorizar?',
    choices: [
      { name: 'OpenAI (nube)', value: EmbeddingProvider.OpenAI },
      { name: 'LM Studio (local)', value: EmbeddingProvider.Local },
    ],
  })
}

/**
 * Aviso de mismatch de modelo + coste/tiempo y confirmación del escaneo COMPLETO.
 * Como el escaneo reconstruye Neo4j y pgvector a la vez, esta confirmación gatea todo
 * el proceso (no solo la vectorización), para que ambos almacenes vayan siempre juntos.
 */
async function confirmScan(provider: EmbeddingProvider, embeddings: IEmbeddings): Promise<boolean> {
  if (provider === EmbeddingProvider.Local) {
    await warnIfLocalModelMissing('embeddings', embeddings.model)
  }

  // Si ya hay un índice con otro modelo/dimensión, aviso de que lo reemplazaré.
  const indexed = await getIndexedModel()
  if (indexed && (indexed.model !== embeddings.model || indexed.dimensions !== embeddings.dimensions)) {
    console.log(
      chalk.yellow(
        `⚠ El índice actual usa ${indexed.model} (${indexed.dimensions} dims) y el modelo activo es ${embeddings.model} (${embeddings.dimensions} dims). Re-vectorizar lo reemplazará por completo.`,
      ),
    )
  }

  console.log(chalk.bold(`\nVectorización del esquema con ${embeddings.model} (${embeddings.dimensions} dims):`))
  if (provider === EmbeddingProvider.OpenAI) {
    console.log(chalk.red('⚠ Usa la API de OpenAI: tiene coste por uso.'))
  }
  console.log(chalk.dim('Tiempo estimado: unos segundos (más en bases de datos grandes).'))

  return confirm({ message: '¿Escanear ahora? (reconstruye Neo4j y el índice vectorial a la vez)', default: true })
}

/** Ejecuta la vectorización ya confirmada y muestra el resultado. Devuelve si tuvo éxito. */
async function executeVectorization(
  target: TargetDatabaseConfig,
  provider: EmbeddingProvider,
  embeddings: IEmbeddings,
  descriptions?: Map<string, string>,
): Promise<boolean> {
  console.log(chalk.dim('Vectorizando el esquema en pgvector...\n'))
  try {
    const summary = await vectorizeSchema(target, provider, embeddings, descriptions)
    console.log(
      chalk.green('✔ Esquema vectorizado:') +
        ` ${summary.count} tablas (${summary.provider}, modelo ${summary.model}, ${summary.dimensions} dims).\n`,
    )
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No he podido vectorizar el esquema.'))
    console.log(chalk.dim('Revisa el proveedor de embeddings (OPENAI_API_KEY o LM Studio) y que pgvector esté disponible.'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
    return false
  }
}
