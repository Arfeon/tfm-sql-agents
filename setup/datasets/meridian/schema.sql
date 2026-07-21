-- =====================================================================
-- Meridian — BD objetivo de DOMINIO NUEVO (validación de generalización)
-- =====================================================================
-- Dominio: ERP de DISTRIBUCIÓN MAYORISTA B2B (comercio al por mayor).
--          Compras a proveedores, inventario multi-almacén, ventas a
--          clientes empresa, envíos con transportista, devoluciones y
--          facturación con cobros. NO son videojuegos: arcadia y nebula
--          son ambas del universo "games/media", así que un dominio ERP
--          distinto mide si el schema-linking y la generación de SQL
--          generalizan más allá del dominio ya conocido.
--
-- Propósito: banco de pruebas de tamaño MEDIO (~41 tablas, entre las 17 de
--            arcadia y las 66 de nebula) con claves foráneas reales y datos
--            sembrados (seed=42), para medir schema-linking recall Y
--            execution accuracy sobre un esquema que el LLM no ha "visto".
--
-- Convenciones (iguales que arcadia/nebula):
--   * Esquema y datos en INGLÉS; las preguntas del golden set, en ESPAÑOL.
--   * Nombres totalmente sintéticos. Solo PostgreSQL. SERIAL PK, FKs explícitas.
--   * DDL con un usuario con permisos; el agente consulta en SOLO LECTURA.
--   * Recreo el esquema de cero (DROP SCHEMA): el init corre en BD vacía y el
--     seeder con --reset lo reejecuta, así que quiero un punto de partida limpio.
-- =====================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- ---------------------------------------------------------------------
-- 1. Catálogos de referencia (sin FK)
-- ---------------------------------------------------------------------
CREATE TABLE country (
    country_id SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    iso_code   TEXT NOT NULL UNIQUE,
    region     TEXT NOT NULL              -- macro-región comercial (EMEA, AMER, APAC…)
);

CREATE TABLE currency (
    currency_id SERIAL PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,     -- ISO 4217: EUR, USD, GBP…
    name        TEXT NOT NULL
);

CREATE TABLE tax_rate (
    tax_rate_id SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,            -- "Standard", "Reduced", "Zero"…
    percentage  NUMERIC(5,2) NOT NULL     -- 21.00, 10.00, 0.00
);

CREATE TABLE unit_of_measure (
    uom_id SERIAL PRIMARY KEY,
    code   TEXT NOT NULL UNIQUE,          -- EA, BOX, KG, L, PAL…
    name   TEXT NOT NULL
);

CREATE TABLE payment_term (
    payment_term_id SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,        -- "Net 30", "Net 60", "Immediate"…
    days            INT  NOT NULL         -- días hasta el vencimiento
);

-- ---------------------------------------------------------------------
-- 2. Organización interna (empleados, almacenes, comerciales)
-- ---------------------------------------------------------------------
CREATE TABLE department (
    department_id SERIAL PRIMARY KEY,
    name          TEXT NOT NULL
);

CREATE TABLE employee (
    employee_id   SERIAL PRIMARY KEY,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    department_id INT  NOT NULL REFERENCES department(department_id),
    hired_on      DATE NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE warehouse (
    warehouse_id SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    country_id   INT  NOT NULL REFERENCES country(country_id),
    city         TEXT NOT NULL,
    manager_id   INT  REFERENCES employee(employee_id)   -- responsable del almacén
);

-- Zonas físicas dentro de un almacén (no confundir con la región comercial del país
-- ni con el territorio de un comercial: aquí es picking/bulk/returns).
CREATE TABLE warehouse_zone (
    zone_id      SERIAL PRIMARY KEY,
    warehouse_id INT  NOT NULL REFERENCES warehouse(warehouse_id),
    code         TEXT NOT NULL,           -- "A-01", "BULK-3"…
    kind         TEXT NOT NULL            -- picking | bulk | returns | quarantine
);

-- Comercial: un empleado que además lleva una cartera de clientes en una región.
CREATE TABLE sales_rep (
    sales_rep_id   SERIAL PRIMARY KEY,
    employee_id    INT NOT NULL UNIQUE REFERENCES employee(employee_id),
    region         TEXT NOT NULL,         -- territorio comercial asignado
    commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- 3. Catálogo de producto
-- ---------------------------------------------------------------------
-- Categorías jerárquicas (parent_category_id self-FK): "Beverages" > "Soft drinks".
CREATE TABLE product_category (
    category_id        SERIAL PRIMARY KEY,
    name               TEXT NOT NULL,
    parent_category_id INT REFERENCES product_category(category_id)
);

CREATE TABLE brand (
    brand_id   SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    country_id INT REFERENCES country(country_id)     -- país de origen de la marca
);

CREATE TABLE product (
    product_id  SERIAL PRIMARY KEY,
    sku         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    category_id INT  NOT NULL REFERENCES product_category(category_id),
    brand_id    INT  REFERENCES brand(brand_id),
    uom_id      INT  NOT NULL REFERENCES unit_of_measure(uom_id),
    tax_rate_id INT  NOT NULL REFERENCES tax_rate(tax_rate_id),
    weight_kg   NUMERIC(10,3),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Variantes de un producto (talla/color/formato). SKU propio distinto del padre.
CREATE TABLE product_variant (
    variant_id  SERIAL PRIMARY KEY,
    product_id  INT  NOT NULL REFERENCES product(product_id),
    sku         TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,           -- "500ml", "XL / Blue"…
    barcode     TEXT,
    extra_price NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Tarifas de venta: una lista de precios por moneda y periodo de validez.
CREATE TABLE price_list (
    price_list_id SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    currency_id   INT  NOT NULL REFERENCES currency(currency_id),
    valid_from    DATE NOT NULL,
    valid_to      DATE
);

CREATE TABLE price_list_item (
    price_list_item_id SERIAL PRIMARY KEY,
    price_list_id      INT NOT NULL REFERENCES price_list(price_list_id),
    product_id         INT NOT NULL REFERENCES product(product_id),
    unit_price         NUMERIC(12,2) NOT NULL,
    UNIQUE (price_list_id, product_id)
);

-- ---------------------------------------------------------------------
-- 4. Proveedores y compras
-- ---------------------------------------------------------------------
CREATE TABLE supplier (
    supplier_id     SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    country_id      INT  NOT NULL REFERENCES country(country_id),
    payment_term_id INT  REFERENCES payment_term(payment_term_id),
    currency_id     INT  NOT NULL REFERENCES currency(currency_id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE supplier_contact (
    contact_id  SERIAL PRIMARY KEY,
    supplier_id INT  NOT NULL REFERENCES supplier(supplier_id),
    name        TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    role        TEXT                     -- "Sales", "Logistics", "Billing"…
);

-- Qué proveedor surte qué producto, con su SKU, plazo y coste (M:N).
CREATE TABLE product_supplier (
    product_supplier_id SERIAL PRIMARY KEY,
    product_id          INT NOT NULL REFERENCES product(product_id),
    supplier_id         INT NOT NULL REFERENCES supplier(supplier_id),
    supplier_sku        TEXT,
    lead_time_days      INT NOT NULL DEFAULT 7,
    cost_price          NUMERIC(12,2) NOT NULL,
    UNIQUE (product_id, supplier_id)
);

CREATE TABLE purchase_order (
    po_id         SERIAL PRIMARY KEY,
    supplier_id   INT  NOT NULL REFERENCES supplier(supplier_id),
    warehouse_id  INT  NOT NULL REFERENCES warehouse(warehouse_id),  -- almacén de entrega
    ordered_by    INT  REFERENCES employee(employee_id),
    currency_id   INT  NOT NULL REFERENCES currency(currency_id),
    order_date    DATE NOT NULL,
    expected_date DATE,
    status        TEXT NOT NULL DEFAULT 'draft'   -- draft | sent | received | cancelled
);

CREATE TABLE purchase_order_line (
    po_line_id SERIAL PRIMARY KEY,
    po_id      INT NOT NULL REFERENCES purchase_order(po_id),
    product_id INT NOT NULL REFERENCES product(product_id),
    quantity   INT NOT NULL,
    unit_cost  NUMERIC(12,2) NOT NULL
);

-- Recepción de mercancía contra una orden de compra.
CREATE TABLE goods_receipt (
    receipt_id  SERIAL PRIMARY KEY,
    po_id       INT  NOT NULL REFERENCES purchase_order(po_id),
    warehouse_id INT NOT NULL REFERENCES warehouse(warehouse_id),
    received_on DATE NOT NULL,
    received_by INT  REFERENCES employee(employee_id)
);

CREATE TABLE goods_receipt_line (
    receipt_line_id   SERIAL PRIMARY KEY,
    receipt_id        INT NOT NULL REFERENCES goods_receipt(receipt_id),
    po_line_id        INT NOT NULL REFERENCES purchase_order_line(po_line_id),
    product_id        INT NOT NULL REFERENCES product(product_id),
    quantity_received INT NOT NULL
);

-- ---------------------------------------------------------------------
-- 5. Inventario
-- ---------------------------------------------------------------------
-- Existencias por almacén y producto (una fila por par). reserved = comprometido
-- por pedidos de venta aún no enviados; disponible = on_hand - reserved.
CREATE TABLE stock_level (
    stock_level_id    SERIAL PRIMARY KEY,
    warehouse_id      INT NOT NULL REFERENCES warehouse(warehouse_id),
    product_id        INT NOT NULL REFERENCES product(product_id),
    quantity_on_hand  INT NOT NULL DEFAULT 0,
    quantity_reserved INT NOT NULL DEFAULT 0,
    UNIQUE (warehouse_id, product_id)
);

-- Diario de movimientos de stock (entradas, salidas, ajustes, traspasos).
CREATE TABLE stock_movement (
    movement_id   SERIAL PRIMARY KEY,
    warehouse_id  INT NOT NULL REFERENCES warehouse(warehouse_id),
    product_id    INT NOT NULL REFERENCES product(product_id),
    quantity      INT NOT NULL,            -- positivo entra, negativo sale
    movement_type TEXT NOT NULL,           -- receipt | shipment | adjustment | transfer
    reference     TEXT,                    -- documento origen ("PO-123", "SO-456"…)
    moved_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_count (
    count_id     SERIAL PRIMARY KEY,
    warehouse_id INT  NOT NULL REFERENCES warehouse(warehouse_id),
    counted_on   DATE NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',   -- open | closed
    counted_by   INT  REFERENCES employee(employee_id)
);

CREATE TABLE inventory_count_line (
    count_line_id SERIAL PRIMARY KEY,
    count_id      INT NOT NULL REFERENCES inventory_count(count_id),
    product_id    INT NOT NULL REFERENCES product(product_id),
    expected_qty  INT NOT NULL,
    counted_qty   INT NOT NULL
);

-- ---------------------------------------------------------------------
-- 6. Clientes
-- ---------------------------------------------------------------------
CREATE TABLE customer (
    customer_id     SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    country_id      INT  NOT NULL REFERENCES country(country_id),
    sales_rep_id    INT  REFERENCES sales_rep(sales_rep_id),
    payment_term_id INT  REFERENCES payment_term(payment_term_id),
    credit_limit    NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_address (
    address_id  SERIAL PRIMARY KEY,
    customer_id INT  NOT NULL REFERENCES customer(customer_id),
    kind        TEXT NOT NULL,           -- billing | shipping
    line1       TEXT NOT NULL,
    city        TEXT NOT NULL,
    postal_code TEXT,
    country_id  INT  NOT NULL REFERENCES country(country_id)
);

CREATE TABLE customer_contact (
    contact_id  SERIAL PRIMARY KEY,
    customer_id INT  NOT NULL REFERENCES customer(customer_id),
    name        TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    role        TEXT                     -- "Buyer", "Accounts payable"…
);

-- ---------------------------------------------------------------------
-- 7. Ventas
-- ---------------------------------------------------------------------
CREATE TABLE sales_order (
    order_id        SERIAL PRIMARY KEY,
    customer_id     INT  NOT NULL REFERENCES customer(customer_id),
    sales_rep_id    INT  REFERENCES sales_rep(sales_rep_id),
    currency_id     INT  NOT NULL REFERENCES currency(currency_id),
    ship_address_id INT  REFERENCES customer_address(address_id),
    order_date      DATE NOT NULL,
    requested_date  DATE,
    status          TEXT NOT NULL DEFAULT 'open'   -- open | confirmed | shipped | invoiced | cancelled
);

CREATE TABLE sales_order_line (
    order_line_id SERIAL PRIMARY KEY,
    order_id      INT NOT NULL REFERENCES sales_order(order_id),
    product_id    INT NOT NULL REFERENCES product(product_id),
    quantity      INT NOT NULL,
    unit_price    NUMERIC(12,2) NOT NULL,
    discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- 8. Envíos
-- ---------------------------------------------------------------------
CREATE TABLE carrier (
    carrier_id   SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    tracking_url TEXT
);

CREATE TABLE shipment (
    shipment_id     SERIAL PRIMARY KEY,
    order_id        INT  NOT NULL REFERENCES sales_order(order_id),
    warehouse_id    INT  NOT NULL REFERENCES warehouse(warehouse_id),  -- desde qué almacén sale
    carrier_id      INT  REFERENCES carrier(carrier_id),
    shipped_on      DATE,
    tracking_number TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'   -- pending | in_transit | delivered | returned
);

CREATE TABLE shipment_line (
    shipment_line_id SERIAL PRIMARY KEY,
    shipment_id      INT NOT NULL REFERENCES shipment(shipment_id),
    order_line_id    INT NOT NULL REFERENCES sales_order_line(order_line_id),
    product_id       INT NOT NULL REFERENCES product(product_id),
    quantity         INT NOT NULL
);

-- ---------------------------------------------------------------------
-- 9. Devoluciones
-- ---------------------------------------------------------------------
CREATE TABLE return_order (
    return_id    SERIAL PRIMARY KEY,
    order_id     INT  NOT NULL REFERENCES sales_order(order_id),
    customer_id  INT  NOT NULL REFERENCES customer(customer_id),
    requested_on DATE NOT NULL,
    reason       TEXT,                    -- damaged | wrong_item | overstock | expired
    status       TEXT NOT NULL DEFAULT 'requested'   -- requested | approved | received | refunded
);

CREATE TABLE return_line (
    return_line_id SERIAL PRIMARY KEY,
    return_id      INT NOT NULL REFERENCES return_order(return_id),
    product_id     INT NOT NULL REFERENCES product(product_id),
    quantity       INT NOT NULL,
    condition      TEXT                   -- resellable | damaged | scrap
);

-- ---------------------------------------------------------------------
-- 10. Facturación y cobros
-- ---------------------------------------------------------------------
CREATE TABLE invoice (
    invoice_id  SERIAL PRIMARY KEY,
    customer_id INT  NOT NULL REFERENCES customer(customer_id),
    order_id    INT  REFERENCES sales_order(order_id),
    currency_id INT  NOT NULL REFERENCES currency(currency_id),
    issued_on   DATE NOT NULL,
    due_on      DATE,
    total       NUMERIC(12,2) NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'issued'   -- issued | paid | overdue | cancelled
);

CREATE TABLE invoice_line (
    invoice_line_id SERIAL PRIMARY KEY,
    invoice_id      INT NOT NULL REFERENCES invoice(invoice_id),
    product_id      INT REFERENCES product(product_id),
    description     TEXT NOT NULL,
    quantity        INT NOT NULL,
    unit_price      NUMERIC(12,2) NOT NULL,
    tax_rate_id     INT REFERENCES tax_rate(tax_rate_id)
);

CREATE TABLE payment (
    payment_id  SERIAL PRIMARY KEY,
    customer_id INT  NOT NULL REFERENCES customer(customer_id),
    paid_on     DATE NOT NULL,
    amount      NUMERIC(12,2) NOT NULL,
    method      TEXT NOT NULL            -- transfer | card | direct_debit | cheque
);

-- Aplicación de un cobro a una factura (un pago puede saldar varias facturas).
CREATE TABLE payment_allocation (
    allocation_id SERIAL PRIMARY KEY,
    payment_id    INT NOT NULL REFERENCES payment(payment_id),
    invoice_id    INT NOT NULL REFERENCES invoice(invoice_id),
    amount        NUMERIC(12,2) NOT NULL
);
