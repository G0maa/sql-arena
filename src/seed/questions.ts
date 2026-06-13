/**
 * Committed question registry — metadata only, no reference queries.
 * The reference queries live in the gitignored `secrets/reference_queries.sql`
 * and are joined to these entries by `code` at load time.
 *
 * `expected_columns` lists the output columns the grader expects, in order —
 * it MUST mirror the SELECT list of the matching reference query in
 * secrets/reference_queries.sql (the grader compares results positionally, so
 * column order is part of the contract). These are surfaced to contestants as
 * an output-format hint (see AgDR-0012); keep them in sync when a reference
 * query changes. A drift guard in arena.service.spec.ts asserts the width
 * matches each question's stored golden sample row.
 */

export interface Question {
  code: string;
  title: string;
  prompt: string;
  /** True when the mentee's result must match row order exactly. */
  ordered: boolean;
  /** Output columns the grader expects, in order — mirrors the reference query SELECT list. */
  expected_columns: string[];
}

export const QUESTIONS: Question[] = [
  {
    code: 'Q5',
    title: 'Products per category',
    prompt:
      'For every category, return its category_name and the number of products in it (count of product rows). Include categories that have no products (count 0).',
    ordered: false,
    expected_columns: ['category_name', 'product_count'],
  },
  {
    code: 'Q6',
    title: 'Top customers by spending',
    prompt:
      'For customers who have placed orders, return customer_id, first_name, last_name and total_spent (the sum of their orders.total_amount), ordered by total_spent descending (highest spender first).',
    ordered: true,
    expected_columns: ['customer_id', 'first_name', 'last_name', 'total_spent'],
  },
  {
    code: 'Q7',
    title: '1000 most recent orders',
    prompt:
      "Return the 1000 most recent orders — order_id, order_date, total_amount and the customer's first_name, last_name and email — ordered by order_date descending (most recent first).",
    ordered: true,
    expected_columns: [
      'order_id',
      'order_date',
      'total_amount',
      'first_name',
      'last_name',
      'email',
    ],
  },
  {
    code: 'Q8',
    title: 'Low-stock products',
    prompt:
      'Return product_id, name and stock_quantity for every product whose stock_quantity is below 10.',
    ordered: false,
    expected_columns: ['product_id', 'name', 'stock_quantity'],
  },
  {
    code: 'Q9',
    title: 'Revenue per category',
    prompt:
      'For each category that has sales, return its category_name and total revenue (the sum of order_details.quantity × order_details.unit_price across that category’s products).',
    ordered: false,
    expected_columns: ['category_name', 'revenue'],
  },
];
