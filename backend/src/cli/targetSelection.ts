/**
 * Selección de la BD objetivo al consultar (SPEC-18). Neo4j/pgvector son de un solo
 * inquilino (el índice es de la última BD escaneada), así que si eliges una no
 * indexada aviso y ofrezco escanearla ahí mismo — nunca sigo con el índice de otra BD.
 */
import chalk from 'chalk'
import { select, confirm } from '@inquirer/prompts'
import { loadTargetDatabases, targetDatabaseLabel, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { getIndexedModel } from '../graphsql/application/getIndexedModel'
import { ingestSchema } from '../graphsql/application/schemaIngestion'
import { vectorizeSchema } from '../graphsql/application/schemaVectorization'
import { EmbeddingsFactory } from '../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { hasDescriptionsFile, loadDescriptions } from '../graphsql/infrastructure/config/descriptions'
import { withSpinner } from './ui'

/** `null` = cancelado o índice sin preparar: quien llama vuelve al menú. */
export async function chooseTargetForQuery(): Promise<TargetDatabaseConfig | null> {
  const targets = loadTargetDatabases()
  if (targets.length === 1) {
    return targets[0]
  }

  const indexedName = await readIndexedTargetName()
  const target = await select({
    message: '¿Sobre qué base de datos quieres preguntar?',
    choices: targets.map((t) => ({
      name: t.name === indexedName ? `${targetDatabaseLabel(t)} ${chalk.green('(indexada)')}` : targetDatabaseLabel(t),
      value: t,
    })),
  })

  if (target.name === indexedName) {
    return target
  }
  return resolveIndexMismatch(target, indexedName)
}

/** La BD de la que es el índice actual: su nombre, o null si no hay índice o no se sabe. */
async function readIndexedTargetName(): Promise<string | null> {
  try {
    const indexed = await getIndexedModel()
    return indexed?.targetName ?? null
  } catch {
    // Sin acceso a pgvector no puedo saberlo; lo trato como desconocido y avisará el guardián.
    return null
  }
}

/**
 * La BD elegida no es la indexada: aviso y ofrezco escanearla ahí mismo. Si el índice
 * es de una BD desconocida (anterior a SPEC-18 o ilegible), lo digo tal cual.
 */
async function resolveIndexMismatch(target: TargetDatabaseConfig, indexedName: string | null): Promise<TargetDatabaseConfig | null> {
  if (indexedName) {
    console.log(chalk.yellow(`\n⚠ El índice actual es de "${indexedName}", no de "${target.name}": la recuperación devolvería tablas de otra BD.`))
  } else {
    console.log(chalk.yellow(`\n⚠ No sé de qué BD es el índice actual (puede que no exista o sea antiguo): si no es de "${target.name}", la recuperación fallará.`))
  }

  const scanNow = await confirm({ message: `¿Escaneo "${target.name}" ahora? (reconstruye Neo4j y el índice vectorial)`, default: true })
  if (!scanNow) {
    console.log(chalk.dim('Consulta cancelada: puedes escanearla desde el menú → "Escanear el esquema".\n'))
    return null
  }
  const scanned = await scanTargetWithIndexedModel(target)
  return scanned ? target : null
}

/**
 * Escaneo la BD con el MISMO modelo de embeddings del índice actual (no pregunto
 * proveedor: mezclar modelos en el índice no tiene sentido). Las descripciones se
 * incluyen si el fichero existe y es la BD principal (las descripciones son suyas).
 */
async function scanTargetWithIndexedModel(target: TargetDatabaseConfig): Promise<boolean> {
  const indexed = await getIndexedModel().catch(() => null)
  if (!indexed) {
    console.log(chalk.red('\n⚠ No hay ningún índice del que tomar el modelo de embeddings.'))
    console.log(chalk.dim('Escanea primero desde el menú → "Escanear el esquema" (ahí eliges proveedor).\n'))
    return false
  }
  const isPrimaryTarget = loadTargetDatabases()[0].name === target.name
  const descriptions = isPrimaryTarget && hasDescriptionsFile() ? loadDescriptions() : undefined
  const embeddings = EmbeddingsFactory.forIndexedModel(indexed)
  try {
    await withSpinner(`Escaneando "${target.name}" (ingesta + vectorización con ${indexed.model})…`, async () => {
      await ingestSchema(target, descriptions)
      await vectorizeSchema(target, indexed.provider, embeddings, descriptions)
    })
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No pude escanear la BD elegida.'))
    console.log(chalk.dim(`¿Están Docker y el proveedor de embeddings disponibles? Detalle: ${detail}\n`))
    return false
  }
}
