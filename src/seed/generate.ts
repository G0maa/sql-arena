/**
 * Faker CSV generator for the `seed` schema (AgDR-0005, loader in AgDR-0007).
 *
 * Pure file output — no database connection. Streams five CSVs to `generated/`
 * with **sequential integer IDs** so foreign-key columns are plain integers (no
 * id maps). All randomness is routed through faker and seeded with `SEED_RANDOM`
 * so a given knob set reproduces byte-identical CSVs. Orders + their details are
 * emitted in a single pass with a running detail-id counter, so the millions of
 * detail rows never materialise in memory — only a `productPrices` lookup
 * (~one float per product) is held.
 *
 * Run:  npm run db:seed:generate           (full target scale — see knobs)
 *       SEED_PRODUCTS=500 ... npm run db:seed:generate   (small, for local checks)
 *
 * The generated CSVs double as the per-submission reset baseline (AgDR-0004).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { faker } from '@faker-js/faker';
import { CsvWriter, type CsvValue } from './csv';

// --- Scale knobs (defaults = full target; lower via env for local validation) ---
const NUM_CATEGORIES = Number(process.env.SEED_CATEGORIES ?? 100);
const NUM_CUSTOMERS = Number(process.env.SEED_CUSTOMERS ?? 1_000_000);
const NUM_PRODUCTS = Number(process.env.SEED_PRODUCTS ?? 100_000);
const NUM_ORDERS = Number(process.env.SEED_ORDERS ?? 1_000_000);
const MAX_DETAILS_PER_ORDER = Number(process.env.SEED_MAX_DETAILS ?? 5);
const SEED = Number(process.env.SEED_RANDOM ?? 42);

// Fixed reference date so `faker.date.past` is deterministic — otherwise it
// anchors to `Date.now()` and order_date drifts between runs (AgDR-0005 wants
// reproducible CSVs). Override with SEED_REF_DATE (ISO-8601) if needed.
const REF_DATE = new Date(process.env.SEED_REF_DATE ?? '2026-01-01T00:00:00Z');

const OUT_DIR = join(process.cwd(), 'generated');

/** Write one row, awaiting back-pressure drain when the buffer is full. */
async function put(w: CsvWriter, fields: readonly CsvValue[]): Promise<void> {
  if (!w.writeRow(fields)) await w.drain();
}

/** Fail loudly on a non-numeric / non-positive knob instead of writing NaN rows. */
function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive number, got: ${value}`);
  }
}

async function main(): Promise<void> {
  assertPositive('SEED_CATEGORIES', NUM_CATEGORIES);
  assertPositive('SEED_CUSTOMERS', NUM_CUSTOMERS);
  assertPositive('SEED_PRODUCTS', NUM_PRODUCTS);
  assertPositive('SEED_ORDERS', NUM_ORDERS);
  assertPositive('SEED_MAX_DETAILS', MAX_DETAILS_PER_ORDER);
  if (!Number.isFinite(REF_DATE.getTime())) {
    throw new Error(
      `SEED_REF_DATE is not a valid date: ${process.env.SEED_REF_DATE}`,
    );
  }
  faker.seed(SEED);
  mkdirSync(OUT_DIR, { recursive: true });
  const started = Date.now();
  console.log(
    `→ Generating CSVs to ${OUT_DIR} ` +
      `(categories=${NUM_CATEGORIES}, customers=${NUM_CUSTOMERS}, ` +
      `products=${NUM_PRODUCTS}, orders=${NUM_ORDERS}, maxDetails=${MAX_DETAILS_PER_ORDER})`,
  );

  // --- category ---
  const categoryCsv = new CsvWriter(join(OUT_DIR, 'category.csv'), [
    'category_id',
    'category_name',
  ]);
  for (let id = 1; id <= NUM_CATEGORIES; id++) {
    await put(categoryCsv, [
      id,
      `${faker.commerce.department()} ${faker.string.alphanumeric(4)}`,
    ]);
  }
  categoryCsv.close();
  await categoryCsv.done;

  // --- product (keep prices for order totals) ---
  const productPrices = new Array<number>(NUM_PRODUCTS + 1); // 1-based
  const productCsv = new CsvWriter(join(OUT_DIR, 'product.csv'), [
    'product_id',
    'category_id',
    'name',
    'description',
    'price',
    'stock_quantity',
  ]);
  for (let id = 1; id <= NUM_PRODUCTS; id++) {
    const price = Number(faker.commerce.price({ min: 1, max: 5000, dec: 2 }));
    productPrices[id] = price;
    await put(productCsv, [
      id,
      faker.number.int({ min: 1, max: NUM_CATEGORIES }),
      faker.commerce.productName(),
      faker.datatype.boolean(0.8) ? faker.commerce.productDescription() : null,
      price.toFixed(2),
      faker.number.int({ min: 0, max: 1000 }),
    ]);
  }
  productCsv.close();
  await productCsv.done;

  // --- customer ---
  const customerCsv = new CsvWriter(join(OUT_DIR, 'customer.csv'), [
    'customer_id',
    'first_name',
    'last_name',
    'email',
    'password_hash',
  ]);
  for (let id = 1; id <= NUM_CUSTOMERS; id++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    await put(customerCsv, [
      id,
      firstName,
      lastName,
      // id-suffixed so emails stay unique even at scale
      `${faker.internet.username({ firstName, lastName }).toLowerCase()}.${id}@example.com`,
      faker.string.hexadecimal({
        length: 60,
        prefix: '$2b$10$',
        casing: 'lower',
      }),
    ]);
  }
  customerCsv.close();
  await customerCsv.done;

  // --- orders + order_details (single pass, running detail-id counter) ---
  const ordersCsv = new CsvWriter(join(OUT_DIR, 'orders.csv'), [
    'order_id',
    'customer_id',
    'order_date',
    'total_amount',
  ]);
  const detailsCsv = new CsvWriter(join(OUT_DIR, 'order_details.csv'), [
    'order_details_id',
    'product_id',
    'order_id',
    'quantity',
    'unit_price',
  ]);
  let detailId = 0;
  for (let orderId = 1; orderId <= NUM_ORDERS; orderId++) {
    const detailCount = faker.number.int({
      min: 1,
      max: MAX_DETAILS_PER_ORDER,
    });
    let total = 0;
    for (let j = 0; j < detailCount; j++) {
      const productId = faker.number.int({ min: 1, max: NUM_PRODUCTS });
      const qty = faker.number.int({ min: 1, max: 10 });
      const unitPrice = productPrices[productId]!;
      total += qty * unitPrice;
      await put(detailsCsv, [
        ++detailId,
        productId,
        orderId,
        qty,
        unitPrice.toFixed(2),
      ]);
    }
    await put(ordersCsv, [
      orderId,
      faker.number.int({ min: 1, max: NUM_CUSTOMERS }),
      faker.date.past({ years: 2, refDate: REF_DATE }).toISOString(),
      total.toFixed(2),
    ]);
  }
  ordersCsv.close();
  detailsCsv.close();
  await Promise.all([ordersCsv.done, detailsCsv.done]);

  const total =
    NUM_CATEGORIES + NUM_PRODUCTS + NUM_CUSTOMERS + NUM_ORDERS + detailId;
  console.log(
    `✔ Generated ${total.toLocaleString()} rows ` +
      `(${detailId.toLocaleString()} order_details) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error('Seed generation failed:', err);
  process.exit(1);
});
