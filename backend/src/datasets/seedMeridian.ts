/**
 * Seeder LIGERO y reproducible para Meridian (BD objetivo de dominio nuevo).
 *
 * Meridian es un ERP de distribución mayorista B2B (~41 tablas), un dominio a
 * propósito distinto del de arcadia/nebula (videojuegos): sirve para comprobar si
 * el schema-linking y la generación de SQL generalizan a un esquema que el LLM no
 * ha "visto". Igual que en nebula, los volúmenes son PEQUEÑOS (cientos de filas):
 * lo que valido es la resolución pregunta→SQL y la execution accuracy del golden
 * set, no un volumen realista.
 *
 * Uso (desde backend/):
 *   npm run seed:meridian              # puebla la BD meridian (mismo Postgres local)
 *   npm run seed:meridian -- --reset   # recrea el esquema (schema.sql) antes de poblar
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

// --- PRNG reproducible (igual que los seeders de Arcadia y Nebula) ----------------
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
  money(a: number, b: number): number {
    return Math.round(this.uniform(a, b) * 100) / 100
  }
  choice<T>(array: T[]): T {
    return array[Math.floor(this.rng() * array.length)]
  }
  choices<T>(array: T[], weights: number[]): T {
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
const N_EMPLOYEES = 40
const N_BRANDS = 15
const N_PRODUCTS = 200
const N_SUPPLIERS = 30
const N_CUSTOMERS = 120
const N_PURCHASE_ORDERS = 150
const N_SALES_ORDERS = 400
const N_STOCK_MOVEMENTS = 1000
const N_RETURNS = 60
const N_INVENTORY_COUNTS = 15

const DATA_START = new Date(2023, 0, 1)
const TODAY = new Date(2026, 6, 1)

// --- Catálogos fijos (incluyen los literales que pide el golden set) -------------
// [name, iso_code, region] — 'Spain' (ES) existe para las preguntas por país.
const COUNTRIES: [string, string, string][] = [
  ['Spain', 'ES', 'EMEA'], ['France', 'FR', 'EMEA'], ['Germany', 'DE', 'EMEA'],
  ['United Kingdom', 'GB', 'EMEA'], ['Italy', 'IT', 'EMEA'], ['Portugal', 'PT', 'EMEA'],
  ['Netherlands', 'NL', 'EMEA'], ['United States', 'US', 'AMER'], ['Mexico', 'MX', 'AMER'],
  ['Brazil', 'BR', 'AMER'], ['Canada', 'CA', 'AMER'], ['Japan', 'JP', 'APAC'],
  ['China', 'CN', 'APAC'], ['Australia', 'AU', 'APAC'], ['India', 'IN', 'APAC'],
]
// [code, name] — EUR y USD existen seguro (preguntas por moneda).
const CURRENCIES: [string, string][] = [['EUR', 'Euro'], ['USD', 'US Dollar'], ['GBP', 'British Pound'], ['JPY', 'Japanese Yen']]
// [name, percentage] — 'Standard' 21% existe seguro.
const TAX_RATES: [string, number][] = [['Standard', 21], ['Reduced', 10], ['Super-reduced', 4], ['Zero', 0]]
const UOMS: [string, string][] = [['EA', 'Each'], ['BOX', 'Box'], ['KG', 'Kilogram'], ['L', 'Litre'], ['PAL', 'Pallet']]
// [name, days] — 'Net 30' existe seguro.
const PAYMENT_TERMS: [string, number][] = [['Immediate', 0], ['Net 15', 15], ['Net 30', 30], ['Net 60', 60], ['Net 90', 90]]
const DEPARTMENTS = ['Sales', 'Purchasing', 'Warehouse', 'Finance', 'IT', 'Customer Service']
const WAREHOUSE_CITIES: [string, string][] = [
  ['Madrid Central', 'Madrid'], ['Barcelona Port', 'Barcelona'], ['Lisbon Hub', 'Lisbon'],
  ['Paris North', 'Paris'], ['Hamburg Dock', 'Hamburg'],
]
const ZONE_KINDS = ['picking', 'bulk', 'returns', 'quarantine']
const SALES_REGIONS = ['Iberia', 'Central Europe', 'Northern Europe', 'Americas', 'APAC']
// Categorías: [padre, [hijas...]]. 'Beverages' existe seguro.
const CATEGORY_TREE: [string, string[]][] = [
  ['Beverages', ['Soft Drinks', 'Water', 'Juices', 'Coffee & Tea']],
  ['Food', ['Snacks', 'Canned Goods', 'Frozen', 'Bakery']],
  ['Household', ['Cleaning', 'Paper Goods', 'Kitchenware']],
  ['Electronics', ['Cables', 'Batteries', 'Small Appliances']],
  ['Office Supplies', ['Paper', 'Writing', 'Filing']],
  ['Health & Beauty', ['Personal Care', 'First Aid']],
]
const CARRIERS: [string, string][] = [
  ['Swift Logistics', 'https://track.swiftlog.example/'],
  ['BluePath Freight', 'https://bluepath.example/track/'],
  ['CargoLink', 'https://cargolink.example/t/'],
  ['Meridian Express', 'https://mex.example/track/'],
  ['NorthWind Parcel', 'https://northwind.example/'],
]
const PO_STATUS = ['draft', 'sent', 'received', 'cancelled']
const SO_STATUS = ['open', 'confirmed', 'shipped', 'invoiced', 'cancelled']
const SHIPMENT_STATUS = ['pending', 'in_transit', 'delivered', 'returned']
const INVOICE_STATUS = ['issued', 'paid', 'overdue', 'cancelled']
const RETURN_REASONS = ['damaged', 'wrong_item', 'overstock', 'expired']
const RETURN_CONDITIONS = ['resellable', 'damaged', 'scrap']
const PAYMENT_METHODS = ['transfer', 'card', 'direct_debit', 'cheque']
const MOVEMENT_TYPES = ['receipt', 'shipment', 'adjustment', 'transfer']
const BRAND_STEM = ['Aurora', 'Vantage', 'Northgate', 'Solara', 'Ridgeway', 'Crestline', 'Bluewave', 'Ironclad', 'Meadow', 'Summit', 'Palermo', 'Delano', 'Everest', 'Cobalt', 'Harbor']

// --- Helpers ---------------------------------------------------------------------
function randomDate(start: Date, end: Date, rng: SeededRandom): Date {
  return new Date(start.getTime() + Math.floor(rng.random() * (end.getTime() - start.getTime() + 1)))
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
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

/**
 * Conexión a la BD `meridian`. A diferencia del seeder de Nebula (acoplado a
 * TARGET_DB_2_*), aquí uso las credenciales POSTGRES_* del mismo instance y fijo el
 * nombre de la BD: el número de catálogo de meridian varía (TARGET_DB_3 en el
 * .env.example, más adelante en un .env que ya tenga otras BDs propias), así que
 * atarlo a un índice sería frágil. Estas credenciales son las del mismo Postgres
 * donde viven arcadia y nebula, siempre correctas en local.
 */
function connect(): Client {
  return new Client({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432'),
    database: 'meridian',
    user: process.env.POSTGRES_USER ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? 'postgres',
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
      await client.query(readFileSync(join(__dirname, '../../../setup/datasets/meridian/schema.sql'), 'utf-8'))
      console.log('· esquema recreado (schema.sql)')
    }
    await client.query('BEGIN')

    // --- Catálogos de referencia -------------------------------------------------
    const countryIds = await batchInsert(client, 'country', ['name', 'iso_code', 'region'], COUNTRIES, { returning: 'country_id' })
    const spainId = countryIds[COUNTRIES.findIndex(([, iso]) => iso === 'ES')]
    const currencyIds = await batchInsert(client, 'currency', ['code', 'name'], CURRENCIES, { returning: 'currency_id' })
    const eurId = currencyIds[CURRENCIES.findIndex(([code]) => code === 'EUR')]
    const usdId = currencyIds[CURRENCIES.findIndex(([code]) => code === 'USD')]
    const taxIds = await batchInsert(client, 'tax_rate', ['name', 'percentage'], TAX_RATES.map(([n, p]) => [n, p]), { returning: 'tax_rate_id' })
    const uomIds = await batchInsert(client, 'unit_of_measure', ['code', 'name'], UOMS, { returning: 'uom_id' })
    const termIds = await batchInsert(client, 'payment_term', ['name', 'days'], PAYMENT_TERMS.map(([n, d]) => [n, d]), { returning: 'payment_term_id' })

    // --- Organización interna ----------------------------------------------------
    const departmentIds = await batchInsert(client, 'department', ['name'], DEPARTMENTS.map((d) => [d]), { returning: 'department_id' })
    const salesDeptId = departmentIds[DEPARTMENTS.indexOf('Sales')]
    const employeeDeptOf: number[] = []
    const employeeRows = Array.from({ length: N_EMPLOYEES }, (_, i) => {
      const deptId = rng.choice(departmentIds)
      employeeDeptOf.push(deptId)
      const first = faker.person.firstName()
      const last = faker.person.lastName()
      return [first, last, `${first}.${last}.${i}@meridian.example`.toLowerCase(), deptId, isoDate(randomDate(new Date(2015, 0, 1), TODAY, rng)), rng.random() > 0.08]
    })
    const employeeIds = await batchInsert(client, 'employee', ['first_name', 'last_name', 'email', 'department_id', 'hired_on', 'is_active'], employeeRows, { returning: 'employee_id' })

    const warehouseIds = await batchInsert(
      client, 'warehouse', ['name', 'country_id', 'city', 'manager_id'],
      WAREHOUSE_CITIES.map(([name, city], i) => [name, countryIds[i % countryIds.length], city, rng.choice(employeeIds)]),
      { returning: 'warehouse_id' },
    )
    // Fuerzo que el primer almacén sea 'Madrid Central' en España (preguntas por almacén/país).
    await client.query('UPDATE warehouse SET country_id = $1 WHERE warehouse_id = $2', [spainId, warehouseIds[0]])

    await batchInsert(
      client, 'warehouse_zone', ['warehouse_id', 'code', 'kind'],
      warehouseIds.flatMap((w) => ZONE_KINDS.map((kind, i) => [w, `${kind.slice(0, 1).toUpperCase()}-${String(i + 1).padStart(2, '0')}`, kind])),
    )

    // Comerciales: empleados del departamento de ventas (garantizo al menos 8).
    const salesEmployees = employeeIds.filter((_, i) => employeeDeptOf[i] === salesDeptId)
    const repEmployees = salesEmployees.length >= 8 ? salesEmployees : rng.sample(employeeIds, 8)
    const salesRepIds = await batchInsert(
      client, 'sales_rep', ['employee_id', 'region', 'commission_pct'],
      repEmployees.map((e, i) => [e, SALES_REGIONS[i % SALES_REGIONS.length], rng.money(2, 8)]),
      { returning: 'sales_rep_id' },
    )

    // --- Catálogo de producto ----------------------------------------------------
    const parentCategoryIds = await batchInsert(client, 'product_category', ['name', 'parent_category_id'], CATEGORY_TREE.map(([name]) => [name, null]), { returning: 'category_id' })
    const beveragesId = parentCategoryIds[CATEGORY_TREE.findIndex(([name]) => name === 'Beverages')]
    const childCategoryIds: number[] = []
    const childToParent = new Map<number, number>()
    for (let p = 0; p < CATEGORY_TREE.length; p++) {
      const [, children] = CATEGORY_TREE[p]
      const ids = await batchInsert(client, 'product_category', ['name', 'parent_category_id'], children.map((c) => [c, parentCategoryIds[p]]), { returning: 'category_id' })
      ids.forEach((id) => {
        childCategoryIds.push(id)
        childToParent.set(id, parentCategoryIds[p])
      })
    }

    const brandIds = await batchInsert(
      client, 'brand', ['name', 'country_id'],
      Array.from({ length: N_BRANDS }, (_, i) => [`${BRAND_STEM[i % BRAND_STEM.length]} ${rng.choice(['Foods', 'Goods', 'Labs', 'Group', 'Trading'])}`, rng.choice(countryIds)]),
      { returning: 'brand_id' },
    )

    const productCatOf: number[] = []
    const productPriceOf: number[] = []
    const productRows = Array.from({ length: N_PRODUCTS }, (_, i) => {
      const categoryId = rng.choice(childCategoryIds)
      productCatOf.push(categoryId)
      const basePrice = rng.money(1.5, 250)
      productPriceOf.push(basePrice)
      return [
        `SKU-${String(1000 + i)}`,
        `${faker.commerce.productAdjective()} ${faker.commerce.product()}`,
        categoryId,
        rng.random() < 0.85 ? rng.choice(brandIds) : null,
        rng.choice(uomIds),
        rng.choices(taxIds, [0.6, 0.25, 0.1, 0.05]),
        rng.money(0.05, 25),
        rng.random() > 0.05,
      ]
    })
    const productIds = await batchInsert(
      client, 'product',
      ['sku', 'name', 'category_id', 'brand_id', 'uom_id', 'tax_rate_id', 'weight_kg', 'is_active'],
      productRows, { returning: 'product_id' },
    )

    // Variantes: ~30% de los productos tienen 2-3 variantes.
    const variantRows: unknown[][] = []
    let variantSeq = 0
    for (const p of rng.sample(productIds, Math.floor(productIds.length * 0.3))) {
      for (const label of rng.sample(['500ml', '1L', 'Small', 'Large', 'Pack of 6', 'Pack of 12'], rng.randint(2, 3))) {
        variantRows.push([p, `VAR-${String(5000 + variantSeq++)}`, label, String(rng.randint(1000000000000, 9999999999999)), rng.money(0, 15)])
      }
    }
    await batchInsert(client, 'product_variant', ['product_id', 'sku', 'label', 'barcode', 'extra_price'], variantRows)

    // Tarifas: una en EUR (la principal) y una en USD (export).
    const priceListIds = await batchInsert(
      client, 'price_list', ['name', 'currency_id', 'valid_from', 'valid_to'],
      [
        ['Retail EUR 2026', eurId, isoDate(new Date(2026, 0, 1)), null],
        ['Export USD 2026', usdId, isoDate(new Date(2026, 0, 1)), null],
        ['Retail EUR 2025', eurId, isoDate(new Date(2025, 0, 1)), isoDate(new Date(2025, 11, 31))],
      ],
      { returning: 'price_list_id' },
    )
    const priceItemRows: unknown[][] = []
    for (const pl of priceListIds) {
      for (const [idx, p] of productIds.entries()) {
        if (rng.random() < 0.8) priceItemRows.push([pl, p, Math.round(productPriceOf[idx] * rng.uniform(1.1, 1.6) * 100) / 100])
      }
    }
    await batchInsert(client, 'price_list_item', ['price_list_id', 'product_id', 'unit_price'], priceItemRows)

    // --- Proveedores -------------------------------------------------------------
    const supplierIds = await batchInsert(
      client, 'supplier', ['name', 'country_id', 'payment_term_id', 'currency_id', 'is_active'],
      Array.from({ length: N_SUPPLIERS }, () => [`${faker.company.name()}`, rng.choice(countryIds), rng.choice(termIds), rng.choice(currencyIds), rng.random() > 0.1]),
      { returning: 'supplier_id' },
    )
    // Fuerzo unos cuantos proveedores a España para tener un literal de país estable y
    // no nulo en el golden set (pregunta "¿cuántos proveedores en España?"). Es un ajuste
    // dirigido POSTERIOR al muestreo aleatorio, así que no desplaza el resto del stream
    // (misma idea que Nebula garantizando la plataforma "PC" o el audio en español).
    await client.query('UPDATE supplier SET country_id = $1 WHERE supplier_id = ANY($2::int[])', [spainId, supplierIds.slice(0, 5)])
    await batchInsert(
      client, 'supplier_contact', ['supplier_id', 'name', 'email', 'phone', 'role'],
      supplierIds.flatMap((s) => rng.sample(['Sales', 'Logistics', 'Billing'], rng.randint(1, 2)).map((role) => [s, faker.person.fullName(), faker.internet.email(), faker.phone.number(), role])),
    )
    // product_supplier: cada producto lo surten 1-2 proveedores.
    const psSeen = new Set<string>()
    const psRows: unknown[][] = []
    for (const [idx, p] of productIds.entries()) {
      for (const s of rng.sample(supplierIds, rng.randint(1, 2))) {
        const key = `${p}-${s}`
        if (!psSeen.has(key)) {
          psSeen.add(key)
          psRows.push([p, s, `S-${rng.randint(10000, 99999)}`, rng.randint(3, 30), Math.round(productPriceOf[idx] * rng.uniform(0.55, 0.8) * 100) / 100])
        }
      }
    }
    await batchInsert(client, 'product_supplier', ['product_id', 'supplier_id', 'supplier_sku', 'lead_time_days', 'cost_price'], psRows)

    // --- Órdenes de compra + recepciones -----------------------------------------
    const poDates: Date[] = []
    const poStatuses: string[] = []
    const poRows = Array.from({ length: N_PURCHASE_ORDERS }, () => {
      const orderDate = randomDate(DATA_START, TODAY, rng)
      const status = rng.choices(PO_STATUS, [0.1, 0.25, 0.55, 0.1])
      poDates.push(orderDate)
      poStatuses.push(status)
      return [rng.choice(supplierIds), rng.choice(warehouseIds), rng.choice(employeeIds), rng.choice(currencyIds), isoDate(orderDate), isoDate(addDays(orderDate, rng.randint(5, 45))), status]
    })
    const poIds = await batchInsert(client, 'purchase_order', ['supplier_id', 'warehouse_id', 'ordered_by', 'currency_id', 'order_date', 'expected_date', 'status'], poRows, { returning: 'po_id' })

    // Líneas de compra, recordando (po, product) para las recepciones.
    const poLineMeta: { poLineId: number; poIdx: number; productId: number; qty: number }[] = []
    const poLineRows: unknown[][] = []
    const poLineOwner: number[] = []
    for (let i = 0; i < poIds.length; i++) {
      const lineProducts = rng.sample(productIds, rng.randint(1, 5))
      for (const productId of lineProducts) {
        poLineRows.push([poIds[i], productId, rng.randint(10, 500), rng.money(0.5, 180)])
        poLineOwner.push(i)
      }
    }
    const poLineIds = await batchInsert(client, 'purchase_order_line', ['po_id', 'product_id', 'quantity', 'unit_cost'], poLineRows, { returning: 'po_line_id' })
    poLineIds.forEach((id, k) => poLineMeta.push({ poLineId: id, poIdx: poLineOwner[k], productId: poLineRows[k][1] as number, qty: poLineRows[k][2] as number }))

    // Recepciones para las PO en estado 'received'.
    const receivedPoIdx = poIds.map((_, i) => i).filter((i) => poStatuses[i] === 'received')
    const receiptOfPo = new Map<number, number>()
    const receiptRows = receivedPoIdx.map((i) => [poIds[i], poRows[i][1], isoDate(addDays(poDates[i], rng.randint(3, 40))), rng.choice(employeeIds)])
    const receiptIds = await batchInsert(client, 'goods_receipt', ['po_id', 'warehouse_id', 'received_on', 'received_by'], receiptRows, { returning: 'receipt_id' })
    receivedPoIdx.forEach((poIdx, k) => receiptOfPo.set(poIdx, receiptIds[k]))
    const receiptLineRows = poLineMeta
      .filter((m) => receiptOfPo.has(m.poIdx))
      .map((m) => [receiptOfPo.get(m.poIdx), m.poLineId, m.productId, Math.floor(m.qty * rng.uniform(0.9, 1))])
    await batchInsert(client, 'goods_receipt_line', ['receipt_id', 'po_line_id', 'product_id', 'quantity_received'], receiptLineRows)

    // --- Inventario --------------------------------------------------------------
    // Existencias: para cada almacén, un subconjunto de productos con nivel.
    const stockRows: unknown[][] = []
    for (const w of warehouseIds) {
      for (const p of rng.sample(productIds, Math.floor(productIds.length * 0.7))) {
        const onHand = rng.randint(0, 800)
        stockRows.push([w, p, onHand, Math.min(onHand, rng.randint(0, 120))])
      }
    }
    await batchInsert(client, 'stock_level', ['warehouse_id', 'product_id', 'quantity_on_hand', 'quantity_reserved'], stockRows)

    await batchInsert(
      client, 'stock_movement', ['warehouse_id', 'product_id', 'quantity', 'movement_type', 'reference', 'moved_at'],
      Array.from({ length: N_STOCK_MOVEMENTS }, () => {
        const type = rng.choice(MOVEMENT_TYPES)
        const qty = type === 'shipment' || (type === 'adjustment' && rng.random() < 0.5) ? -rng.randint(1, 200) : rng.randint(1, 200)
        return [rng.choice(warehouseIds), rng.choice(productIds), qty, type, `${type.slice(0, 2).toUpperCase()}-${rng.randint(1000, 9999)}`, randomDate(DATA_START, TODAY, rng)]
      }),
    )

    const countIds = await batchInsert(
      client, 'inventory_count', ['warehouse_id', 'counted_on', 'status', 'counted_by'],
      Array.from({ length: N_INVENTORY_COUNTS }, () => [rng.choice(warehouseIds), isoDate(randomDate(DATA_START, TODAY, rng)), rng.choices(['open', 'closed'], [0.3, 0.7]), rng.choice(employeeIds)]),
      { returning: 'count_id' },
    )
    await batchInsert(
      client, 'inventory_count_line', ['count_id', 'product_id', 'expected_qty', 'counted_qty'],
      countIds.flatMap((c) => rng.sample(productIds, rng.randint(5, 15)).map((p) => {
        const expected = rng.randint(0, 500)
        return [c, p, expected, Math.max(0, expected + rng.randint(-10, 10))]
      })),
    )

    // --- Clientes ----------------------------------------------------------------
    const customerCountryOf: number[] = []
    const customerRows = Array.from({ length: N_CUSTOMERS }, () => {
      const countryId = rng.choice(countryIds)
      customerCountryOf.push(countryId)
      return [faker.company.name(), countryId, rng.choice(salesRepIds), rng.choice(termIds), rng.money(2000, 80000), rng.random() > 0.1, randomDate(DATA_START, TODAY, rng)]
    })
    const customerIds = await batchInsert(client, 'customer', ['name', 'country_id', 'sales_rep_id', 'payment_term_id', 'credit_limit', 'is_active', 'created_at'], customerRows, { returning: 'customer_id' })

    const shipAddressOf = new Map<number, number>()
    const addressRows: unknown[][] = []
    const addressOwner: number[] = []
    for (const [i, c] of customerIds.entries()) {
      // Siempre una de envío y una de facturación.
      for (const kind of ['shipping', 'billing']) {
        addressRows.push([c, kind, faker.location.streetAddress(), faker.location.city(), faker.location.zipCode(), customerCountryOf[i]])
        addressOwner.push(i)
      }
    }
    const addressIds = await batchInsert(client, 'customer_address', ['customer_id', 'kind', 'line1', 'city', 'postal_code', 'country_id'], addressRows, { returning: 'address_id' })
    // Primera dirección de envío por cliente (las pares de índice: shipping va primero).
    addressIds.forEach((id, k) => {
      const custIdx = addressOwner[k]
      if (!shipAddressOf.has(customerIds[custIdx]) && addressRows[k][1] === 'shipping') shipAddressOf.set(customerIds[custIdx], id)
    })
    await batchInsert(
      client, 'customer_contact', ['customer_id', 'name', 'email', 'phone', 'role'],
      customerIds.flatMap((c) => rng.sample(['Buyer', 'Accounts payable', 'Warehouse'], rng.randint(1, 2)).map((role) => [c, faker.person.fullName(), faker.internet.email(), faker.phone.number(), role])),
    )
    const salesRepOfCustomer = new Map<number, number>()
    customerIds.forEach((c, i) => salesRepOfCustomer.set(c, customerRows[i][2] as number))

    // --- Ventas ------------------------------------------------------------------
    const soDates: Date[] = []
    const soStatuses: string[] = []
    const soCustomer: number[] = []
    const soRows = customerIds.length > 0 ? Array.from({ length: N_SALES_ORDERS }, () => {
      const customerId = rng.choice(customerIds)
      const orderDate = randomDate(DATA_START, TODAY, rng)
      const status = rng.choices(SO_STATUS, [0.15, 0.2, 0.25, 0.3, 0.1])
      soDates.push(orderDate)
      soStatuses.push(status)
      soCustomer.push(customerId)
      return [customerId, salesRepOfCustomer.get(customerId) ?? null, rng.choice(currencyIds), shipAddressOf.get(customerId) ?? null, isoDate(orderDate), isoDate(addDays(orderDate, rng.randint(2, 20))), status]
    }) : []
    const orderIds = await batchInsert(client, 'sales_order', ['customer_id', 'sales_rep_id', 'currency_id', 'ship_address_id', 'order_date', 'requested_date', 'status'], soRows, { returning: 'order_id' })

    const orderLineMeta: { orderLineId: number; orderIdx: number; productId: number; qty: number }[] = []
    const soLineRows: unknown[][] = []
    const soLineOwner: number[] = []
    for (let i = 0; i < orderIds.length; i++) {
      for (const productId of rng.sample(productIds, rng.randint(1, 6))) {
        const idx = productIds.indexOf(productId)
        soLineRows.push([orderIds[i], productId, rng.randint(1, 60), Math.round(productPriceOf[idx] * rng.uniform(1.1, 1.6) * 100) / 100, rng.choices([0, 5, 10, 15], [0.6, 0.2, 0.15, 0.05])])
        soLineOwner.push(i)
      }
    }
    const orderLineIds = await batchInsert(client, 'sales_order_line', ['order_id', 'product_id', 'quantity', 'unit_price', 'discount_pct'], soLineRows, { returning: 'order_line_id' })
    orderLineIds.forEach((id, k) => orderLineMeta.push({ orderLineId: id, orderIdx: soLineOwner[k], productId: soLineRows[k][1] as number, qty: soLineRows[k][2] as number }))

    // --- Envíos ------------------------------------------------------------------
    const carrierIds = await batchInsert(client, 'carrier', ['name', 'tracking_url'], CARRIERS, { returning: 'carrier_id' })
    // Envío para las órdenes 'shipped' o 'invoiced'.
    const shippableOrderIdx = orderIds.map((_, i) => i).filter((i) => soStatuses[i] === 'shipped' || soStatuses[i] === 'invoiced')
    const shipmentOfOrder = new Map<number, number>()
    const shipmentRows = shippableOrderIdx.map((i) => {
      const status = rng.choices(SHIPMENT_STATUS, [0.05, 0.2, 0.7, 0.05])
      return [orderIds[i], rng.choice(warehouseIds), rng.choice(carrierIds), isoDate(addDays(soDates[i], rng.randint(1, 10))), `TRK${rng.randint(100000, 999999)}`, status]
    })
    const shipmentIds = await batchInsert(client, 'shipment', ['order_id', 'warehouse_id', 'carrier_id', 'shipped_on', 'tracking_number', 'status'], shipmentRows, { returning: 'shipment_id' })
    shippableOrderIdx.forEach((orderIdx, k) => shipmentOfOrder.set(orderIdx, shipmentIds[k]))
    const shipmentLineRows = orderLineMeta
      .filter((m) => shipmentOfOrder.has(m.orderIdx))
      .map((m) => [shipmentOfOrder.get(m.orderIdx), m.orderLineId, m.productId, m.qty])
    await batchInsert(client, 'shipment_line', ['shipment_id', 'order_line_id', 'product_id', 'quantity'], shipmentLineRows)

    // --- Devoluciones ------------------------------------------------------------
    // Devoluciones sobre órdenes ya enviadas/facturadas.
    const returnableOrderIdx = shippableOrderIdx.length > 0 ? rng.sample(shippableOrderIdx, Math.min(N_RETURNS, shippableOrderIdx.length)) : []
    const returnRows = returnableOrderIdx.map((i) => [orderIds[i], soCustomer[i], isoDate(addDays(soDates[i], rng.randint(5, 30))), rng.choice(RETURN_REASONS), rng.choices(['requested', 'approved', 'received', 'refunded'], [0.2, 0.2, 0.3, 0.3])])
    const returnIds = await batchInsert(client, 'return_order', ['order_id', 'customer_id', 'requested_on', 'reason', 'status'], returnRows, { returning: 'return_id' })
    await batchInsert(
      client, 'return_line', ['return_id', 'product_id', 'quantity', 'condition'],
      returnIds.flatMap((r) => rng.sample(productIds, rng.randint(1, 3)).map((p) => [r, p, rng.randint(1, 10), rng.choice(RETURN_CONDITIONS)])),
    )

    // --- Facturación y cobros ----------------------------------------------------
    // Factura para las órdenes 'invoiced' (importe = suma de sus líneas con IVA aparte).
    const invoicedOrderIdx = orderIds.map((_, i) => i).filter((i) => soStatuses[i] === 'invoiced')
    const orderTotal = new Map<number, number>()
    for (const m of orderLineMeta) {
      const line = soLineRows[orderLineIds.indexOf(m.orderLineId)]
      const gross = (line[2] as number) * (line[3] as number) * (1 - (line[4] as number) / 100)
      orderTotal.set(m.orderIdx, (orderTotal.get(m.orderIdx) ?? 0) + gross)
    }
    const invoiceOrderMeta: { invoiceIdx: number; orderIdx: number; customerId: number }[] = []
    const invoiceRows = invoicedOrderIdx.map((i, k) => {
      const issued = addDays(soDates[i], rng.randint(1, 8))
      const status = rng.choices(INVOICE_STATUS, [0.2, 0.55, 0.2, 0.05])
      invoiceOrderMeta.push({ invoiceIdx: k, orderIdx: i, customerId: soCustomer[i] })
      return [soCustomer[i], orderIds[i], soRows[i][2], isoDate(issued), isoDate(addDays(issued, 30)), Math.round((orderTotal.get(i) ?? 0) * 100) / 100, status]
    })
    const invoiceIds = await batchInsert(client, 'invoice', ['customer_id', 'order_id', 'currency_id', 'issued_on', 'due_on', 'total', 'status'], invoiceRows, { returning: 'invoice_id' })

    // Líneas de factura copiadas de las líneas de la orden.
    const invoiceLineRows: unknown[][] = []
    for (const meta of invoiceOrderMeta) {
      const invoiceId = invoiceIds[meta.invoiceIdx]
      for (const m of orderLineMeta.filter((ol) => ol.orderIdx === meta.orderIdx)) {
        const line = soLineRows[orderLineIds.indexOf(m.orderLineId)]
        const idx = productIds.indexOf(m.productId)
        invoiceLineRows.push([invoiceId, m.productId, `${productRows[idx][1]}`, line[2], line[3], rng.choice(taxIds)])
      }
    }
    await batchInsert(client, 'invoice_line', ['invoice_id', 'product_id', 'description', 'quantity', 'unit_price', 'tax_rate_id'], invoiceLineRows)

    // Cobros: uno por cada factura pagada, aplicado íntegramente a esa factura.
    const paidInvoiceMeta = invoiceRows.map((r, k) => ({ k, status: r[6] as string, customerId: r[0] as number, total: r[5] as number, issued: r[3] as string }))
      .filter((m) => m.status === 'paid')
    const paymentRows = paidInvoiceMeta.map((m) => [m.customerId, isoDate(addDays(new Date(m.issued), rng.randint(3, 45))), m.total, rng.choice(PAYMENT_METHODS)])
    const paymentIds = await batchInsert(client, 'payment', ['customer_id', 'paid_on', 'amount', 'method'], paymentRows, { returning: 'payment_id' })
    await batchInsert(
      client, 'payment_allocation', ['payment_id', 'invoice_id', 'amount'],
      paidInvoiceMeta.map((m, k) => [paymentIds[k], invoiceIds[m.k], m.total]),
    )

    await client.query('COMMIT')
    console.log(
      `\nMeridian sembrada (seed=42): ${productIds.length} productos, ${supplierIds.length} proveedores, ` +
      `${customerIds.length} clientes, ${poIds.length} compras, ${orderIds.length} ventas, ` +
      `${invoiceIds.length} facturas, ${returnIds.length} devoluciones.`,
    )
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
