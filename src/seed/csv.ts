/**
 * Minimal CSV writer for the seed generator (AgDR-0005 / AgDR-0007).
 *
 * The output is consumed by Postgres `COPY … WITH (FORMAT csv, HEADER)`, so the
 * escaping rules follow Postgres CSV semantics:
 *   - A field containing a comma, double-quote, CR, or LF is wrapped in double
 *     quotes, with embedded double-quotes doubled (`"` → `""`).
 *   - An empty/`null`/`undefined` field is written as an *unquoted* empty string,
 *     which `COPY` interprets as SQL NULL (the default NULL marker). That is what
 *     we want for nullable columns like `product.description`.
 *   - An explicit empty *string* value would need to be quoted (`""`) to load as
 *     '' rather than NULL — the seed never needs that, so we keep it simple.
 */
import { createWriteStream, type WriteStream } from 'node:fs';

export type CsvValue = string | number | null | undefined;

/** Escape a single field per Postgres CSV rules. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(value) : value;
  if (s.length === 0) return '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Streaming CSV writer with back-pressure handling. Writes a header row on
 * construction, then one row per `writeRow` call. Call `close()` and await
 * `done` to flush.
 */
export class CsvWriter {
  private readonly stream: WriteStream;
  public readonly done: Promise<void>;

  constructor(path: string, header: readonly string[]) {
    this.stream = createWriteStream(path, { encoding: 'utf8' });
    this.done = new Promise((resolve, reject) => {
      this.stream.on('finish', resolve);
      this.stream.on('error', reject);
    });
    this.stream.write(header.join(',') + '\n');
  }

  /**
   * Write one row. Returns the stream's back-pressure signal: `false` means the
   * buffer is full and the caller should `await drain()` before writing more.
   */
  writeRow(fields: readonly CsvValue[]): boolean {
    return this.stream.write(fields.map(csvField).join(',') + '\n');
  }

  /** Resolve once the stream has drained — call when `writeRow` returns false. */
  drain(): Promise<void> {
    return new Promise((resolve) => this.stream.once('drain', resolve));
  }

  close(): void {
    this.stream.end();
  }
}
