-- seed.sql — the e-commerce dataset under study (AgDR-0005 ERD).
--
-- Included by bootstrap.sql via `\ir`, executed under `SET ROLE arena_runner`
-- so every table is OWNED BY arena_runner. Ownership (not a mere GRANT) is what
-- lets contestants `CREATE INDEX` on these tables — the core mechanic of
-- AgDR-0004. On Postgres 16/17/18, CREATE INDEX requires table ownership; the
-- PG17 MAINTAIN privilege does NOT cover it.
--
-- Tables are PK-only, NO secondary indexes — the missing-index slowness is the
-- whole point of the exercise. FK *columns* are present but there are NO FK
-- *constraints* (AgDR-0005: they don't add indexes but slow COPY / couple load
-- order). `IF NOT EXISTS` keeps this file re-runnable: the per-submission reset
-- (AgDR-0004) re-executes it at runtime, and `db:bootstrap` may be re-applied.

CREATE TABLE IF NOT EXISTS seed.category (
  category_id   integer PRIMARY KEY,
  category_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS seed.product (
  product_id     integer PRIMARY KEY,
  category_id    integer NOT NULL,        -- FK column → seed.category (no constraint)
  name           text NOT NULL,
  description    text,
  price          numeric(12, 2) NOT NULL,
  stock_quantity integer NOT NULL
);

CREATE TABLE IF NOT EXISTS seed.customer (
  customer_id   integer PRIMARY KEY,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL
);

-- `orders` (not the reserved word `order`).
CREATE TABLE IF NOT EXISTS seed.orders (
  order_id     bigint PRIMARY KEY,
  customer_id  integer NOT NULL,          -- FK column → seed.customer (no constraint)
  order_date   timestamptz NOT NULL,
  total_amount numeric(14, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS seed.order_details (
  order_details_id bigint PRIMARY KEY,
  product_id       integer NOT NULL,      -- FK column → seed.product (no constraint)
  order_id         bigint NOT NULL,       -- FK column → seed.orders  (no constraint)
  quantity         integer NOT NULL,
  unit_price       numeric(12, 2) NOT NULL
);
