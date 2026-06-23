/**
 * Generador reproducible de datos de prueba para la BD Arcadia.
 *
 * Plataforma de suscripción de videojuegos ("Netflix de videojuegos").
 * Volumen MEDIO. Datos 100% sintéticos.
 *
 * Uso
 * ---
 *   # 1. Crear el esquema (usuario con permisos DDL):
 *   psql "$TARGET_DB" -f schema.sql
 *
 *   # 2. Poblar (desde el directorio backend/):
 *   npm run seed                  # usa variables de entorno (.env)
 *   npm run seed -- --reset       # ejecuta schema.sql antes de poblar
 *   npm run seed -- --truncate    # vacía las tablas antes de poblar
 *
 * Conexión
 * --------
 * Lee la conexión de las variables TARGET_DB_* del .env (valores por defecto
 * de PostgreSQL local). Sobreescribible con TARGET_DB_CONNECTION_STRING.
 *
 * Reproducibilidad
 * ----------------
 * SeededRandom(SEED) + faker.seed(SEED). Misma SEED → mismos datos byte a byte.
 *
 * Dependencias: pg, @faker-js/faker, seedrandom, dotenv.
 */
import { Client } from 'pg'
import { faker } from '@faker-js/faker'
import seedrandom from 'seedrandom'
import { readFileSync } from 'fs'
import { join } from 'path'
import 'dotenv/config'

// ---------------------------------------------------------------------------
// PRNG reproducible
// ---------------------------------------------------------------------------
class SeededRandom {
  private rng: () => number

  constructor(seed: number | string) {
    this.rng = seedrandom(String(seed))
  }

  random(): number {
    return this.rng()
  }

  randint(a: number, b: number): number {
    return Math.floor(this.rng() * (b - a + 1)) + a
  }

  uniform(a: number, b: number): number {
    return this.rng() * (b - a) + a
  }

  choice<T>(array: T[]): T {
    return array[Math.floor(this.rng() * array.length)]
  }

  choices<T>(array: T[], weights?: number[]): T {
    if (!weights) return this.choice(array)
    const total = weights.reduce((acc, w) => acc + w, 0)
    let rand = this.rng() * total
    for (let i = 0; i < array.length; i++) {
      rand -= weights[i]
      if (rand <= 0) return array[i]
    }
    return array[array.length - 1]
  }

  sample<T>(array: T[], k: number): T[] {
    const copy = [...array]
    const result: T[] = []
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(this.rng() * (copy.length - i))
      result.push(copy[idx])
      copy[idx] = copy[copy.length - i - 1]
    }
    return result
  }

  paretovariate(alpha: number): number {
    return 1 / Math.pow(this.rng(), 1 / alpha)
  }
}

// ---------------------------------------------------------------------------
// Configuración de reproducibilidad y volumen (MEDIO)
// ---------------------------------------------------------------------------
const SEED = 42

const N_COMPANIES = 60
const N_FRANCHISES = 45
const N_GAMES = 320
const N_CUSTOMERS = 5_000
const N_SESSIONS = 80_000
const N_RATINGS = 16_000
const N_SNAPSHOTS = 55_000

// Ventana temporal de la telemetría
const DATA_START = new Date(2023, 0, 1)
const DATA_END = new Date(2026, 5, 1)
const TODAY = new Date(2026, 5, 22)

// ---------------------------------------------------------------------------
// Catálogos fijos
// ---------------------------------------------------------------------------
const GENRES = [
  'Action', 'Adventure', 'RPG', 'Strategy', 'Simulation', 'Sports',
  'Racing', 'Puzzle', 'Shooter', 'Platformer', 'Horror', 'Fighting',
]

const PLATFORMS: [string, string, string][] = [
  ['Nexus PC', 'Open Hardware', 'pc'],
  ['Volt Station 5', 'Voltic', 'console'],
  ['Volt Station 4', 'Voltic', 'console'],
  ['Krys Box X', 'Krystal', 'console'],
  ['Krys Box S', 'Krystal', 'console'],
  ['Lumen Switch', 'Lumen', 'handheld'],
  ['Arcadia Cloud', 'Arcadia', 'cloud'],
  ['Photon Mobile', 'Photon', 'handheld'],
]

const REGIONS: [string, string][] = [
  ['North America', 'USD'],
  ['Europe', 'EUR'],
  ['LATAM', 'USD'],
  ['Asia Pacific', 'USD'],
  ['Middle East & Africa', 'USD'],
  ['Oceania', 'AUD'],
]

const PLANS: [string, number, number, boolean][] = [
  ['Basic', 6.99, 1, false],
  ['Standard', 11.99, 2, false],
  ['Premium', 16.99, 4, true],
]

const AGE_RATINGS = ['E', 'E10', 'T', 'M']

const TITLE_ADJ = [
  'Shadow', 'Crimson', 'Eternal', 'Frozen', 'Hollow', 'Radiant', 'Savage',
  'Silent', 'Broken', 'Golden', 'Iron', 'Lost', 'Rising', 'Dark', 'Wild',
  'Stellar', 'Phantom', 'Ancient', 'Neon', 'Fallen', 'Storm', 'Crystal',
]
const TITLE_NOUN = [
  'Realm', 'Horizon', 'Legacy', 'Dominion', 'Odyssey', 'Saga', 'Empire',
  'Frontier', 'Covenant', 'Requiem', 'Ascension', 'Exodus', 'Citadel',
  'Vanguard', 'Reckoning', 'Echoes', 'Tides', 'Oath', 'Vortex', 'Sanctum',
]
const COMPANY_STEM = [
  'Pixel', 'Nova', 'Vertex', 'Quantum', 'Ember', 'Cobalt', 'Lunar', 'Apex',
  'Hyper', 'Onyx', 'Zenith', 'Tidal', 'Forge', 'Specter', 'Arc', 'Helix',
  'Titan', 'Nimbus', 'Glacier', 'Raven', 'Solstice', 'Vector', 'Mirage',
]
const COMPANY_SUFFIX = ['Studios', 'Games', 'Interactive', 'Entertainment', 'Works', 'Forge']
const DLC_KIND = [
  'Expansion', 'Season Pass', 'Character Pack', 'Map Pack', 'Story DLC',
  'Cosmetic Bundle', 'Soundtrack', 'Booster Pack',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomDate(start: Date, end: Date, rng: SeededRandom): Date {
  const deltaMs = end.getTime() - start.getTime()
  return new Date(start.getTime() + Math.floor(rng.random() * (deltaMs + 1)))
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b
}

async function batchInsert(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][],
  options: { returning?: string } = {}
): Promise<number[]> {
  if (rows.length === 0) return []

  const BATCH_SIZE = 500
  const results: number[] = []

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const colCount = columns.length
    const placeholders = batch
      .map((_, rowIdx) =>
        `(${columns.map((_, colIdx) => `$${rowIdx * colCount + colIdx + 1}`).join(', ')})`
      )
      .join(', ')
    const values = batch.flat()
    const returningClause = options.returning ? ` RETURNING ${options.returning}` : ''
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}${returningClause}`
    const result = await client.query(sql, values)
    if (options.returning) {
      const key = options.returning
      results.push(...(result.rows as Record<string, unknown>[]).map(row => row[key] as number))
    }
  }

  return results
}

function connect(): Client {
  const connectionString = process.env.TARGET_DB_CONNECTION_STRING
  if (connectionString) {
    return new Client({ connectionString })
  }
  return new Client({
    host: process.env.TARGET_DB_HOST ?? 'localhost',
    port: parseInt(process.env.TARGET_DB_PORT ?? '5432'),
    database: process.env.TARGET_DB_NAME ?? 'arcadia',
    user: process.env.TARGET_DB_USER ?? 'postgres',
    password: process.env.TARGET_DB_PASSWORD ?? 'postgres',
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const RESET = args.includes('--reset')
  const TRUNCATE = args.includes('--truncate')

  const rng = new SeededRandom(SEED)
  faker.seed(SEED)

  const client = connect()
  await client.connect()

  try {
    await client.query('BEGIN')

    if (RESET) {
      const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
      await client.query(schemaSql)
      console.log('· esquema recreado (schema.sql)')
    }

    if (TRUNCATE) {
      await client.query(
        'TRUNCATE concurrent_snapshot, rating, play_session, purchase, subscription, ' +
        'customer, subscription_plan, region, dlc, game_platform, game_genre, ' +
        'platform, genre, game, franchise, company RESTART IDENTITY CASCADE'
      )
      console.log('· tablas vaciadas')
    }

    // ---- company -----------------------------------------------------------
    const companies: unknown[][] = []
    const usedCompanyNames = new Set<string>()
    for (let i = 0; i < N_COMPANIES; i++) {
      let name: string
      do {
        name = `${rng.choice(COMPANY_STEM)} ${rng.choice(COMPANY_SUFFIX)}`
      } while (usedCompanyNames.has(name))
      usedCompanyNames.add(name)
      companies.push([name, faker.location.country(), rng.randint(1985, 2020), rng.random() > 0.1])
    }
    const companyIds = await batchInsert(
      client, 'company', ['name', 'country', 'founded_year', 'is_active'],
      companies, { returning: 'company_id' }
    )

    // ---- franchise ---------------------------------------------------------
    const franchises: unknown[][] = []
    const franchiseNames: string[] = []
    for (let i = 0; i < N_FRANCHISES; i++) {
      const name = `${rng.choice(TITLE_ADJ)} ${rng.choice(TITLE_NOUN)}`
      franchiseNames.push(name)
      franchises.push([name, rng.choice(companyIds), rng.randint(1995, 2022)])
    }
    const franchiseIds = await batchInsert(
      client, 'franchise', ['name', 'owner_company_id', 'debut_year'],
      franchises, { returning: 'franchise_id' }
    )

    // ---- catálogos fijos ---------------------------------------------------
    const genreIds = await batchInsert(
      client, 'genre', ['name'],
      GENRES.map(g => [g]), { returning: 'genre_id' }
    )
    const platformIds = await batchInsert(
      client, 'platform', ['name', 'manufacturer', 'kind'],
      PLATFORMS, { returning: 'platform_id' }
    )
    const regionIds = await batchInsert(
      client, 'region', ['name', 'currency'],
      REGIONS, { returning: 'region_id' }
    )
    const planIds = await batchInsert(
      client, 'subscription_plan', ['name', 'monthly_price', 'max_concurrent_streams', 'includes_dlc'],
      PLANS, { returning: 'plan_id' }
    )

    // ---- game --------------------------------------------------------------
    // Reservo un grupo de compañías como "solo editoras" (publishers puros que
    // nunca desarrollan), como pasa en la industria real.
    const publisherOnlyIds = companyIds.slice(-10)
    const developerPool = companyIds.slice(0, -10)

    const games: unknown[][] = []
    const gameReleaseDates: Date[] = []

    for (let i = 0; i < N_GAMES; i++) {
      const franchiseId = rng.random() < 0.55 ? rng.choice(franchiseIds) : null
      let title: string
      if (franchiseId !== null && rng.random() < 0.7) {
        const franchiseIndex = franchiseIds.indexOf(franchiseId)
        const franchiseName = franchiseNames[franchiseIndex]
        title = `${franchiseName} ${rng.choice(['II', 'III', 'IV', 'Reborn', 'Origins', 'Legends'])}`
      } else {
        title = `${rng.choice(TITLE_ADJ)} ${rng.choice(TITLE_NOUN)}`
      }

      const developerId = rng.choice(developerPool)
      let publisherId: number
      if (rng.random() < 0.35) {
        publisherId = developerId
      } else if (rng.random() < 0.5) {
        publisherId = rng.choice(publisherOnlyIds)
      } else {
        publisherId = rng.choice(developerPool)
      }

      const releaseDate = randomDate(new Date(2015, 0, 1), DATA_END, rng)
      let addedToCatalog = addDays(releaseDate, rng.randint(0, 900))
      if (addedToCatalog > DATA_END) addedToCatalog = new Date(DATA_END)

      gameReleaseDates.push(releaseDate)
      games.push([
        title, developerId, publisherId, franchiseId,
        releaseDate, addedToCatalog,
        Math.round(rng.uniform(9.99, 69.99) * 100) / 100,
        rng.choice(AGE_RATINGS),
      ])
    }

    const gameIds = await batchInsert(
      client, 'game',
      ['title', 'developer_company_id', 'publisher_company_id', 'franchise_id',
       'release_date', 'added_to_catalog_date', 'base_price', 'age_rating'],
      games, { returning: 'game_id' }
    )

    // ---- game_genre --------------------------------------------------------
    const gameGenrePairs = new Set<string>()
    const gameGenreRows: unknown[][] = []
    for (const gameId of gameIds) {
      const gameIndex = gameIds.indexOf(gameId)
      const _ = gameIndex  // unused but keeping for clarity
      const count = rng.randint(1, 3)
      for (const genreId of rng.sample(genreIds, count)) {
        const key = `${gameId}-${genreId}`
        if (!gameGenrePairs.has(key)) {
          gameGenrePairs.add(key)
          gameGenreRows.push([gameId, genreId])
        }
      }
    }
    await batchInsert(client, 'game_genre', ['game_id', 'genre_id'], gameGenreRows)

    // ---- game_platform -----------------------------------------------------
    const seenGamePlatforms = new Set<string>()
    const gamePlatformRows: unknown[][] = []
    for (let i = 0; i < gameIds.length; i++) {
      const gameId = gameIds[i]
      const releaseDate = gameReleaseDates[i]
      const count = rng.randint(1, 4)
      for (const platformId of rng.sample(platformIds, count)) {
        const key = `${gameId}-${platformId}`
        if (!seenGamePlatforms.has(key)) {
          seenGamePlatforms.add(key)
          gamePlatformRows.push([gameId, platformId, releaseDate])
        }
      }
    }
    await batchInsert(client, 'game_platform', ['game_id', 'platform_id', 'release_date'], gamePlatformRows)

    // ---- dlc ---------------------------------------------------------------
    const dlcs: unknown[][] = []
    for (let i = 0; i < gameIds.length; i++) {
      if (rng.random() < 0.5) {
        const count = rng.randint(1, 4)
        for (let j = 0; j < count; j++) {
          const releaseDate = randomDate(gameReleaseDates[i], DATA_END, rng)
          dlcs.push([
            gameIds[i],
            `${rng.choice(DLC_KIND)} #${rng.randint(1, 9)}`,
            releaseDate,
            Math.round(rng.uniform(2.99, 29.99) * 100) / 100,
          ])
        }
      }
    }
    const dlcIds = await batchInsert(
      client, 'dlc', ['game_id', 'title', 'release_date', 'price'],
      dlcs, { returning: 'dlc_id' }
    )
    const dlcPriceById = new Map<number, number>()
    for (let i = 0; i < dlcIds.length; i++) {
      dlcPriceById.set(dlcIds[i], dlcs[i][3] as number)
    }

    // ---- customer ----------------------------------------------------------
    const customers: unknown[][] = []
    for (let i = 0; i < N_CUSTOMERS; i++) {
      customers.push([
        faker.internet.username(),
        faker.internet.email(),
        rng.choice(regionIds),
        randomDate(new Date(2023, 0, 1), TODAY, rng),
        rng.randint(1970, 2009),
      ])
    }
    const customerIds = await batchInsert(
      client, 'customer', ['username', 'email', 'region_id', 'signup_date', 'birth_year'],
      customers, { returning: 'customer_id' }
    )
    const customerSignupDate = new Map<number, Date>()
    for (let i = 0; i < customerIds.length; i++) {
      customerSignupDate.set(customerIds[i], customers[i][3] as Date)
    }

    // ---- subscription ------------------------------------------------------
    const planWeights = [0.45, 0.35, 0.20]
    const planPriceById = new Map<number, number>()
    for (let i = 0; i < planIds.length; i++) {
      planPriceById.set(planIds[i], PLANS[i][1])
    }

    const subscriptions: unknown[][] = []
    for (const customerId of customerIds) {
      let cursorDate = new Date(customerSignupDate.get(customerId)!)
      const subscriptionCount = rng.choices([1, 2, 3], [0.6, 0.3, 0.1])
      for (let subIdx = 0; subIdx < subscriptionCount; subIdx++) {
        const planId = rng.choices(planIds, planWeights)
        const isLast = subIdx === subscriptionCount - 1
        let endDate: Date | null
        let status: string
        if (isLast && rng.random() < 0.55) {
          endDate = null
          status = 'active'
        } else {
          const months = rng.randint(1, 20)
          endDate = minDate(addDays(cursorDate, 30 * months), TODAY)
          status = rng.choices(['cancelled', 'paused'])
        }
        subscriptions.push([
          customerId, planId, cursorDate, endDate, status,
          planPriceById.get(planId)!,
        ])
        if (endDate === null) break
        cursorDate = addDays(endDate, rng.randint(0, 120))
        if (cursorDate >= TODAY) break
      }
    }
    await batchInsert(
      client, 'subscription',
      ['customer_id', 'plan_id', 'start_date', 'end_date', 'status', 'monthly_price'],
      subscriptions
    )

    // ---- purchase ----------------------------------------------------------
    const purchases: unknown[][] = []
    if (dlcIds.length > 0) {
      for (let i = 0; i < Math.floor(N_CUSTOMERS * 1.6); i++) {
        const customerId = rng.choice(customerIds)
        const dlcId = rng.choice(dlcIds)
        const purchaseDate = randomDate(customerSignupDate.get(customerId)!, TODAY, rng)
        purchases.push([customerId, dlcId, purchaseDate, dlcPriceById.get(dlcId)!])
      }
    }
    await batchInsert(client, 'purchase', ['customer_id', 'dlc_id', 'purchase_date', 'amount'], purchases)

    // ---- play_session ------------------------------------------------------
    const gamePopularity = new Map<number, number>()
    for (const gameId of gameIds) {
      gamePopularity.set(gameId, rng.paretovariate(1.3))
    }
    const popularGames = [...gameIds]
    const popularityWeights = popularGames.map(id => gamePopularity.get(id)!)

    const sessions: unknown[][] = []
    for (let i = 0; i < N_SESSIONS; i++) {
      const gameId = rng.choices(popularGames, popularityWeights)
      const customerId = rng.choice(customerIds)
      const date = randomDate(DATA_START, DATA_END, rng)
      const minutes = rng.randint(0, 1439)
      const startedAt = new Date(date)
      startedAt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
      sessions.push([customerId, gameId, rng.choice(platformIds), startedAt, rng.randint(5, 240)])
    }
    await batchInsert(
      client, 'play_session',
      ['customer_id', 'game_id', 'platform_id', 'started_at', 'duration_minutes'],
      sessions
    )

    // ---- rating ------------------------------------------------------------
    const ratings: unknown[][] = []
    const seenRatings = new Set<string>()
    while (ratings.length < N_RATINGS) {
      const customerId = rng.choice(customerIds)
      const gameId = rng.choices(popularGames, popularityWeights)
      const key = `${customerId}-${gameId}`
      if (seenRatings.has(key)) continue
      seenRatings.add(key)
      const score = rng.choices([1, 2, 3, 4, 5], [0.05, 0.1, 0.2, 0.35, 0.3])
      ratings.push([customerId, gameId, score, randomDate(DATA_START, TODAY, rng)])
    }
    await batchInsert(
      client, 'rating', ['customer_id', 'game_id', 'score', 'rated_at'],
      ratings
    )

    // ---- concurrent_snapshot -----------------------------------------------
    const topGames = [...gameIds]
      .sort((a, b) => (gamePopularity.get(b) ?? 0) - (gamePopularity.get(a) ?? 0))
      .slice(0, 120)
    const topWeights = topGames.map(id => gamePopularity.get(id)!)

    const snapshots: unknown[][] = []
    for (let i = 0; i < N_SNAPSHOTS; i++) {
      const gameId = rng.choices(topGames, topWeights)
      const regionId = rng.choice(regionIds)
      const date = randomDate(DATA_START, DATA_END, rng)
      const capturedAt = new Date(date)
      capturedAt.setHours(rng.randint(0, 23), 0, 0, 0)
      const basePlayers = Math.floor((gamePopularity.get(gameId) ?? 1) * rng.randint(50, 400))
      snapshots.push([gameId, regionId, capturedAt, Math.max(basePlayers, 1)])
    }
    await batchInsert(
      client, 'concurrent_snapshot',
      ['game_id', 'region_id', 'captured_at', 'concurrent_players'],
      snapshots
    )

    await client.query('COMMIT')

    console.log('\nDatos generados (seed=42):')
    console.log(`  company=${companyIds.length} franchise=${franchiseIds.length} game=${gameIds.length}`)
    console.log(`  dlc=${dlcIds.length} customer=${customerIds.length} subscription=${subscriptions.length}`)
    console.log(`  purchase=${purchases.length} session=${sessions.length} rating=${ratings.length} snapshot=${snapshots.length}`)

  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
