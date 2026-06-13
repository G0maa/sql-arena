#!/usr/bin/env node
/**
 * gen-erd.mjs — generate public/erd.svg, a detailed ERD of the `seed` schema.
 *
 * Dependency-free (Node ESM, no npm packages). Holds the schema model below as
 * the single source of truth for the diagram and emits a self-contained SVG:
 * one box per table with every column + type + PK/FK badge, plus FK→PK
 * relationship arrows. See AgDR-0011 for why the ERD ships as a pre-generated
 * static SVG rather than a runtime diagram library.
 *
 * Regenerate after any change to db/sql/seed.sql:
 *   node scripts/gen-erd.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'erd.svg');

// --- Theme (matches public/index.html) -------------------------------------
const C = {
  bg: '#0f172a',
  panel: '#1e293b',
  border: '#334155',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#7dd3fc',
  line: '#64748b',
};

// --- Schema model (source of truth — mirror of db/sql/seed.sql) -------------
// k: 'PK' | 'FK' | undefined.  ref: 'table.column' for FK columns.
const W = 270;
const ROW_H = 24;
const HEAD_H = 30;

const tables = {
  category: {
    x: 20,
    y: 30,
    cols: [
      { n: 'category_id', t: 'integer', k: 'PK' },
      { n: 'category_name', t: 'text' },
    ],
  },
  product: {
    x: 20,
    y: 200,
    cols: [
      { n: 'product_id', t: 'integer', k: 'PK' },
      { n: 'category_id', t: 'integer', k: 'FK', ref: 'category.category_id' },
      { n: 'name', t: 'text' },
      { n: 'description', t: 'text' },
      { n: 'price', t: 'numeric(12,2)' },
      { n: 'stock_quantity', t: 'integer' },
    ],
  },
  order_details: {
    x: 330,
    y: 250,
    cols: [
      { n: 'order_details_id', t: 'bigint', k: 'PK' },
      { n: 'product_id', t: 'integer', k: 'FK', ref: 'product.product_id' },
      { n: 'order_id', t: 'bigint', k: 'FK', ref: 'orders.order_id' },
      { n: 'quantity', t: 'integer' },
      { n: 'unit_price', t: 'numeric(12,2)' },
    ],
  },
  customer: {
    x: 630,
    y: 30,
    cols: [
      { n: 'customer_id', t: 'integer', k: 'PK' },
      { n: 'first_name', t: 'text' },
      { n: 'last_name', t: 'text' },
      { n: 'email', t: 'text' },
      { n: 'password_hash', t: 'text' },
    ],
  },
  orders: {
    x: 630,
    y: 260,
    cols: [
      { n: 'order_id', t: 'bigint', k: 'PK' },
      { n: 'customer_id', t: 'integer', k: 'FK', ref: 'customer.customer_id' },
      { n: 'order_date', t: 'timestamptz' },
      { n: 'total_amount', t: 'numeric(14,2)' },
    ],
  },
};

// Relationships: route each FK row to its referenced PK row, choosing edge
// sides that keep lines out of the boxes for this fixed layout.
//   side: which edges the polyline attaches to [fromSide, toSide]
//   channel: x (for L/R) or y the elbow routes through
const rels = [
  { from: 'product.category_id', to: 'category.category_id', sides: ['L', 'L'], channel: 8 },
  { from: 'order_details.product_id', to: 'product.product_id', sides: ['L', 'R'], channel: 308 },
  { from: 'order_details.order_id', to: 'orders.order_id', sides: ['R', 'L'], channel: 608 },
  { from: 'orders.customer_id', to: 'customer.customer_id', sides: ['R', 'R'], channel: 918 },
];

// --- Geometry helpers -------------------------------------------------------
const boxH = (tbl) => HEAD_H + tbl.cols.length * ROW_H;
const rowIndex = (tbl, col) => tbl.cols.findIndex((c) => c.n === col);
const rowMidY = (tbl, idx) => tbl.y + HEAD_H + idx * ROW_H + ROW_H / 2;
const edgeX = (tbl, side) => (side === 'L' ? tbl.x : tbl.x + W);

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Render tables ----------------------------------------------------------
let boxes = '';
for (const [name, tbl] of Object.entries(tables)) {
  const h = boxH(tbl);
  boxes += `
  <g>
    <rect x="${tbl.x}" y="${tbl.y}" width="${W}" height="${h}" rx="5"
          fill="${C.panel}" stroke="${C.border}" stroke-width="1"/>
    <rect x="${tbl.x}" y="${tbl.y}" width="${W}" height="${HEAD_H}" rx="5"
          fill="${C.bg}" stroke="${C.border}" stroke-width="1"/>
    <rect x="${tbl.x}" y="${tbl.y + HEAD_H - 5}" width="${W}" height="5" fill="${C.bg}"/>
    <text x="${tbl.x + 12}" y="${tbl.y + 20}" fill="${C.accent}"
          font-family="ui-monospace, Menlo, Consolas, monospace"
          font-size="14" font-weight="700">${esc(name)}</text>`;
  tbl.cols.forEach((c, i) => {
    const ry = tbl.y + HEAD_H + i * ROW_H;
    if (i > 0)
      boxes += `
    <line x1="${tbl.x}" y1="${ry}" x2="${tbl.x + W}" y2="${ry}" stroke="${C.border}" stroke-width="0.5"/>`;
    const badge = c.k
      ? `<text x="${tbl.x + W - 10}" y="${ry + 16}" text-anchor="end" font-size="10" font-weight="700"
              fill="${c.k === 'PK' ? C.accent : C.muted}"
              font-family="ui-monospace, Menlo, Consolas, monospace">${c.k}</text>`
      : '';
    boxes += `
    <text x="${tbl.x + 12}" y="${ry + 16}" fill="${C.text}" font-size="12.5"
          font-family="ui-monospace, Menlo, Consolas, monospace">${esc(c.n)}</text>
    <text x="${tbl.x + 150}" y="${ry + 16}" fill="${C.muted}" font-size="11.5"
          font-family="ui-monospace, Menlo, Consolas, monospace">${esc(c.t)}</text>
    ${badge}`;
  });
  boxes += `
  </g>`;
}

// --- Render relationship connectors (orthogonal polyline + arrowhead) -------
let lines = '';
for (const r of rels) {
  const [fT, fC] = r.from.split('.');
  const [tT, tC] = r.to.split('.');
  const fromT = tables[fT];
  const toT = tables[tT];
  const fy = rowMidY(fromT, rowIndex(fromT, fC));
  const ty = rowMidY(toT, rowIndex(toT, tC));
  const fx = edgeX(fromT, r.sides[0]);
  const tx = edgeX(toT, r.sides[1]);
  const ch = r.channel;
  // FK side -> channel -> align vertically -> into PK side
  const pts = `${fx},${fy} ${ch},${fy} ${ch},${ty} ${tx},${ty}`;
  lines += `
  <polyline points="${pts}" fill="none" stroke="${C.line}" stroke-width="1.5"/>
  <circle cx="${fx}" cy="${fy}" r="3" fill="${C.line}"/>
  <polygon points="${arrow(tx, ty, r.sides[1])}" fill="${C.line}"/>`;
}

// Arrowhead pointing INTO the PK box edge (`side` is the box's edge it enters).
function arrow(x, y, side) {
  const s = 6;
  return side === 'L'
    ? `${x},${y} ${x - s},${y - s / 1.5} ${x - s},${y + s / 1.5}` // points right, into L edge
    : `${x},${y} ${x + s},${y - s / 1.5} ${x + s},${y + s / 1.5}`; // points left, into R edge
}

const VW = 920;
const VH = 430;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}"
     role="img" aria-label="Entity-relationship diagram of the seed schema"
     font-family="ui-monospace, Menlo, Consolas, monospace">
  <title>seed schema — tables, columns, types, and foreign-key relationships</title>
  <rect x="0" y="0" width="${VW}" height="${VH}" fill="${C.bg}"/>
  <text x="20" y="${VH - 12}" fill="${C.muted}" font-size="11">
    PK = primary key (already indexed) · FK → its referenced PK (unindexed — index these via Setup SQL) · arrow points to the PK
  </text>${lines}${boxes}
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`✔ wrote ${OUT} (${svg.length} bytes)`);
