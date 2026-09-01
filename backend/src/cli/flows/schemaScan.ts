/**
 * Flujo de CLI: escanear el esquema de la BD objetivo. Reconstruye Neo4j y pgvector
 * juntos, con la misma decisión de descripciones, para que no queden desincronizados.
 */
import chalk from 'chalk'
import { select, confirm } from '@inquirer/prompts'
import { loadTargetDatabases, targetDatabaseLabel, type TargetDatabaseConfig } from '../../graphsql/infrastructure/config/targetDatabases'
import { ingestSchema } from '../../graphsql/application/scan/schemaIngestion'
import { vectorizeSchema } from '../../graphsql/application/scan/schemaVectorization'
import { updateIndexedDescriptions } from '../../graphsql/application/scan/updateDescriptions'
import { getIndexedModel } from '../../graphsql/application/scan/getIndexedModel'
import { EmbeddingsFactory } from '../../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { EmbeddingProvider } from '../../graphsql/infrastructure/embeddings/EmbeddingProvider'
import { hasDescriptionsFile, loadDescriptions, DESCRIPTIONS_DIR } from '../../graphsql/infrastructure/config/descriptions'
import type { IEmbeddings } from '../../graphsql/domain/ports/IEmbeddings'
import { warnIfGatewayModelMissing, warnIfLocalModelMissing, withSpinner } from '../ui'

export async function runSchemaScan(): Promise<void> {
  const targets = loadTargetDatabases()

  const target = await select({
    message: 'Elige la base de datos objetivo a escanear',
    choices: targets.map((t) => ({ name: targetDatabaseLabel(t), value: t })),
  })

  // SPEC-29: si ya hay índice de ESTA BD y fichero de descripciones, ofrezco el modo
  // incremental — re-vectorizar solo las descripciones que cambiaron, sin tocar el resto.
  if (await incrementalUpdateApplies(target)) {
    const mode = await select({
      message: '¿Qué tipo de escaneo?',
      choices: [
        {
          name: 'Solo actualizar descripciones (re-vectoriza únicamente lo que cambió)',
          value: 'descriptions' as const,
        },
        {
          name: 'Escaneo completo (reconstruye Neo4j y el índice; necesario si cambió el esquema)',
          value: 'full' as const,
        },
      ],
    })
    if (mode === 'descriptions') {
      await runDescriptionsUpdate(target)
      return
    }
  }

  const descriptions = await askDescriptions()
  const embeddingProvider = await askEmbeddingProvider()
  const embeddings = EmbeddingsFactory.create(embeddingProvider)

  const confirmed = await confirmScan(embeddingProvider, embeddings)
  if (!confirmed) {
    console.log(chalk.dim('\nEscaneo cancelado: no se ha tocado ni Neo4j ni el índice vectorial.\n'))
    return
  }

  try {
    const summary = await withSpinner(`Escaneando "${targetDatabaseLabel(target)}" e ingiriendo en Neo4j…`, () =>
      ingestSchema(target, descriptions),
    )
    console.log(
      chalk.dim(`  ${summary.tables} tablas, ${summary.columns} columnas, ${summary.relationships} relaciones en Neo4j.\n`),
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

/** El modo incremental solo tiene sentido con índice de ESTA BD y fichero de descripciones. */
async function incrementalUpdateApplies(target: TargetDatabaseConfig): Promise<boolean> {
  if (!hasDescriptionsFile()) {
    return false
  }
  const indexed = await getIndexedModel().catch(() => null)
  return indexed?.targetName === target.name
}

/** Actualización incremental (SPEC-29): diff contra lo indexado y re-embebido solo de lo afectado. */
async function runDescriptionsUpdate(target: TargetDatabaseConfig): Promise<void> {
  try {
    const summary = await withSpinner(`Actualizando descripciones de "${target.name}" (solo lo que cambió)…`, () =>
      updateIndexedDescriptions(target, loadDescriptions()),
    )
    const { added, changed, removed, unknown } = summary.diff
    if (summary.embedded === 0) {
      console.log(chalk.dim('  Sin cambios: ninguna descripción difiere de lo indexado. 0 embeddings gastados.\n'))
      return
    }
    console.log(
      chalk.dim(
        `  ${added.length} nuevas, ${changed.length} modificadas, ${removed.length} eliminadas → ` +
          `${summary.embedded} embeddings de ${summary.totalIndexed} tablas (modelo ${summary.model}).\n`,
      ),
    )
    if (unknown.length > 0) {
      console.log(chalk.dim(`  Ignoradas ${unknown.length} descripciones sin tabla en el índice (¿de otra BD?).\n`))
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No pude actualizar las descripciones.'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
  }
}

/** Compartida con el escaneo inline del guardián de índice (targetSelection): misma pregunta en los dos sitios. */
export async function askDescriptions(): Promise<Map<string, string> | undefined> {
  if (!hasDescriptionsFile()) {
    return undefined
  }
  const include = await confirm({
    message: `He encontrado descripciones en ${DESCRIPTIONS_DIR}/. ¿Incluirlas (en Neo4j y en la vectorización)?`,
    default: true,
  })
  return include ? loadDescriptions() : undefined
}

function askEmbeddingProvider(): Promise<EmbeddingProvider> {
  return select({
    message: '¿Con qué proveedor de embeddings vectorizar?',
    choices: [
      { name: 'OpenAI (nube)', value: EmbeddingProvider.OpenAI },
      { name: 'LM Studio (local)', value: EmbeddingProvider.Local },
      { name: 'Gateway corporativo', value: EmbeddingProvider.Gateway },
    ],
  })
}

/** Esta confirmación gatea el escaneo completo (Neo4j y pgvector van siempre juntos). */
async function confirmScan(provider: EmbeddingProvider, embeddings: IEmbeddings): Promise<boolean> {
  if (provider === EmbeddingProvider.Local) {
    await warnIfLocalModelMissing('embeddings', embeddings.model)
  }
  if (provider === EmbeddingProvider.Gateway) {
    await warnIfGatewayModelMissing('embeddings', embeddings.model)
  }

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

async function executeVectorization(
  target: TargetDatabaseConfig,
  provider: EmbeddingProvider,
  embeddings: IEmbeddings,
  descriptions?: Map<string, string>,
): Promise<boolean> {
  try {
    const summary = await withSpinner('Vectorizando el esquema en pgvector…', () =>
      vectorizeSchema(target, provider, embeddings, descriptions),
    )
    console.log(
      chalk.dim(`  ${summary.count} tablas vectorizadas (${summary.provider}, modelo ${summary.model}, ${summary.dimensions} dims).\n`),
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
