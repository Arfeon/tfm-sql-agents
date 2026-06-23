-- =====================================================================
-- Arcadia — esquema de la base de datos objetivo (BD-propia, decisión D-03)
-- =====================================================================
-- Dominio: plataforma de suscripción de videojuegos en streaming
--          ("Netflix de videojuegos"). Catálogo de juegos incluidos en
--          la suscripción + compras puntuales de DLC + telemetría de uso.
--
-- Convenciones:
--   * Esquema y datos en INGLÉS; las preguntas del golden set, en ESPAÑOL
--     (caso multilingüe del TFM).
--   * Nombres totalmente sintéticos (no son juegos/compañías reales).
--   * Solo PostgreSQL. Ejecutar con un usuario con permisos de DDL; el agente
--     consultará con un usuario de SOLO LECTURA distinto (seguridad por diseño).
-- =====================================================================

DROP TABLE IF EXISTS concurrent_snapshot CASCADE;
DROP TABLE IF EXISTS rating CASCADE;
DROP TABLE IF EXISTS play_session CASCADE;
DROP TABLE IF EXISTS purchase CASCADE;
DROP TABLE IF EXISTS subscription CASCADE;
DROP TABLE IF EXISTS customer CASCADE;
DROP TABLE IF EXISTS subscription_plan CASCADE;
DROP TABLE IF EXISTS region CASCADE;
DROP TABLE IF EXISTS dlc CASCADE;
DROP TABLE IF EXISTS game_platform CASCADE;
DROP TABLE IF EXISTS game_genre CASCADE;
DROP TABLE IF EXISTS platform CASCADE;
DROP TABLE IF EXISTS genre CASCADE;
DROP TABLE IF EXISTS game CASCADE;
DROP TABLE IF EXISTS franchise CASCADE;
DROP TABLE IF EXISTS company CASCADE;

-- ---------------------------------------------------------------------
-- Catálogo: compañías, franquicias, juegos y sus dimensiones
-- ---------------------------------------------------------------------

-- Estudios y editoras. La misma compañía puede desarrollar y/o editar juegos.
CREATE TABLE company (
    company_id   SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    country      TEXT NOT NULL,           -- país de la sede
    founded_year INT  NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- Sagas / propiedades intelectuales (p. ej. una serie de juegos).
CREATE TABLE franchise (
    franchise_id     SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    owner_company_id INT  NOT NULL REFERENCES company(company_id),
    debut_year       INT  NOT NULL
);

-- Juego del catálogo. La desarrolladora y la editora pueden ser distintas.
CREATE TABLE game (
    game_id               SERIAL PRIMARY KEY,
    title                 TEXT NOT NULL,
    developer_company_id  INT  NOT NULL REFERENCES company(company_id),
    publisher_company_id  INT  NOT NULL REFERENCES company(company_id),
    franchise_id          INT  REFERENCES franchise(franchise_id),  -- NULL = juego independiente
    release_date          DATE NOT NULL,
    added_to_catalog_date DATE NOT NULL,                            -- alta en la suscripción
    base_price            NUMERIC(6,2) NOT NULL,                    -- precio de compra fuera de suscripción
    age_rating            TEXT NOT NULL                             -- E, E10, T, M
);

CREATE TABLE genre (
    genre_id SERIAL PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE
);

-- Plataforma de juego. kind permite distinguir consola / pc / cloud / handheld.
CREATE TABLE platform (
    platform_id  SERIAL PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    manufacturer TEXT NOT NULL,
    kind         TEXT NOT NULL          -- 'console' | 'pc' | 'cloud' | 'handheld'
);

-- M:N juego <-> género
CREATE TABLE game_genre (
    game_id  INT NOT NULL REFERENCES game(game_id),
    genre_id INT NOT NULL REFERENCES genre(genre_id),
    PRIMARY KEY (game_id, genre_id)
);

-- M:N juego <-> plataforma (con fecha de lanzamiento por plataforma)
CREATE TABLE game_platform (
    game_id      INT NOT NULL REFERENCES game(game_id),
    platform_id  INT NOT NULL REFERENCES platform(platform_id),
    release_date DATE NOT NULL,
    PRIMARY KEY (game_id, platform_id)
);

-- Contenido descargable de pago asociado a un juego (ingreso no-suscripción).
CREATE TABLE dlc (
    dlc_id       SERIAL PRIMARY KEY,
    game_id      INT  NOT NULL REFERENCES game(game_id),
    title        TEXT NOT NULL,
    release_date DATE NOT NULL,
    price        NUMERIC(6,2) NOT NULL
);

-- ---------------------------------------------------------------------
-- Negocio: regiones, planes, clientes y suscripciones
-- ---------------------------------------------------------------------

CREATE TABLE region (
    region_id SERIAL PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,   -- North America, Europe, LATAM, ...
    currency  TEXT NOT NULL           -- USD, EUR, ...
);

CREATE TABLE subscription_plan (
    plan_id                SERIAL PRIMARY KEY,
    name                   TEXT NOT NULL UNIQUE,   -- Basic, Standard, Premium
    monthly_price          NUMERIC(6,2) NOT NULL,
    max_concurrent_streams INT NOT NULL,
    includes_dlc           BOOLEAN NOT NULL        -- el plan da DLC gratis
);

CREATE TABLE customer (
    customer_id SERIAL PRIMARY KEY,
    username    TEXT NOT NULL,
    email       TEXT NOT NULL,
    region_id   INT  NOT NULL REFERENCES region(region_id),
    signup_date DATE NOT NULL,
    birth_year  INT  NOT NULL
);

-- Una fila por alta de suscripción. Un cliente puede tener varias a lo largo
-- del tiempo (churn y re-alta). end_date NULL = sigue activa.
CREATE TABLE subscription (
    subscription_id SERIAL PRIMARY KEY,
    customer_id     INT  NOT NULL REFERENCES customer(customer_id),
    plan_id         INT  NOT NULL REFERENCES subscription_plan(plan_id),
    start_date      DATE NOT NULL,
    end_date        DATE,                              -- NULL = activa
    status          TEXT NOT NULL,                     -- 'active' | 'cancelled' | 'paused'
    monthly_price   NUMERIC(6,2) NOT NULL              -- precio congelado en el alta (para MRR histórico)
);

-- Compra puntual de un DLC por un cliente (ingreso adicional a la suscripción).
CREATE TABLE purchase (
    purchase_id   SERIAL PRIMARY KEY,
    customer_id   INT  NOT NULL REFERENCES customer(customer_id),
    dlc_id        INT  NOT NULL REFERENCES dlc(dlc_id),
    purchase_date DATE NOT NULL,
    amount        NUMERIC(6,2) NOT NULL
);

-- ---------------------------------------------------------------------
-- Telemetría de uso
-- ---------------------------------------------------------------------

-- Una fila por sesión de juego de un cliente.
CREATE TABLE play_session (
    session_id       BIGSERIAL PRIMARY KEY,
    customer_id      INT NOT NULL REFERENCES customer(customer_id),
    game_id          INT NOT NULL REFERENCES game(game_id),
    platform_id      INT NOT NULL REFERENCES platform(platform_id),
    started_at       TIMESTAMP NOT NULL,
    duration_minutes INT NOT NULL
);

-- Valoración de un cliente a un juego (1-5). Única por (cliente, juego).
CREATE TABLE rating (
    rating_id   SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    game_id     INT NOT NULL REFERENCES game(game_id),
    score       INT NOT NULL CHECK (score BETWEEN 1 AND 5),
    rated_at    DATE NOT NULL,
    UNIQUE (customer_id, game_id)
);

-- Foto periódica del número de jugadores concurrentes por juego y región
-- (el equivalente a "espectadores simultáneos" de Netflix).
CREATE TABLE concurrent_snapshot (
    snapshot_id        BIGSERIAL PRIMARY KEY,
    game_id            INT NOT NULL REFERENCES game(game_id),
    region_id          INT NOT NULL REFERENCES region(region_id),
    captured_at        TIMESTAMP NOT NULL,
    concurrent_players INT NOT NULL
);

-- ---------------------------------------------------------------------
-- Índices sobre las FK más consultadas (rendimiento de los JOIN del agente)
-- ---------------------------------------------------------------------
CREATE INDEX idx_game_developer   ON game(developer_company_id);
CREATE INDEX idx_game_publisher   ON game(publisher_company_id);
CREATE INDEX idx_game_franchise   ON game(franchise_id);
CREATE INDEX idx_dlc_game         ON dlc(game_id);
CREATE INDEX idx_sub_customer     ON subscription(customer_id);
CREATE INDEX idx_sub_plan         ON subscription(plan_id);
CREATE INDEX idx_purchase_dlc     ON purchase(dlc_id);
CREATE INDEX idx_purchase_cust    ON purchase(customer_id);
CREATE INDEX idx_session_game     ON play_session(game_id);
CREATE INDEX idx_session_customer ON play_session(customer_id);
CREATE INDEX idx_rating_game      ON rating(game_id);
CREATE INDEX idx_snapshot_game    ON concurrent_snapshot(game_id);
CREATE INDEX idx_snapshot_region  ON concurrent_snapshot(region_id);
