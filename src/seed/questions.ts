/**
 * Committed question registry — metadata only, no reference queries.
 * The reference queries live in the gitignored `secrets/reference_queries.sql`
 * and are joined to these entries by `code` at load time.
 */

export interface Question {
  code: string;
  title: string;
  prompt: string;
  /** True when the mentee's result must match row order exactly. */
  ordered: boolean;
}

export const QUESTIONS: Question[] = [
  {
    code: 'Q5',
    title: 'Products per category',
    prompt: 'Return the total number of products in each category.',
    ordered: false,
  },
  {
    code: 'Q6',
    title: 'Top customers by spending',
    prompt:
      'Return customers ranked by their total spending (sum of orders.total_amount), highest first.',
    ordered: true,
  },
  {
    code: 'Q7',
    title: '1000 most recent orders',
    prompt:
      'Return the 1000 most recent orders together with the customer first_name, last_name, and email.',
    ordered: true,
  },
  {
    code: 'Q8',
    title: 'Low-stock products',
    prompt: 'Return products whose stock_quantity is less than 10.',
    ordered: false,
  },
  {
    code: 'Q9',
    title: 'Revenue per category',
    prompt:
      'Return the total revenue per category (sum of order_details.quantity × order_details.unit_price).',
    ordered: false,
  },
];
