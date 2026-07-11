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
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'neo4j'], {
      cwd: composeDir,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`docker compose up terminó con código ${code}`))
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
    console.log(chalk.dim('  Prueba a mano con `docker compose up` desde la raíz del repo para ver el detalle.'))
    return false
  }

  showReadyBanner()
  return confirm({ message: '¿Arranco GraphSQL?', default: true })
}
