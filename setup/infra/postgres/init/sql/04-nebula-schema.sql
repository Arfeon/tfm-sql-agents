-- =====================================================================
-- Nebula — BD objetivo GRANDE para la prueba de escala (SPEC-17)
-- =====================================================================
-- Dominio: universo extendido de Arcadia — una plataforma de videojuegos/medios
--          con catálogo, comercio, telemetría, social, reseñas, eventos y soporte.
-- Propósito: NO es un dataset de negocio, es un banco de pruebas de ESCALA. ~66
--            tablas con claves foráneas reales, para medir cómo crece el contexto
--            del LLM con el tamaño del esquema (17 tablas de Arcadia → ~66 aquí).
--
-- Convenciones (iguales que Arcadia): esquema en INGLÉS, nombres sintéticos, solo
-- PostgreSQL, SERIAL PK, FKs explícitas. Las tablas pueden ir vacías: la prueba de
-- escala mide tamaño de contexto y schema-linking recall, que salen del DDL y las FKs.
-- Se conserva el motivo de la tabla de nombre OPACO (t_042 = lista de deseos).
-- =====================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- ---------------------------------------------------------------------
-- Dimensiones base (sin FK)
-- ---------------------------------------------------------------------
CREATE TABLE company (
    company_id   SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    country      TEXT NOT NULL,
    founded_year INT  NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE genre (
    genre_id SERIAL PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE
);

CREATE TABLE platform (
    platform_id  SERIAL PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    manufacturer TEXT NOT NULL,
    kind         TEXT NOT NULL
);

CREATE TABLE region (
    region_id SERIAL PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    currency  TEXT NOT NULL
);

CREATE TABLE language (
    language_id SERIAL PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL
);

CREATE TABLE age_rating_board (
    board_id SERIAL PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    region   TEXT NOT NULL
);

CREATE TABLE tag (
    tag_id SERIAL PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE
);

CREATE TABLE subscription_plan (
    plan_id                SERIAL PRIMARY KEY,
    name                   TEXT NOT NULL UNIQUE,
    monthly_price          NUMERIC(6,2) NOT NULL,
    max_concurrent_streams INT NOT NULL,
    includes_dlc           BOOLEAN NOT NULL
);

CREATE TABLE payment_provider (
    provider_id SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL
);

CREATE TABLE device_type (
    device_type_id SERIAL PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    category       TEXT NOT NULL
);

CREATE TABLE achievement_category (
    category_id SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE
);

CREATE TABLE faq_category (
    faq_category_id SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------
-- Nivel 2: dependen de las dimensiones
-- ---------------------------------------------------------------------
CREATE TABLE franchise (
    franchise_id     SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    owner_company_id INT  NOT NULL REFERENCES company(company_id),
    debut_year       INT  NOT NULL
);

CREATE TABLE studio (
    studio_id  SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    company_id INT  NOT NULL REFERENCES company(company_id),
    country    TEXT NOT NULL,
    headcount  INT  NOT NULL
);

CREATE TABLE country (
    country_id SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    region_id  INT  NOT NULL REFERENCES region(region_id),
    iso_code   TEXT NOT NULL UNIQUE
);

CREATE TABLE game (
    game_id              SERIAL PRIMARY KEY,
    title                TEXT NOT NULL,
    developer_company_id INT  NOT NULL REFERENCES company(company_id),
    publisher_company_id INT  NOT NULL REFERENCES company(company_id),
    franchise_id         INT  REFERENCES franchise(franchise_id),
    board_id             INT  REFERENCES age_rating_board(board_id),
    release_date         DATE NOT NULL,
    base_price           NUMERIC(6,2) NOT NULL,
    age_rating           TEXT NOT NULL
);

CREATE TABLE customer (
    customer_id SERIAL PRIMARY KEY,
    username    TEXT NOT NULL,
    email       TEXT NOT NULL,
    region_id   INT  NOT NULL REFERENCES region(region_id),
    country_id  INT  REFERENCES country(country_id),
    signup_date DATE NOT NULL,
    birth_year  INT  NOT NULL
);

CREATE TABLE bundle (
    bundle_id       SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    publisher_id    INT  NOT NULL REFERENCES company(company_id),
    price           NUMERIC(6,2) NOT NULL,
    release_date    DATE NOT NULL
);

CREATE TABLE subscription (
    subscription_id SERIAL PRIMARY KEY,
    customer_id     INT  NOT NULL REFERENCES customer(customer_id),
    plan_id         INT  NOT NULL REFERENCES subscription_plan(plan_id),
    start_date      DATE NOT NULL,
    end_date        DATE,
    status          TEXT NOT NULL,
    monthly_price   NUMERIC(6,2) NOT NULL
);

CREATE TABLE payment_method (
    payment_method_id SERIAL PRIMARY KEY,
    customer_id       INT  NOT NULL REFERENCES customer(customer_id),
    provider_id       INT  NOT NULL REFERENCES payment_provider(provider_id),
    last4             TEXT NOT NULL,
    is_default        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE device (
    device_id      SERIAL PRIMARY KEY,
    customer_id    INT  NOT NULL REFERENCES customer(customer_id),
    device_type_id INT  NOT NULL REFERENCES device_type(device_type_id),
    label          TEXT NOT NULL,
    last_seen_at   TIMESTAMP
);

CREATE TABLE customer_profile (
    customer_id  INT PRIMARY KEY REFERENCES customer(customer_id),
    display_name TEXT NOT NULL,
    bio          TEXT,
    avatar_url   TEXT,
    is_public    BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- Catálogo del juego (M:N y contenido)
-- ---------------------------------------------------------------------
CREATE TABLE game_genre (
    game_id  INT NOT NULL REFERENCES game(game_id),
    genre_id INT NOT NULL REFERENCES genre(genre_id),
    PRIMARY KEY (game_id, genre_id)
);

CREATE TABLE game_platform (
    game_id      INT NOT NULL REFERENCES game(game_id),
    platform_id  INT NOT NULL REFERENCES platform(platform_id),
    release_date DATE NOT NULL,
    PRIMARY KEY (game_id, platform_id)
);

CREATE TABLE game_tag (
    game_id INT NOT NULL REFERENCES game(game_id),
    tag_id  INT NOT NULL REFERENCES tag(tag_id),
    PRIMARY KEY (game_id, tag_id)
);

CREATE TABLE game_language (
    game_id     INT NOT NULL REFERENCES game(game_id),
    language_id INT NOT NULL REFERENCES language(language_id),
    kind        TEXT NOT NULL,                 -- 'audio' | 'subtitles' | 'interface'
    PRIMARY KEY (game_id, language_id, kind)
);

CREATE TABLE game_media (
    media_id SERIAL PRIMARY KEY,
    game_id  INT  NOT NULL REFERENCES game(game_id),
    kind     TEXT NOT NULL,                    -- 'screenshot' | 'trailer' | 'artwork'
    url      TEXT NOT NULL
);

CREATE TABLE game_edition (
    edition_id SERIAL PRIMARY KEY,
    game_id    INT  NOT NULL REFERENCES game(game_id),
    name       TEXT NOT NULL,                  -- Standard, Deluxe, Collector's
    price      NUMERIC(6,2) NOT NULL
);

CREATE TABLE soundtrack (
    soundtrack_id SERIAL PRIMARY KEY,
    game_id       INT  NOT NULL REFERENCES game(game_id),
    title         TEXT NOT NULL,
    track_count   INT  NOT NULL
);

CREATE TABLE dlc (
    dlc_id       SERIAL PRIMARY KEY,
    game_id      INT  NOT NULL REFERENCES game(game_id),
    title        TEXT NOT NULL,
    release_date DATE NOT NULL,
    price        NUMERIC(6,2) NOT NULL
);

CREATE TABLE bundle_game (
    bundle_id INT NOT NULL REFERENCES bundle(bundle_id),
    game_id   INT NOT NULL REFERENCES game(game_id),
    PRIMARY KEY (bundle_id, game_id)
);

-- ---------------------------------------------------------------------
-- Logros y clasificaciones
-- ---------------------------------------------------------------------
CREATE TABLE achievement (
    achievement_id SERIAL PRIMARY KEY,
    game_id        INT  NOT NULL REFERENCES game(game_id),
    category_id    INT  REFERENCES achievement_category(category_id),
    name           TEXT NOT NULL,
    points         INT  NOT NULL
);

CREATE TABLE leaderboard (
    leaderboard_id SERIAL PRIMARY KEY,
    game_id        INT  NOT NULL REFERENCES game(game_id),
    name           TEXT NOT NULL,
    metric         TEXT NOT NULL                -- 'score' | 'time' | 'kills'
);

-- ---------------------------------------------------------------------
-- Telemetría de uso
-- ---------------------------------------------------------------------
CREATE TABLE play_session (
    session_id       BIGSERIAL PRIMARY KEY,
    customer_id      INT NOT NULL REFERENCES customer(customer_id),
    game_id          INT NOT NULL REFERENCES game(game_id),
    platform_id      INT NOT NULL REFERENCES platform(platform_id),
    device_id        INT REFERENCES device(device_id),
    started_at       TIMESTAMP NOT NULL,
    duration_minutes INT NOT NULL
);

CREATE TABLE session_event (
    event_id   BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES play_session(session_id),
    kind       TEXT NOT NULL,
    occurred_at TIMESTAMP NOT NULL
);

CREATE TABLE save_game (
    save_id     SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    game_id     INT NOT NULL REFERENCES game(game_id),
    slot        INT NOT NULL,
    updated_at  TIMESTAMP NOT NULL
);

CREATE TABLE crash_report (
    crash_id    BIGSERIAL PRIMARY KEY,
    session_id  BIGINT NOT NULL REFERENCES play_session(session_id),
    device_id   INT REFERENCES device(device_id),
    message     TEXT NOT NULL,
    occurred_at TIMESTAMP NOT NULL
);

CREATE TABLE leaderboard_entry (
    entry_id       BIGSERIAL PRIMARY KEY,
    leaderboard_id INT NOT NULL REFERENCES leaderboard(leaderboard_id),
    customer_id    INT NOT NULL REFERENCES customer(customer_id),
    value          NUMERIC(12,2) NOT NULL,
    recorded_at    TIMESTAMP NOT NULL
);

CREATE TABLE customer_achievement (
    customer_id    INT NOT NULL REFERENCES customer(customer_id),
    achievement_id INT NOT NULL REFERENCES achievement(achievement_id),
    unlocked_at    TIMESTAMP NOT NULL,
    PRIMARY KEY (customer_id, achievement_id)
);

-- ---------------------------------------------------------------------
-- Comercio y facturación
-- ---------------------------------------------------------------------
CREATE TABLE invoice (
    invoice_id        SERIAL PRIMARY KEY,
    customer_id       INT  NOT NULL REFERENCES customer(customer_id),
    payment_method_id INT  REFERENCES payment_method(payment_method_id),
    issued_at         TIMESTAMP NOT NULL,
    total             NUMERIC(8,2) NOT NULL,
    status            TEXT NOT NULL
);

CREATE TABLE invoice_line (
    invoice_line_id SERIAL PRIMARY KEY,
    invoice_id      INT NOT NULL REFERENCES invoice(invoice_id),
    game_id         INT REFERENCES game(game_id),
    dlc_id          INT REFERENCES dlc(dlc_id),
    description     TEXT NOT NULL,
    amount          NUMERIC(8,2) NOT NULL
);

CREATE TABLE coupon (
    coupon_id       SERIAL PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    plan_id         INT REFERENCES subscription_plan(plan_id),
    discount_pct    INT NOT NULL,
    valid_until     DATE
);

CREATE TABLE coupon_redemption (
    redemption_id SERIAL PRIMARY KEY,
    coupon_id     INT NOT NULL REFERENCES coupon(coupon_id),
    customer_id   INT NOT NULL REFERENCES customer(customer_id),
    invoice_id    INT REFERENCES invoice(invoice_id),
    redeemed_at   TIMESTAMP NOT NULL
);

CREATE TABLE gift_card (
    gift_card_id  SERIAL PRIMARY KEY,
    purchaser_id  INT NOT NULL REFERENCES customer(customer_id),
    balance       NUMERIC(8,2) NOT NULL,
    issued_at     DATE NOT NULL
);

CREATE TABLE refund (
    refund_id   SERIAL PRIMARY KEY,
    invoice_id  INT NOT NULL REFERENCES invoice(invoice_id),
    amount      NUMERIC(8,2) NOT NULL,
    reason      TEXT NOT NULL,
    refunded_at TIMESTAMP NOT NULL
);

CREATE TABLE purchase (
    purchase_id   SERIAL PRIMARY KEY,
    customer_id   INT  NOT NULL REFERENCES customer(customer_id),
    dlc_id        INT  NOT NULL REFERENCES dlc(dlc_id),
    purchase_date DATE NOT NULL,
    amount        NUMERIC(6,2) NOT NULL
);

-- ---------------------------------------------------------------------
-- Social
-- ---------------------------------------------------------------------
CREATE TABLE friendship (
    customer_id   INT NOT NULL REFERENCES customer(customer_id),
    friend_id     INT NOT NULL REFERENCES customer(customer_id),
    since         DATE NOT NULL,
    PRIMARY KEY (customer_id, friend_id)
);

CREATE TABLE follow (
    follower_id INT NOT NULL REFERENCES customer(customer_id),
    followed_id INT NOT NULL REFERENCES customer(customer_id),
    since       DATE NOT NULL,
    PRIMARY KEY (follower_id, followed_id)
);

CREATE TABLE chat_room (
    chat_room_id SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    game_id      INT REFERENCES game(game_id),
    created_at   TIMESTAMP NOT NULL
);

CREATE TABLE chat_membership (
    chat_room_id INT NOT NULL REFERENCES chat_room(chat_room_id),
    customer_id  INT NOT NULL REFERENCES customer(customer_id),
    joined_at    TIMESTAMP NOT NULL,
    PRIMARY KEY (chat_room_id, customer_id)
);

CREATE TABLE message (
    message_id   BIGSERIAL PRIMARY KEY,
    chat_room_id INT NOT NULL REFERENCES chat_room(chat_room_id),
    sender_id    INT NOT NULL REFERENCES customer(customer_id),
    body         TEXT NOT NULL,
    sent_at      TIMESTAMP NOT NULL
);

CREATE TABLE activity_feed (
    activity_id BIGSERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    kind        TEXT NOT NULL,
    payload     TEXT,
    created_at  TIMESTAMP NOT NULL
);

-- ---------------------------------------------------------------------
-- Reseñas y moderación
-- ---------------------------------------------------------------------
CREATE TABLE review (
    review_id   SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    game_id     INT NOT NULL REFERENCES game(game_id),
    title       TEXT NOT NULL,
    body        TEXT,
    posted_at   DATE NOT NULL
);

CREATE TABLE review_vote (
    review_id   INT NOT NULL REFERENCES review(review_id),
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    is_helpful  BOOLEAN NOT NULL,
    PRIMARY KEY (review_id, customer_id)
);

CREATE TABLE rating (
    rating_id   SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    game_id     INT NOT NULL REFERENCES game(game_id),
    score       INT NOT NULL CHECK (score BETWEEN 1 AND 5),
    rated_at    DATE NOT NULL,
    UNIQUE (customer_id, game_id)
);

CREATE TABLE report (
    report_id   SERIAL PRIMARY KEY,
    reporter_id INT NOT NULL REFERENCES customer(customer_id),
    review_id   INT REFERENCES review(review_id),
    reason      TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL
);

CREATE TABLE ban (
    ban_id      SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    reason      TEXT NOT NULL,
    banned_at   DATE NOT NULL,
    until        DATE
);

-- ---------------------------------------------------------------------
-- Eventos y torneos
-- ---------------------------------------------------------------------
CREATE TABLE tournament (
    tournament_id SERIAL PRIMARY KEY,
    game_id       INT  NOT NULL REFERENCES game(game_id),
    name          TEXT NOT NULL,
    starts_at     DATE NOT NULL,
    prize_pool    NUMERIC(10,2) NOT NULL
);

CREATE TABLE tournament_participant (
    tournament_id INT NOT NULL REFERENCES tournament(tournament_id),
    customer_id   INT NOT NULL REFERENCES customer(customer_id),
    seed          INT,
    PRIMARY KEY (tournament_id, customer_id)
);

CREATE TABLE event (
    event_id   SERIAL PRIMARY KEY,
    region_id  INT  NOT NULL REFERENCES region(region_id),
    name       TEXT NOT NULL,
    held_on    DATE NOT NULL,
    venue      TEXT
);

CREATE TABLE event_registration (
    registration_id SERIAL PRIMARY KEY,
    event_id        INT NOT NULL REFERENCES event(event_id),
    customer_id     INT NOT NULL REFERENCES customer(customer_id),
    registered_at   TIMESTAMP NOT NULL
);

-- ---------------------------------------------------------------------
-- Soporte
-- ---------------------------------------------------------------------
CREATE TABLE support_ticket (
    ticket_id   SERIAL PRIMARY KEY,
    customer_id INT  NOT NULL REFERENCES customer(customer_id),
    subject     TEXT NOT NULL,
    status      TEXT NOT NULL,
    opened_at   TIMESTAMP NOT NULL
);

CREATE TABLE ticket_message (
    ticket_message_id BIGSERIAL PRIMARY KEY,
    ticket_id         INT NOT NULL REFERENCES support_ticket(ticket_id),
    author_id         INT REFERENCES customer(customer_id),
    body              TEXT NOT NULL,
    sent_at           TIMESTAMP NOT NULL
);

CREATE TABLE faq (
    faq_id          SERIAL PRIMARY KEY,
    faq_category_id INT  NOT NULL REFERENCES faq_category(faq_category_id),
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- Telemetría agregada y lista de deseos (nombre OPACO: t_042)
-- ---------------------------------------------------------------------
CREATE TABLE concurrent_snapshot (
    snapshot_id        BIGSERIAL PRIMARY KEY,
    game_id            INT NOT NULL REFERENCES game(game_id),
    region_id          INT NOT NULL REFERENCES region(region_id),
    captured_at        TIMESTAMP NOT NULL,
    concurrent_players INT NOT NULL
);

-- Lista de deseos. El nombre no delata su contenido: caso de schema-linking por
-- descripción, igual que en Arcadia.
CREATE TABLE t_042 (
    id          SERIAL PRIMARY KEY,
    customer_id INT  NOT NULL REFERENCES customer(customer_id),
    game_id     INT  NOT NULL REFERENCES game(game_id),
    added_at    DATE NOT NULL,
    UNIQUE (customer_id, game_id)
);
