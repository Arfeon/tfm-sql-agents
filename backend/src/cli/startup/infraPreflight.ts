/**
 * Preflight de infraestructura: antes de arrancar el CLI compruebo que Docker está
 * en marcha y que Postgres y Neo4j están healthy. Si falta algo, guío al usuario
 * paso a paso en vez de soltarle un stack trace de conexión. Pensado para que
 * alguien que no conoce Docker pueda arrancar el proyecto solo con `npm start`.
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import boxen from 'boxen'
import chalk from 'chalk'
import { confirm } from '@inquirer/prompts'

const run = promisify(execFile)

const CONTAINERS = ['graphsql_postgres', 'graphsql_neo4j']

/** El compose vive en la raíz del repo; `npm start` se ejecuta desde backend/. */
function findComposeDir(): string | null {
  const candidates = [path.resolve(process.cwd(), '..'), process.cwd()]
  return candidates.find((dir) => existsSync(path.join(dir, 'docker-compose.yml'))) ?? null
}

async function isDockerRunning(): Promise<boolean> {
  try {
    await run('docker', ['info'])
    return true
  } catch {
    return false
  }
}

/**
 * Estado de cada contenedor como "running healthy", "running starting", "exited unhealthy"...
 * Devuelve null si alguno no existe todavía (docker inspect falla).
 */
async function getContainersState(): Promise<string[] | null> {
  try {
    const { stdout } = await run('docker', [
      'inspect',
      '--format',
      '{{.State.Status}} {{.State.Health.Status}}',
      ...CONTAINERS,
    ])
    return stdout.trim().split(/\r?\n/)
  } catch {
    return null
  }
}

function runComposeUp(composeDir: string): Promise<void> {
  return runCompose(composeDir, ['up', '-d', '--wait', 'postgres', 'neo4j'])
}

function runCompose(composeDir: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], {
      cwd: composeDir,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`docker compose ${args[0]} terminó con código ${code}`))
    })
  })
}

function showReadyBanner(): void {
  const message = [
    chalk.green.bold('✔ Infraestructura lista'),
    '',
    'Postgres y Neo4j están levantados y healthy.',
    chalk.dim('Los contenedores siguen en marcha aunque cierres esta terminal.'),
  ].join('\n')
  console.log(boxen(message, { padding: 1, margin: { top: 1, bottom: 1 }, borderStyle: 'round', borderColor: 'green' }))
}

/**
 * Devuelve true si podemos arrancar la aplicación. Si el usuario decide no seguir
 * (o Docker no está disponible), devuelve false y quien llama sale limpiamente.
 */
export async function ensureInfrastructureReady(): Promise<boolean> {
  // 1. ¿Está el daemon de Docker en marcha?
  while (!(await isDockerRunning())) {
    console.log(chalk.yellow('⚠ Docker no está en marcha (o no está instalado).'))
    console.log(chalk.dim('  Abre Docker Desktop y espera a que el icono diga "Engine running".'))
    console.log(chalk.dim('  Si no lo tienes instalado: https://www.docker.com/products/docker-desktop/'))
    const retry = await confirm({ message: '¿Lo compruebo otra vez?', default: true })
    if (!retry) return false
  }

  // 2. ¿Están los contenedores levantados y healthy?
  const states = await getContainersState()
  if (states?.every((state) => state === 'running healthy')) {
    console.log(chalk.green('✔ Infraestructura lista (Postgres y Neo4j healthy)\n'))
    return true
  }

  const composeDir = findComposeDir()
  if (!composeDir) {
    console.log(chalk.red('✖ No encuentro el docker-compose.yml en la raíz del repo.'))
    console.log(chalk.dim('  ¿Estás ejecutando npm start desde la carpeta backend/ del proyecto?'))
    return false
  }

  if (states === null) {
    console.log(chalk.yellow('⚠ Los contenedores de GraphSQL (Postgres y Neo4j) todavía no existen.'))
  } else {
    console.log(chalk.yellow('⚠ Los contenedores de GraphSQL existen pero no están listos:'))
    CONTAINERS.forEach((name, i) => console.log(chalk.dim(`    ${name}: ${states[i]}`)))
  }

  const create = await confirm({
    message: '¿Los levanto ahora con la configuración por defecto (docker compose up -d --wait)?',
    default: true,
  })
  if (!create) {
    console.log(chalk.dim('\nCuando quieras hacerlo a mano: docker compose up -d --wait (desde la raíz del repo)\n'))
    return false
  }

  // El aviso de tiempo sale de medirlo: ~2 min con las imágenes ya descargadas
  // (crear las BDs y cargar Arcadia y Nebula); la descarga de imágenes se suma
  // solo la primerísima vez y depende de la conexión.
  console.log(chalk.dim('\nLevantando la infraestructura. El primer arranque tarda unos 2-3 minutos'))
  console.log(chalk.dim('(carga las bases de datos de prueba; si además tiene que descargar las'))
  console.log(chalk.dim('imágenes de Docker, algo más). Los siguientes arranques son segundos...\n'))
  try {
    await runComposeUp(composeDir)
  } catch (error) {
    console.log(chalk.red(`\n✖ No pude levantar la infraestructura: ${error instanceof Error ? error.message : String(error)}`))
    if (await isInitIncomplete()) {
      return recoverFromIncompleteInit(composeDir)
    }
    console.log(chalk.dim('  Prueba a mano con `docker compose up` desde la raíz del repo para ver el detalle.'))
    return false
  }

  showReadyBanner()
  return confirm({ message: '¿Arranco GraphSQL?', default: true })
}

/**
 * El caso silencioso que destapó una prueba de usuario: si el PRIMER init de Postgres
 * se interrumpe (Ctrl+C durante la carga de datos), el volumen queda a medias y los
 * scripts no se reintentan nunca — el servidor responde pero las BDs de prueba no
 * existen. Lo delata el marcador que 01-init.sh crea al acabar: si el contenedor
 * corre pero el marcador falta, el init no terminó.
 */
async function isInitIncomplete(): Promise<boolean> {
  try {
    const { stdout } = await run('docker', [
      'exec', 'graphsql_postgres',
      'psql', '-U', 'postgres', '-d', 'graphsql_memory', '-tAc',
      'SELECT 1 FROM setup_init_complete LIMIT 1',
    ])
    return !stdout.includes('1')
  } catch {
    // El contenedor no corre o la BD no existe: también cuenta como init incompleto
    // si el contenedor existe; si ni existe, el flujo normal ya lo cubre.
    const states = await getContainersState()
    return states !== null
  }
}

/** Ofrezco el reset (borra SOLO las BDs de prueba autogeneradas y el índice) y reintento una vez. */
async function recoverFromIncompleteInit(composeDir: string): Promise<boolean> {
  console.log(chalk.yellow('\n⚠ La infraestructura quedó a medio inicializar (probablemente un primer'))
  console.log(chalk.yellow('  arranque interrumpido): el servidor responde pero faltan las bases de prueba.'))
  console.log(chalk.dim('  El init de Postgres solo corre sobre un volumen vacío, así que hay que empezar de cero.'))
  const reset = await confirm({
    message: '¿Reinicio la infraestructura desde cero? (borra y regenera las BDs de prueba; tardará 2-3 min)',
    default: true,
  })
  if (!reset) {
    console.log(chalk.dim('\nCuando quieras hacerlo a mano: docker compose down -v && docker compose up -d --wait\n'))
    return false
  }
  try {
    await runCompose(composeDir, ['down', '-v'])
    await runComposeUp(composeDir)
  } catch (error) {
    console.log(chalk.red(`\n✖ El reinicio también falló: ${error instanceof Error ? error.message : String(error)}`))
    console.log(chalk.dim('  Prueba a mano con `docker compose up` desde la raíz para ver el detalle.'))
    return false
  }
  showReadyBanner()
  return confirm({ message: '¿Arranco GraphSQL?', default: true })
}
