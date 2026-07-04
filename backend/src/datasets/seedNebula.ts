/**
 * Seeder LIGERO y reproducible para Nebula (BD grande de escala, SPEC-17).
 *
 * Objetivo: dar datos suficientes para medir la EXECUTION ACCURACY del golden set
 * (¿la consulta generada da el mismo resultado que la de referencia?), NO un volumen
 * realista. Por eso las cantidades son pequeñas (cientos de filas): validamos la
 * resolución pregunta→SQL, no la cantidad de datos.
 *
 * Uso (desde backend/):
 *   npm run seed:nebula              # puebla la BD nebula (TARGET_DB_2_* del .env)
 *   npm run seed:nebula -- --reset   # recrea el esquema (schema.sql) antes de poblar
 *
 * Reproducibilidad: SeededRandom(42) + faker.seed(42).
 * Dependencias: pg, @faker-js/faker, seedrandom, dotenv.
 */
import { Client } from 'pg'
import { faker } from '@faker-js/faker'
import seedrandom from 'seedrandom'
import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from 'dotenv'

// Resuelvo el `.env` de la raíz del repo relativo a este fichero (no al cwd), para que
// funcione se lance desde donde se lance. Este fichero vive en backend/src/datasets/.
config({ path: join(__dirname, '../../../.env') })

// --- PRNG reproducible (igual que el seeder de Arcadia) --------------------------
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
    const n = Math.min(k, copy.length)
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(this.rng() * (copy.length - i))
      result.push(copy[idx])
      copy[idx] = copy[copy.length - i - 1]
    }
    return result
  }
}

const SEED = 42

// --- Volúmenes (PEQUEÑOS a propósito) -------------------------------------------
const N_COMPANIES = 20
const N_FRANCHISES = 12
const N_STUDIOS = 25
const N_GAMES = 80
const N_CUSTOMERS = 200
const N_BUNDLES = 10
const N_PLAY_SESSIONS = 1200
const N_INVOICES = 300
const N_REVIEWS = 250
const N_TOURNAMENTS = 25
const N_WISHLIST = 350

const DATA_START = new Date(2023, 0, 1)
const TODAY = new Date(2026, 5, 22)

// --- Catálogos fijos (incluyen los literales que pide el golden set) -------------
const GENRES = ['Action', 'Adventure', 'RPG', 'Strategy', 'Simulation', 'Sports', 'Racing', 'Puzzle', 'Shooter', 'Platformer', 'Horror', 'Fighting']
const PLATFORMS: [string, string, string][] = [
  ['PC', 'Open Hardware', 'pc'], // N-12 busca la plataforma "PC"
  ['Volt Station 5', 'Voltic', 'console'],
  ['Krys Box X', 'Krystal', 'console'],
  ['Lumen Switch', 'Lumen', 'handheld'],
  ['Nebula Cloud', 'Nebula', 'cloud'],
]
const REGIONS: [string, string][] = [
  ['North America', 'USD'], ['Europe', 'EUR'], ['LATAM', 'USD'], ['Asia Pacific', 'USD'], ['Oceania', 'AUD'],
]
const LANGUAGES: [string, string][] = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese'], ['pt', 'Portuguese'],
] // N-15 busca audio en "Spanish"
const BOARDS: [string, string][] = [['ESRB', 'North America'], ['PEGI', 'Europe'], ['CERO', 'Japan']]
const TAGS = ['multiplayer', 'singleplayer', 'co-op', 'open-world', 'indie', 'competitive', 'story-rich', 'roguelike', 'pixel-art', 'vr', 'early-access', 'moddable']
const PLANS: [string, number, number, boolean][] = [['Basic', 6.99, 1, false], ['Standard', 11.99, 2, false], ['Premium', 16.99, 4, true]]
const PAYMENT_PROVIDERS: [string, string][] = [['Visa', 'card'], ['Mastercard', 'card'], ['PayPal', 'wallet'], ['Apple Pay', 'wallet']]
const DEVICE_TYPES: [string, string][] = [['Desktop', 'pc'], ['Laptop', 'pc'], ['Console', 'console'], ['Phone', 'mobile'], ['Tablet', 'mobile']]
const ACHIEVEMENT_CATEGORIES = ['Story', 'Exploration', 'Combat', 'Collection', 'Multiplayer', 'Challenge']
const FAQ_CATEGORIES = ['Billing', 'Account', 'Gameplay', 'Technical', 'Privacy']
const AGE_RATINGS = ['E', 'E10', 'T', 'M']
const GL_KINDS = ['audio', 'subtitles', 'interface']
const INVOICE_STATUS = ['paid', 'pending', 'refunded']
const TICKET_STATUS = ['open', 'pending', 'closed']
const TITLE_ADJ = ['Shadow', 'Crimson', 'Eternal', 'Frozen', 'Hollow', 'Radiant', 'Savage', 'Silent', 'Golden', 'Iron', 'Neon', 'Storm', 'Crystal']
const TITLE_NOUN = ['Realm', 'Horizon', 'Legacy', 'Dominion', 'Odyssey', 'Saga', 'Empire', 'Frontier', 'Ascension', 'Citadel', 'Vanguard', 'Vortex']
const COMPANY_STEM = ['Pixel', 'Nova', 'Vertex', 'Quantum', 'Ember', 'Cobalt', 'Lunar', 'Apex', 'Onyx', 'Zenith', 'Forge', 'Helix', 'Titan', 'Nimbus']
const COMPANY_SUFFIX = ['Studios', 'Games', 'Interactive', 'Entertainment', 'Works']

// --- Helpers ---------------------------------------------------------------------
function randomDate(start: Date, end: Date, rng: SeededRandom): Date {
  return new Date(start.getTime() + Math.floor(rng.random() * (end.getTime() - start.getTime() + 1)))
}

async function batchInsert(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][],
  options: { returning?: string } = {},
): Promise<number[]> {
  if (rows.length === 0) return []
  const BATCH_SIZE = 500
  const results: number[] = []
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const colCount = columns.length
    const placeholders = batch
      .map((_, rowIdx) => `(${columns.map((__, colIdx) => `$${rowIdx * colCount + colIdx + 1}`).join(', ')})`)
      .join(', ')
    const returningClause = options.returning ? ` RETURNING ${options.returning}` : ''
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}${returningClause}`
    const result = await client.query(sql, batch.flat())
    if (options.returning) {
      results.push(...(result.rows as Record<string, unknown>[]).map((row) => row[options.returning!] as number))
    }
  }
  return results
}

/** Conexión a la BD nebula (TARGET_DB_2_* del .env, con defaults de Postgres local). */
function connect(): Client {
  return new Client({
    host: process.env.TARGET_DB_2_HOST ?? 'localhost',
    port: parseInt(process.env.TARGET_DB_2_PORT ?? '5432'),
    database: process.env.TARGET_DB_2_NAME ?? 'nebula',
    user: process.env.TARGET_DB_2_USER ?? 'postgres',
    password: process.env.TARGET_DB_2_PASSWORD ?? 'postgres',
  })
}

async function main(): Promise<void> {
  const reset = process.argv.slice(2).includes('--reset')
  const rng = new SeededRandom(SEED)
  faker.seed(SEED)

  const client = connect()
  await client.connect()
  try {
    if (reset) {
      await client.query(readFileSync(join(__dirname, '../../../setup/datasets/nebula/schema.sql'), 'utf-8'))
      console.log('· esquema recreado (schema.sql)')
    }
    await client.query('BEGIN')

    // --- Dimensiones base --------------------------------------------------------
    const companyIds = await batchInsert(
      client, 'company', ['name', 'country', 'founded_year', 'is_active'],
      Array.from({ length: N_COMPANIES }, () => [`${rng.choice(COMPANY_STEM)} ${rng.choice(COMPANY_SUFFIX)}`, faker.location.country(), rng.randint(1985, 2020), rng.random() > 0.1]),
      { returning: 'company_id' },
    )
    const genreIds = await batchInsert(client, 'genre', ['name'], GENRES.map((g) => [g]), { returning: 'genre_id' })
    const platformIds = await batchInsert(client, 'platform', ['name', 'manufacturer', 'kind'], PLATFORMS, { returning: 'platform_id' })
    const regionIds = await batchInsert(client, 'region', ['name', 'currency'], REGIONS, { returning: 'region_id' })
    const languageIds = await batchInsert(client, 'language', ['code', 'name'], LANGUAGES, { returning: 'language_id' })
    const spanishId = languageIds[LANGUAGES.findIndex(([code]) => code === 'es')]
    const boardIds = await batchInsert(client, 'age_rating_board', ['name', 'region'], BOARDS, { returning: 'board_id' })
    const tagIds = await batchInsert(client, 'tag', ['name'], TAGS.map((t) => [t]), { returning: 'tag_id' })
    const planIds = await batchInsert(client, 'subscription_plan', ['name', 'monthly_price', 'max_concurrent_streams', 'includes_dlc'], PLANS, { returning: 'plan_id' })
    const providerIds = await batchInsert(client, 'payment_provider', ['name', 'kind'], PAYMENT_PROVIDERS, { returning: 'provider_id' })
    const deviceTypeIds = await batchInsert(client, 'device_type', ['name', 'category'], DEVICE_TYPES, { returning: 'device_type_id' })
    const achCategoryIds = await batchInsert(client, 'achievement_category', ['name'], ACHIEVEMENT_CATEGORIES.map((c) => [c]), { returning: 'category_id' })
    const faqCategoryIds = await batchInsert(client, 'faq_category', ['name'], FAQ_CATEGORIES.map((c) => [c]), { returning: 'faq_category_id' })

    // --- Nivel 2 -----------------------------------------------------------------
    const franchiseIds = await batchInsert(
      client, 'franchise', ['name', 'owner_company_id', 'debut_year'],
      Array.from({ length: N_FRANCHISES }, () => [`${rng.choice(TITLE_ADJ)} ${rng.choice(TITLE_NOUN)}`, rng.choice(companyIds), rng.randint(1995, 2022)]),
      { returning: 'franchise_id' },
    )
    const studioIds = await batchInsert(
      client, 'studio', ['name', 'company_id', 'country', 'headcount'],
      Array.from({ length: N_STUDIOS }, () => [`${rng.choice(COMPANY_STEM)} ${rng.choice(['Lab', 'Team', 'Division', 'Collective'])}`, rng.choice(companyIds), faker.location.country(), rng.randint(10, 500)]),
      { returning: 'studio_id' },
    )
    const countryRows = Array.from({ length: 20 }, (_, i) => [faker.location.country(), rng.choice(regionIds), `C${String(i).padStart(2, '0')}`])
    const countryIds = await batchInsert(client, 'country', ['name', 'region_id', 'iso_code'], countryRows, { returning: 'country_id' })

    const gameReleaseDates: Date[] = []
    const gameRows = Array.from({ length: N_GAMES }, () => {
      const release = randomDate(new Date(2015, 0, 1), TODAY, rng)
      gameReleaseDates.push(release)
      return [
        `${rng.choice(TITLE_ADJ)} ${rng.choice(TITLE_NOUN)}`,
        rng.choice(companyIds), rng.choice(companyIds),
        rng.random() < 0.5 ? rng.choice(franchiseIds) : null,
        rng.choice(boardIds), release,
        Math.round(rng.uniform(9.99, 69.99) * 100) / 100, rng.choice(AGE_RATINGS),
      ]
    })
    const gameIds = await batchInsert(
      client, 'game',
      ['title', 'developer_company_id', 'publisher_company_id', 'franchise_id', 'board_id', 'release_date', 'base_price', 'age_rating'],
      gameRows, { returning: 'game_id' },
    )

    const customerIds = await batchInsert(
      client, 'customer', ['username', 'email', 'region_id', 'country_id', 'signup_date', 'birth_year'],
      Array.from({ length: N_CUSTOMERS }, () => [faker.internet.username(), faker.internet.email(), rng.choice(regionIds), rng.choice(countryIds), randomDate(DATA_START, TODAY, rng), rng.randint(1970, 2009)]),
      { returning: 'customer_id' },
    )
    const bundleIds = await batchInsert(
      client, 'bundle', ['name', 'publisher_id', 'price', 'release_date'],
      Array.from({ length: N_BUNDLES }, () => [`${rng.choice(TITLE_ADJ)} Collection`, rng.choice(companyIds), Math.round(rng.uniform(19.99, 99.99) * 100) / 100, randomDate(new Date(2020, 0, 1), TODAY, rng)]),
      { returning: 'bundle_id' },
    )

    // subscription / payment_method / device / customer_profile
    await batchInsert(
      client, 'subscription', ['customer_id', 'plan_id', 'start_date', 'end_date', 'status', 'monthly_price'],
      customerIds.map((id) => {
        const planIdx = rng.randint(0, planIds.length - 1)
        const active = rng.random() < 0.6
        return [id, planIds[planIdx], randomDate(DATA_START, TODAY, rng), active ? null : randomDate(DATA_START, TODAY, rng), active ? 'active' : rng.choice(['cancelled', 'paused']), PLANS[planIdx][1]]
      }),
    )
    const paymentMethodIds = await batchInsert(
      client, 'payment_method', ['customer_id', 'provider_id', 'last4', 'is_default'],
      customerIds.map((id) => [id, rng.choice(providerIds), String(rng.randint(1000, 9999)), true]),
      { returning: 'payment_method_id' },
    )
    const deviceIds = await batchInsert(
      client, 'device', ['customer_id', 'device_type_id', 'label', 'last_seen_at'],
      customerIds.map((id) => [id, rng.choice(deviceTypeIds), faker.commerce.productName(), randomDate(DATA_START, TODAY, rng)]),
      { returning: 'device_id' },
    )
    await batchInsert(
      client, 'customer_profile', ['customer_id', 'display_name', 'bio', 'avatar_url', 'is_public'],
      rng.sample(customerIds, Math.floor(customerIds.length * 0.7)).map((id) => [id, faker.internet.displayName(), faker.lorem.sentence(), faker.image.avatar(), rng.random() > 0.3]),
    )

    // --- Catálogo del juego (M:N y contenido) ------------------------------------
    // Pares únicos juego↔X, para no duplicar la PK compuesta de las tablas M:N.
    const gamePairs = (pick: () => number[]): unknown[][] => {
      const seen = new Set<string>()
      const rows: unknown[][] = []
      for (const gameId of gameIds) {
        for (const x of pick()) {
          const key = `${gameId}-${x}`
          if (!seen.has(key)) {
            seen.add(key)
            rows.push([gameId, x])
          }
        }
      }
      return rows
    }
    await batchInsert(client, 'game_genre', ['game_id', 'genre_id'], gamePairs(() => rng.sample(genreIds, rng.randint(1, 3))))
    await batchInsert(client, 'game_platform', ['game_id', 'platform_id', 'release_date'],
      gameIds.flatMap((g, i) => rng.sample(platformIds, rng.randint(1, 3)).map((p) => [g, p, gameReleaseDates[i]])))
    await batchInsert(client, 'game_tag', ['game_id', 'tag_id'], gamePairs(() => rng.sample(tagIds, rng.randint(1, 4))))

    // game_language: garantizo audio en español para varios juegos (N-15)
    const glSeen = new Set<string>()
    const gameLanguageRows: unknown[][] = []
    for (const gameId of gameIds) {
      for (const languageId of rng.sample(languageIds, rng.randint(1, 4))) {
        for (const kind of rng.sample(GL_KINDS, rng.randint(1, 3))) {
          const k = `${gameId}-${languageId}-${kind}`
          if (!glSeen.has(k)) {
            glSeen.add(k)
            gameLanguageRows.push([gameId, languageId, kind])
          }
        }
      }
    }
    for (const gameId of rng.sample(gameIds, Math.floor(gameIds.length * 0.4))) {
      const k = `${gameId}-${spanishId}-audio`
      if (!glSeen.has(k)) {
        glSeen.add(k)
        gameLanguageRows.push([gameId, spanishId, 'audio'])
      }
    }
    await batchInsert(client, 'game_language', ['game_id', 'language_id', 'kind'], gameLanguageRows)

    await batchInsert(client, 'game_media', ['game_id', 'kind', 'url'],
      gameIds.flatMap((g) => rng.sample(['screenshot', 'trailer', 'artwork'], rng.randint(1, 3)).map((k) => [g, k, faker.internet.url()])))
    await batchInsert(client, 'game_edition', ['game_id', 'name', 'price'],
      gameIds.flatMap((g, i) => rng.sample(['Standard', 'Deluxe', "Collector's"], rng.randint(1, 2)).map((n) => [g, n, Math.round((gameRows[i][6] as number) * rng.uniform(1, 2) * 100) / 100])))
    await batchInsert(client, 'soundtrack', ['game_id', 'title', 'track_count'],
      rng.sample(gameIds, Math.floor(gameIds.length * 0.5)).map((g) => [g, `${faker.music.songName()} OST`, rng.randint(8, 40)]))
    const dlcIds = await batchInsert(client, 'dlc', ['game_id', 'title', 'release_date', 'price'],
      gameIds.flatMap((g, i) => (rng.random() < 0.6 ? rng.sample(['Expansion', 'Season Pass', 'Map Pack', 'Story DLC'], rng.randint(1, 2)).map((t) => [g, `${t}`, randomDate(gameReleaseDates[i], TODAY, rng), Math.round(rng.uniform(2.99, 29.99) * 100) / 100]) : [])),
      { returning: 'dlc_id' })
    await batchInsert(client, 'bundle_game', ['bundle_id', 'game_id'],
      bundleIds.flatMap((b) => rng.sample(gameIds, rng.randint(2, 5)).map((g) => [b, g])))

    // --- Logros y clasificaciones ------------------------------------------------
    const achievementIds = await batchInsert(client, 'achievement', ['game_id', 'category_id', 'name', 'points'],
      gameIds.flatMap((g) => rng.sample(['First Blood', 'Completionist', 'Speedrun', 'Explorer', 'Master'], rng.randint(1, 4)).map((n) => [g, rng.choice(achCategoryIds), n, rng.choice([5, 10, 25, 50])])),
      { returning: 'achievement_id' })
    const leaderboardIds = await batchInsert(client, 'leaderboard', ['game_id', 'name', 'metric'],
      rng.sample(gameIds, Math.floor(gameIds.length * 0.6)).map((g) => [g, 'Global', rng.choice(['score', 'time', 'kills'])]),
      { returning: 'leaderboard_id' })

    // --- Telemetría --------------------------------------------------------------
    const sessionIds = await batchInsert(client, 'play_session', ['customer_id', 'game_id', 'platform_id', 'device_id', 'started_at', 'duration_minutes'],
      Array.from({ length: N_PLAY_SESSIONS }, () => [rng.choice(customerIds), rng.choice(gameIds), rng.choice(platformIds), rng.choice(deviceIds), randomDate(DATA_START, TODAY, rng), rng.randint(5, 240)]),
      { returning: 'session_id' })
    await batchInsert(client, 'session_event', ['session_id', 'kind', 'occurred_at'],
      rng.sample(sessionIds, Math.min(sessionIds.length, 800)).flatMap((s) => rng.sample(['level_up', 'checkpoint', 'death', 'purchase'], rng.randint(1, 3)).map((k) => [s, k, randomDate(DATA_START, TODAY, rng)])))
    await batchInsert(client, 'save_game', ['customer_id', 'game_id', 'slot', 'updated_at'],
      Array.from({ length: 400 }, () => [rng.choice(customerIds), rng.choice(gameIds), rng.randint(1, 3), randomDate(DATA_START, TODAY, rng)]))
    await batchInsert(client, 'crash_report', ['session_id', 'device_id', 'message', 'occurred_at'],
      rng.sample(sessionIds, Math.min(sessionIds.length, 150)).map((s) => [s, rng.choice(deviceIds), faker.hacker.phrase(), randomDate(DATA_START, TODAY, rng)]))
    await batchInsert(client, 'leaderboard_entry', ['leaderboard_id', 'customer_id', 'value', 'recorded_at'],
      leaderboardIds.flatMap((lb) => rng.sample(customerIds, rng.randint(3, 12)).map((c) => [lb, c, rng.randint(100, 100000), randomDate(DATA_START, TODAY, rng)])))
    const custAchSeen = new Set<string>()
    const custAchRows: unknown[][] = []
    for (const customerId of customerIds) {
      for (const achievementId of rng.sample(achievementIds, rng.randint(0, 8))) {
        const k = `${customerId}-${achievementId}`
        if (!custAchSeen.has(k)) {
          custAchSeen.add(k)
          custAchRows.push([customerId, achievementId, randomDate(DATA_START, TODAY, rng)])
        }
      }
    }
    await batchInsert(client, 'customer_achievement', ['customer_id', 'achievement_id', 'unlocked_at'], custAchRows)

    // --- Comercio ----------------------------------------------------------------
    const invoiceIds = await batchInsert(client, 'invoice', ['customer_id', 'payment_method_id', 'issued_at', 'total', 'status'],
      Array.from({ length: N_INVOICES }, () => [rng.choice(customerIds), rng.choice(paymentMethodIds), randomDate(DATA_START, TODAY, rng), Math.round(rng.uniform(5, 120) * 100) / 100, rng.choices(INVOICE_STATUS, [0.7, 0.2, 0.1])]),
      { returning: 'invoice_id' })
    await batchInsert(client, 'invoice_line', ['invoice_id', 'game_id', 'dlc_id', 'description', 'amount'],
      invoiceIds.flatMap((inv) => rng.sample([1, 2, 3], rng.randint(1, 2)).map(() => {
        const isDlc = dlcIds.length > 0 && rng.random() < 0.5
        return [inv, isDlc ? null : rng.choice(gameIds), isDlc ? rng.choice(dlcIds) : null, isDlc ? 'DLC' : 'Game', Math.round(rng.uniform(2, 60) * 100) / 100]
      })))
    const couponIds = await batchInsert(client, 'coupon', ['code', 'plan_id', 'discount_pct', 'valid_until'],
      Array.from({ length: 20 }, (_, i) => [`NEB${String(i).padStart(3, '0')}`, rng.random() < 0.5 ? rng.choice(planIds) : null, rng.choice([10, 20, 30, 50]), randomDate(TODAY, new Date(2027, 0, 1), rng)]),
      { returning: 'coupon_id' })
    await batchInsert(client, 'coupon_redemption', ['coupon_id', 'customer_id', 'invoice_id', 'redeemed_at'],
      Array.from({ length: 100 }, () => [rng.choice(couponIds), rng.choice(customerIds), rng.choice(invoiceIds), randomDate(DATA_START, TODAY, rng)]))
    await batchInsert(client, 'gift_card', ['purchaser_id', 'balance', 'issued_at'],
      Array.from({ length: 50 }, () => [rng.choice(customerIds), Math.round(rng.uniform(10, 100) * 100) / 100, randomDate(DATA_START, TODAY, rng)]))
    await batchInsert(client, 'refund', ['invoice_id', 'amount', 'reason', 'refunded_at'],
      rng.sample(invoiceIds, 40).map((inv) => [inv, Math.round(rng.uniform(1, 40) * 100) / 100, rng.choice(['duplicate', 'not_as_described', 'accidental']), randomDate(DATA_START, TODAY, rng)]))
    if (dlcIds.length > 0) {
      await batchInsert(client, 'purchase', ['customer_id', 'dlc_id', 'purchase_date', 'amount'],
        Array.from({ length: 300 }, () => [rng.choice(customerIds), rng.choice(dlcIds), randomDate(DATA_START, TODAY, rng), Math.round(rng.uniform(2.99, 29.99) * 100) / 100]))
    }

    // --- Social ------------------------------------------------------------------
    const pairSeen = new Set<string>()
    const friendRows: unknown[][] = []
    const followRows: unknown[][] = []
    for (let i = 0; i < 300; i++) {
      const [a, b] = rng.sample(customerIds, 2)
      if (a !== b && !pairSeen.has(`${a}-${b}`)) {
        pairSeen.add(`${a}-${b}`)
        friendRows.push([a, b, randomDate(DATA_START, TODAY, rng)])
      }
      const [c, d] = rng.sample(customerIds, 2)
      if (c !== d && !pairSeen.has(`f${c}-${d}`)) {
        pairSeen.add(`f${c}-${d}`)
        followRows.push([c, d, randomDate(DATA_START, TODAY, rng)])
      }
    }
    await batchInsert(client, 'friendship', ['customer_id', 'friend_id', 'since'], friendRows)
    await batchInsert(client, 'follow', ['follower_id', 'followed_id', 'since'], followRows)
    const chatRoomIds = await batchInsert(client, 'chat_room', ['name', 'game_id', 'created_at'],
      Array.from({ length: 30 }, () => [faker.word.noun(), rng.random() < 0.7 ? rng.choice(gameIds) : null, randomDate(DATA_START, TODAY, rng)]),
      { returning: 'chat_room_id' })
    const membershipSeen = new Set<string>()
    const membershipRows: unknown[][] = []
    for (const room of chatRoomIds) {
      for (const c of rng.sample(customerIds, rng.randint(3, 10))) {
        const k = `${room}-${c}`
        if (!membershipSeen.has(k)) {
          membershipSeen.add(k)
          membershipRows.push([room, c, randomDate(DATA_START, TODAY, rng)])
        }
      }
    }
    await batchInsert(client, 'chat_membership', ['chat_room_id', 'customer_id', 'joined_at'], membershipRows)
    await batchInsert(client, 'message', ['chat_room_id', 'sender_id', 'body', 'sent_at'],
      Array.from({ length: 600 }, () => [rng.choice(chatRoomIds), rng.choice(customerIds), faker.lorem.sentence(), randomDate(DATA_START, TODAY, rng)]))
    await batchInsert(client, 'activity_feed', ['customer_id', 'kind', 'payload', 'created_at'],
      Array.from({ length: 500 }, () => [rng.choice(customerIds), rng.choice(['achievement', 'review', 'friend', 'purchase']), faker.lorem.words(3), randomDate(DATA_START, TODAY, rng)]))

    // --- Reseñas y moderación ----------------------------------------------------
    const reviewIds = await batchInsert(client, 'review', ['customer_id', 'game_id', 'title', 'body', 'posted_at'],
      Array.from({ length: N_REVIEWS }, () => [rng.choice(customerIds), rng.choice(gameIds), faker.lorem.words(4), faker.lorem.paragraph(), randomDate(DATA_START, TODAY, rng)]),
      { returning: 'review_id' })
    const reviewVoteSeen = new Set<string>()
    const reviewVoteRows: unknown[][] = []
    for (const review of reviewIds) {
      for (const c of rng.sample(customerIds, rng.randint(0, 8))) {
        const k = `${review}-${c}`
        if (!reviewVoteSeen.has(k)) {
          reviewVoteSeen.add(k)
          reviewVoteRows.push([review, c, rng.random() < 0.7])
        }
      }
    }
    await batchInsert(client, 'review_vote', ['review_id', 'customer_id', 'is_helpful'], reviewVoteRows)
    const ratingSeen = new Set<string>()
    const ratingRows: unknown[][] = []
    while (ratingRows.length < 500) {
      const c = rng.choice(customerIds)
      const g = rng.choice(gameIds)
      const k = `${c}-${g}`
      if (ratingSeen.has(k)) continue
      ratingSeen.add(k)
      ratingRows.push([c, g, rng.choices([1, 2, 3, 4, 5], [0.05, 0.1, 0.2, 0.35, 0.3]), randomDate(DATA_START, TODAY, rng)])
    }
    await batchInsert(client, 'rating', ['customer_id', 'game_id', 'score', 'rated_at'], ratingRows)
    await batchInsert(client, 'report', ['reporter_id', 'review_id', 'reason', 'created_at'],
      Array.from({ length: 40 }, () => [rng.choice(customerIds), rng.choice(reviewIds), rng.choice(['spam', 'abuse', 'offtopic']), randomDate(DATA_START, TODAY, rng)]))
    await batchInsert(client, 'ban', ['customer_id', 'reason', 'banned_at', 'until'],
      rng.sample(customerIds, 20).map((c) => [c, rng.choice(['cheating', 'toxicity', 'fraud']), randomDate(DATA_START, TODAY, rng), rng.random() < 0.5 ? randomDate(TODAY, new Date(2027, 0, 1), rng) : null]))

    // --- Eventos y torneos -------------------------------------------------------
    const tournamentIds = await batchInsert(client, 'tournament', ['game_id', 'name', 'starts_at', 'prize_pool'],
      Array.from({ length: N_TOURNAMENTS }, () => [rng.choice(gameIds), `${rng.choice(TITLE_ADJ)} Cup`, randomDate(DATA_START, new Date(2027, 0, 1), rng), Math.round(rng.uniform(1000, 60000) * 100) / 100]),
      { returning: 'tournament_id' })
    const tpSeen = new Set<string>()
    const tpRows: unknown[][] = []
    for (const t of tournamentIds) {
      for (const c of rng.sample(customerIds, rng.randint(4, 16))) {
        const k = `${t}-${c}`
        if (!tpSeen.has(k)) {
          tpSeen.add(k)
          tpRows.push([t, c, rng.randint(1, 16)])
        }
      }
    }
    await batchInsert(client, 'tournament_participant', ['tournament_id', 'customer_id', 'seed'], tpRows)
    const eventIds = await batchInsert(client, 'event', ['region_id', 'name', 'held_on', 'venue'],
      Array.from({ length: 20 }, () => [rng.choice(regionIds), `${rng.choice(TITLE_NOUN)} Expo`, randomDate(DATA_START, new Date(2027, 0, 1), rng), faker.location.city()]),
      { returning: 'event_id' })
    await batchInsert(client, 'event_registration', ['event_id', 'customer_id', 'registered_at'],
      eventIds.flatMap((e) => rng.sample(customerIds, rng.randint(3, 12)).map((c) => [e, c, randomDate(DATA_START, TODAY, rng)])))

    // --- Soporte -----------------------------------------------------------------
    const ticketIds = await batchInsert(client, 'support_ticket', ['customer_id', 'subject', 'status', 'opened_at'],
      Array.from({ length: 120 }, () => [rng.choice(customerIds), faker.lorem.words(5), rng.choices(TICKET_STATUS, [0.3, 0.2, 0.5]), randomDate(DATA_START, TODAY, rng)]),
      { returning: 'ticket_id' })
    await batchInsert(client, 'ticket_message', ['ticket_id', 'author_id', 'body', 'sent_at'],
      ticketIds.flatMap((t) => rng.sample([1, 2, 3], rng.randint(1, 3)).map(() => [t, rng.choice(customerIds), faker.lorem.sentence(), randomDate(DATA_START, TODAY, rng)])))
    await batchInsert(client, 'faq', ['faq_category_id', 'question', 'answer'],
      Array.from({ length: 30 }, () => [rng.choice(faqCategoryIds), `${faker.lorem.sentence()}?`, faker.lorem.paragraph()]))

    // --- Telemetría agregada y lista de deseos (t_042) ---------------------------
    await batchInsert(client, 'concurrent_snapshot', ['game_id', 'region_id', 'captured_at', 'concurrent_players'],
      Array.from({ length: 800 }, () => [rng.choice(gameIds), rng.choice(regionIds), randomDate(DATA_START, TODAY, rng), rng.randint(10, 5000)]))
    const wishSeen = new Set<string>()
    const wishRows: unknown[][] = []
    while (wishRows.length < N_WISHLIST) {
      const c = rng.choice(customerIds)
      const g = rng.choice(gameIds)
      const k = `${c}-${g}`
      if (wishSeen.has(k)) continue
      wishSeen.add(k)
      wishRows.push([c, g, randomDate(DATA_START, TODAY, rng)])
    }
    await batchInsert(client, 't_042', ['customer_id', 'game_id', 'added_at'], wishRows)

    await client.query('COMMIT')
    console.log(`\nNebula sembrada (seed=42): ${gameIds.length} juegos, ${customerIds.length} clientes, ${sessionIds.length} sesiones, ${invoiceIds.length} facturas, ${reviewIds.length} reseñas, ${wishRows.length} deseos.`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
