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
import ora from 'ora'
import { confirm, select } from '@inquirer/prompts'
import { PROJECT_ROOT } from '../../graphsql/infrastructure/config/projectRoot'
import { loadEnv } from '../../graphsql/infrastructure/config/env'

const run = promisify(execFile)

const CONTAINERS = ['graphsql_postgres', 'graphsql_neo4j']

/** Cadencia del sondeo del init y ventana de estancamiento (sin progreso = atascado). */
const POLL_INTERVAL_MS = 4000
const STALL_WINDOW_MS = 120_000
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Resultado de esperar a la infraestructura, midiendo actividad y no tiempo total. */
type WaitOutcome = 'ready' | 'dirty' | 'stalled'

/** El compose vive en la raíz del repo, resuelta desde el código (el CLI puede arrancar desde cualquier carpeta). */
function findComposeDir(): string | null {
  return existsSync(path.join(PROJECT_ROOT, 'docker-compose.yml')) ? PROJECT_ROOT : null
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

/** Cola del log de un contenedor (stdout+stderr juntos); cadena vacía si no puedo leerlo. */
async function getLogTail(container: string, lines: number): Promise<string> {
  try {
    const { stdout, stderr } = await run('docker', ['logs', '--tail', String(lines), container])
    return `${stdout}\n${stderr}`
  } catch {
    return ''
  }
}

/** La última línea con contenido del log, recortada para caber en el spinner. */
function lastLogLine(logTail: string): string {
  const lines = logTail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1] ?? ''
  return last.length > 90 ? `${last.slice(0, 87)}...` : last
}

function formatElapsed(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
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
  // 0. Cuando el propio CLI corre DENTRO de un contenedor (la demo Docker), no hay
  // CLI de docker con el que comprobar ni levantar nada: la infraestructura la
  // garantiza compose con `depends_on: service_healthy` antes de arrancar este proceso.
  if (loadEnv().GRAPHSQL_SKIP_INFRA_PREFLIGHT) {
    console.log(chalk.dim('Preflight de infraestructura omitido (GRAPHSQL_SKIP_INFRA_PREFLIGHT=true): la gestiona docker compose.\n'))
    return true
  }

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
    // "Healthy" no basta si el contenedor es anterior al marcador de init (SPEC-28):
    // su healthcheck viejo no lo exige, así que lo compruebo aquí también.
    if ((await checkInitMarker()) !== 'present') {
      const composeDir = findComposeDir()
      if (!composeDir) return false
      if (!(await recoverFromIncompleteInit(composeDir))) return false
      showReadyBanner()
      return confirmLaunch()
    }
    console.log(chalk.green('✔ Infraestructura lista (Postgres y Neo4j healthy)\n'))
    return true
  }

  const composeDir = findComposeDir()
  if (!composeDir) {
    console.log(chalk.red('✖ No encuentro el docker-compose.yml en la raíz del repo.'))
    console.log(chalk.dim(`  Esperaba encontrarlo en ${PROJECT_ROOT}; forma parte del repo, restáuralo si lo borraste.`))
    return false
  }

  if (states === null) {
    console.log(chalk.yellow('⚠ Los contenedores de GraphSQL (Postgres y Neo4j) todavía no existen.'))
  } else {
    // Atajo del caso "volumen a medias": si Postgres ya se saltó el init y el propio
    // servidor responde que el marcador no existe, esperar no sirve de nada (los
    // scripts no se reintentan nunca). Mejor diagnosticarlo ya y ofrecer el reset.
    if ((await checkInitMarker()) === 'missing' && (await initWasSkippedOnDirtyVolume())) {
      if (!(await recoverFromIncompleteInit(composeDir))) return false
      showReadyBanner()
      return confirmLaunch()
    }
    console.log(chalk.yellow('⚠ Los contenedores de GraphSQL existen pero no están listos:'))
    CONTAINERS.forEach((name, i) => console.log(chalk.dim(`    ${name}: ${states[i]}`)))
  }

  const create = await confirm({
    message: '¿Los levanto ahora con la configuración por defecto (docker compose up -d)?',
    default: true,
  })
  if (!create) {
    console.log(chalk.dim('\nCuando quieras hacerlo a mano: docker compose up -d --wait (desde la raíz del repo)\n'))
    return false
  }

  // El tiempo del primer arranque depende mucho del equipo: ~2-3 min en uno normal,
  // bastante más en portátiles modestos o con Docker sobre WSL recién arrancado.
  // Por eso no pongo un timeout fijo: muestro el progreso y solo doy error si se para.
  console.log(chalk.dim('\nLevantando la infraestructura. El primer arranque carga las bases de datos'))
  console.log(chalk.dim('de prueba: unos 2-3 minutos en un equipo normal, bastante más en equipos'))
  console.log(chalk.dim('modestos (y la primerísima vez se suma la descarga de las imágenes de Docker).'))
  console.log(chalk.dim('Mientras haya actividad sigo esperando; los siguientes arranques son segundos.\n'))

  if (!(await bringUpAndWait(composeDir))) return false
  showReadyBanner()
  return confirmLaunch()
}

function confirmLaunch(): Promise<boolean> {
  return confirm({ message: '¿Arranco GraphSQL?', default: true })
}

/**
 * Levanta los contenedores y espera a que estén healthy vigilando ACTIVIDAD, no tiempo
 * total. Antes usaba `up --wait`, que depende del start_period fijo del healthcheck
 * (300s): en equipos lentos daba error con Postgres todavía insertando datos sin
 * problema. Ahora, mientras el log siga cambiando, sigo esperando; si se estanca,
 * enseño el log y dejo elegir entre seguir esperando, resetear o salir.
 */
async function bringUpAndWait(composeDir: string): Promise<boolean> {
  try {
    await runCompose(composeDir, ['up', '-d', 'postgres', 'neo4j'])
  } catch (error) {
    console.log(chalk.red(`\n✖ No pude levantar la infraestructura: ${error instanceof Error ? error.message : String(error)}`))
    console.log(chalk.dim('  Prueba a mano con `docker compose up` desde la raíz del repo para ver el detalle.'))
    return false
  }

  while (true) {
    const outcome = await waitForHealthyWatchingActivity()
    if (outcome === 'ready') return true
    if (outcome === 'dirty') return recoverFromIncompleteInit(composeDir)

    // Estancado: nada nuevo en el log en toda la ventana. Enseño lo último que
    // escribió Postgres para que el usuario juzgue, y le dejo decidir.
    await showStallDiagnostics()
    const choice = await select({
      message: '¿Qué hago?',
      choices: [
        { value: 'wait', name: 'Seguir esperando (le doy otra ventana de margen)' },
        { value: 'reset', name: 'Reiniciar desde cero (borra y regenera las BDs de prueba)' },
        { value: 'quit', name: 'Salir y mirarlo a mano' },
      ],
    })
    if (choice === 'wait') continue
    if (choice === 'reset') return resetInfrastructure(composeDir)
    console.log(chalk.dim('\nPara ver el init en directo: docker logs -f graphsql_postgres'))
    console.log(chalk.dim('Para empezar de cero: docker compose down -v && docker compose up -d --wait\n'))
    return false
  }
}

/**
 * Sondea los contenedores cada POLL_INTERVAL_MS hasta que estén healthy. La señal de
 * vida es el log: la carga de datos imprime los contadores a medida que crecen, así
 * que "el log cambia" significa "el init avanza". Solo devuelvo 'stalled' si el log
 * no cambia en STALL_WINDOW_MS, y 'dirty' si detecto el volumen a medias (init
 * saltado sin marcador), donde esperar no arregla nada.
 */
async function waitForHealthyWatchingActivity(): Promise<WaitOutcome> {
  const startedAt = Date.now()
  let lastActivityAt = Date.now()
  let previousLogs = ''
  const spinner = ora('Esperando a que Postgres y Neo4j estén healthy...').start()
  try {
    while (true) {
      await delay(POLL_INTERVAL_MS)

      const states = await getContainersState()
      if (states?.every((state) => state === 'running healthy')) {
        spinner.succeed(`Postgres y Neo4j healthy (${formatElapsed(Date.now() - startedAt)}).`)
        return 'ready'
      }

      if ((await checkInitMarker()) === 'missing' && (await initWasSkippedOnDirtyVolume())) {
        spinner.stop()
        return 'dirty'
      }

      // Actividad = cualquier cambio en los logs de los dos contenedores.
      const logs = (await getLogTail('graphsql_postgres', 30)) + (await getLogTail('graphsql_neo4j', 10))
      if (logs !== previousLogs) {
        previousLogs = logs
        lastActivityAt = Date.now()
      }

      const pending = states
        ? CONTAINERS.filter((_, i) => states[i] !== 'running healthy').join(', ')
        : CONTAINERS.join(', ')
      const progress = lastLogLine(await getLogTail('graphsql_postgres', 3))
      spinner.text = `Esperando a ${pending} (${formatElapsed(Date.now() - startedAt)})\n  ${chalk.dim(progress)}`

      if (Date.now() - lastActivityAt > STALL_WINDOW_MS) {
        spinner.stop()
        return 'stalled'
      }
    }
  } catch (error) {
    spinner.stop()
    throw error
  }
}

/** Cuando el init se estanca, enseño la cola del log de Postgres antes de preguntar. */
async function showStallDiagnostics(): Promise<void> {
  const minutes = Math.round(STALL_WINDOW_MS / 60_000)
  console.log(chalk.yellow(`\n⚠ Llevo ${minutes} minutos sin ver actividad nueva en el init.`))
  console.log(chalk.dim('  Últimas líneas del log de Postgres (docker logs graphsql_postgres):\n'))
  const tail = await getLogTail('graphsql_postgres', 8)
  tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => console.log(chalk.dim(`    ${line}`)))
  console.log('')
}

/**
 * El caso silencioso que destapó una prueba de usuario: si el PRIMER init de Postgres
 * se interrumpe (Ctrl+C durante la carga de datos), el volumen queda a medias y los
 * scripts no se reintentan nunca — el servidor responde pero las BDs de prueba no
 * existen. Lo delata el marcador que 01-init.sh crea al acabar: si el contenedor
 * corre pero el marcador falta, el init no terminó.
 *
 * Distingo tres respuestas porque significan cosas distintas: 'missing' es el
 * servidor RESPONDIENDO que el marcador no existe (señal fiable de init a medias);
 * 'unknown' es que no pude preguntar (contenedor parado o servidor aún arrancando),
 * que NO debe tratarse como volumen sucio — sus logs también dicen "Skipping
 * initialization" en cualquier arranque normal posterior al init.
 */
type InitMarker = 'present' | 'missing' | 'unknown'

async function checkInitMarker(): Promise<InitMarker> {
  try {
    // to_regclass devuelve NULL si la tabla no existe: pregunta sin ensuciar el log
    // de Postgres con ERRORs (a diferencia de un SELECT directo sobre la tabla).
    const { stdout } = await run('docker', [
      'exec', 'graphsql_postgres',
      'psql', '-U', 'postgres', '-d', 'graphsql_memory', '-tAc',
      "SELECT to_regclass('public.setup_init_complete') IS NOT NULL",
    ])
    return stdout.includes('t') ? 'present' : 'missing'
  } catch {
    return 'unknown'
  }
}

/**
 * La firma inequívoca del volumen sucio: Postgres dice "Skipping initialization" cuando
 * el volumen NO está vacío (un init anterior interrumpido). Distingue este caso de un
 * primer init legítimo EN CURSO (que diría "will be initialized"), donde el marcador
 * tampoco existe aún pero no hay que tocar nada.
 */
async function initWasSkippedOnDirtyVolume(): Promise<boolean> {
  const logs = await getLogTail('graphsql_postgres', 300)
  return logs.includes('Skipping initialization')
}

/** Ofrezco el reset (borra SOLO las BDs de prueba autogeneradas y el índice) y reintento. */
async function recoverFromIncompleteInit(composeDir: string): Promise<boolean> {
  console.log(chalk.yellow('\n⚠ La infraestructura quedó a medio inicializar (un primer arranque interrumpido)'))
  console.log(chalk.yellow('  o viene de una versión anterior: el servidor responde pero falta el marcador de init.'))
  console.log(chalk.dim('  El init de Postgres solo corre sobre un volumen vacío, así que hay que empezar de cero.'))
  const reset = await confirm({
    message: '¿Reinicio la infraestructura desde cero? (borra y regenera las BDs de prueba; tardará unos minutos)',
    default: true,
  })
  if (!reset) {
    console.log(chalk.dim('\nCuando quieras hacerlo a mano: docker compose down -v && docker compose up -d --wait\n'))
    return false
  }
  return resetInfrastructure(composeDir)
}

/** Borra los volúmenes y vuelve a levantar, con la misma espera vigilando actividad. */
async function resetInfrastructure(composeDir: string): Promise<boolean> {
  try {
    await runCompose(composeDir, ['down', '-v'])
  } catch (error) {
    console.log(chalk.red(`\n✖ No pude parar la infraestructura: ${error instanceof Error ? error.message : String(error)}`))
    console.log(chalk.dim('  Prueba a mano con `docker compose down -v` desde la raíz para ver el detalle.'))
    return false
  }
  return bringUpAndWait(composeDir)
}
