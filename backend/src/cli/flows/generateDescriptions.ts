/**
 * Flujo de CLI: generar descripciones de tabla con IA para una BD objetivo. Manda al
 * modelo de razonamiento el nombre y las columnas de cada tabla y, si se autoriza, una
 * muestra de sus primeras filas; escribe el resultado en `descriptions/<bd>.json`, que
 * el escaneo ya sabe incluir en Neo4j y en la vectorización.
 *
 * Privacidad: la muestra de filas es dato REAL. Con un LLM local no sale de la máquina,
 * así que se incluye sin fricción. Con un LLM remoto (OpenAI) exijo un consentimiento
 * explícito antes de enviarla; si no se da, ofrezco generar solo con nombre y columnas.
 */
import { existsSync } from 'node:fs'
import chalk from 'chalk'
import ora from 'ora'
import { confirm, input, select } from '@inquirer/prompts'
import { loadTargetDatabases, targetDatabaseLabel } from '../../graphsql/infrastructure/config/targetDatabases'
import { LlmProvider } from '../../graphsql/infrastructure/llm/LlmProvider'
import { resolveModelName } from '../../graphsql/infrastructure/llm/modelSelection'
import { providerLabel, resolveDefaultProvider } from '../startup/providerSelection'
import {
  descriptionsFilePathFor,
  saveDescriptions,
} from '../../graphsql/infrastructure/config/descriptions'
import {
  generateDescriptions,
  defaultGenerateDescriptionsDependencies,
} from '../../graphsql/application/scan/generateDescriptions'
import { warnIfLocalModelMissing } from '../ui'
import { runSchemaScan } from './schemaScan'

/** Las primeras filas que se muestrean por tabla (el "SELECT top 10" de la petición). */
const SAMPLE_SIZE = 10

/**
 * Enviar una MUESTRA de filas a un LLM remoto exige consentimiento explícito: son datos
 * reales que salen de la máquina. Con LLM local no aplica (los datos no se van a ningún
 * sitio). Función pura para poder probar la regla sin terminal.
 */
export function requiresRemoteDataConsent(provider: LlmProvider, includeSamples: boolean): boolean {
  return includeSamples && provider === LlmProvider.OpenAI
}

export async function runGenerateDescriptions(): Promise<void> {
  const targets = loadTargetDatabases()
  const target = await select({
    message: 'Elige la base de datos objetivo a describir',
    choices: targets.map((t) => ({ name: targetDatabaseLabel(t), value: t })),
  })

  const provider = resolveDefaultProvider(process.env.LLM_PROVIDER)
  const model = resolveModelName(provider, 'reasoning')

  const includeSamples = await decideSampleInclusion(provider)
  if (includeSamples === 'cancel') {
    console.log(chalk.dim('\nCancelado: no se ha generado ninguna descripción.\n'))
    return
  }

  // Contexto de negocio opcional: una frase que orienta al "analista" sobre de qué va la
  // BD (dominio, tipo de negocio). Ayuda cuando los nombres de tabla son opacos.
  const businessContext = (
    await input({ message: 'Contexto de negocio para orientar a la IA (opcional, Enter para omitir):', default: '' })
  ).trim()

  console.log(
    chalk.bold(
      `\nGeneraré una descripción por tabla con el modelo de razonamiento ${model} (${providerLabel(provider)}).`,
    ),
  )
  console.log(
    chalk.dim(
      includeSamples === 'include'
        ? `Incluyo una muestra de ${SAMPLE_SIZE} fila(s) por tabla para orientar al modelo.`
        : 'Solo con el nombre y las columnas de cada tabla (sin datos de filas).',
    ),
  )
  if (provider === LlmProvider.Local) {
    await warnIfLocalModelMissing('chat', model)
  } else {
    console.log(chalk.red('⚠ Usa la API de OpenAI: hay coste por uso (una llamada por tabla).'))
  }

  const filePath = descriptionsFilePathFor(target.name)
  if (existsSync(filePath) && !(await confirm({ message: `Ya existe ${filePath}. ¿Sobrescribirlo?`, default: true }))) {
    console.log(chalk.dim('\nCancelado: no se ha tocado el fichero existente.\n'))
    return
  }
  if (!(await confirm({ message: `¿Generar descripciones de "${target.name}" ahora?`, default: true }))) {
    return
  }

  const spinner = ora('Generando descripciones…').start()
  try {
    const results = await generateDescriptions(
      target,
      { includeSamples: includeSamples === 'include', sampleSize: SAMPLE_SIZE, businessContext },
      {
        ...defaultGenerateDescriptionsDependencies,
        onProgress: (done, total, tableName) => {
          spinner.text = `Generando descripciones ${done}/${total} — ${tableName}`
        },
      },
    )
    const saved = saveDescriptions(results, filePath)
    spinner.succeed(`${saved} descripciones escritas en ${filePath}`)
    console.log(
      chalk.dim('Revísalas o edítalas si quieres; el escaneo las incluye en Neo4j y en la vectorización.\n'),
    )

    // Puente al escaneo: aún no están vectorizadas. Ofrezco lanzarlo ya para no dejar
    // el paso a medias, pero sigue siendo el flujo de escaneo de siempre (elige proveedor
    // de embeddings, ofrece la actualización incremental si ya había índice, etc.).
    if (await confirm({ message: '¿Escanear ahora para vectorizar estas descripciones?', default: true })) {
      await runSchemaScan()
    }
  } catch (error) {
    spinner.fail('No pude generar las descripciones.')
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.dim(`Revisa el proveedor de LLM y que la BD objetivo esté accesible.\nDetalle: ${detail}\n`))
  }
}

/** '¿incluir muestra?' con el guardarraíl de privacidad. Devuelve la decisión ya resuelta. */
async function decideSampleInclusion(provider: LlmProvider): Promise<'include' | 'schema-only' | 'cancel'> {
  const wantsSamples = await confirm({
    message: '¿Incluir una muestra de las primeras filas de cada tabla para que la IA infiera mejor el contenido?',
    default: provider === LlmProvider.Local,
  })
  if (!wantsSamples) {
    return 'schema-only'
  }
  if (!requiresRemoteDataConsent(provider, true)) {
    return 'include' // LLM local: la muestra no sale de la máquina.
  }

  // LLM remoto: aviso explícito antes de enviar datos reales fuera.
  console.log(chalk.red.bold('\n⚠ AVISO DE PRIVACIDAD'))
  console.log(
    chalk.yellow(
      `Se enviarán las primeras ${SAMPLE_SIZE} filas de CADA tabla a un LLM externo (${providerLabel(provider)}).`,
    ),
  )
  console.log(chalk.dim('Son datos reales de la BD. Revisa tu política de protección de datos antes de continuar.'))
  const consent = await confirm({
    message: `¿Autorizas enviar esas filas a ${providerLabel(provider)}?`,
    default: false,
  })
  if (consent) {
    return 'include'
  }

  const schemaOnly = await confirm({
    message: 'Entendido. ¿Genero las descripciones solo con el nombre y las columnas (sin enviar datos de filas)?',
    default: true,
  })
  return schemaOnly ? 'schema-only' : 'cancel'
}
