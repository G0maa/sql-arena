# AgDR-0012 — Surface expected-output hints (columns + row count + one sample row)

**Status**: Accepted
**Date**: 2026-06-13
**Author**: Hisham (Tech Lead)

> In the context of the contestant page (#11), facing that the grader does an **exact
> full-result match** (positional columns + values) while prompts are prose — so a contestant
> can't tell which columns, in what order, or how many rows are expected and fails repeatedly
> on *shape* rather than *logic* — I decided to surface per-question output hints (explicit
> prompts, expected column list, expected row count, order-sensitivity, and the **first** golden
> row as a sample), to achieve a fair "you know the target shape" experience, accepting that we
> reveal one row of each answer and the result's size.

## Context

The grader compares `JSON.stringify(normalisedRows) === JSON.stringify(golden)` (see
`golden-compare.ts`). Column **order** and **count** are part of the contract, and for
unordered questions rows are sorted before compare. None of that is visible to a contestant:
the prompt *"Return the total number of products in each category"* doesn't say "two columns:
`category_name`, then the count, including zero-count categories." Playtesting #11 confirmed the
failure mode — a logically-reasonable query returns `incorrect` purely because it selected one
column instead of two, or used an inner join that dropped empty categories.

## Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Sharper prompts only** | Pure content; zero leak | Still no machine-checkable shape; verbose prose |
| **Expose expected columns + row count** | Strong shape hint; no answer values | Doesn't show formatting (date format, numeric precision) |
| **+ one sample row** (chosen) | Shows exact cell formatting; unambiguous target | Reveals one answer row; for ordered questions that row is the top result |
| **Expose full golden_result** | Total clarity | Hands over the answer — leaderboard becomes trivially gameable |
| **Store column names in `app.questions`** | Zero drift (captured from the reference query at load) | Schema change + reseed; heavier than authoring metadata |

## Decision

Chosen: **explicit prompts + expected_columns + expected_row_count + order-sensitivity + the
first golden row**, exposed through the existing `GET /api/questions`.

- **Column names** are authored in the committed `src/seed/questions.ts` (`expected_columns`),
  mirroring each reference query's SELECT list — no schema change, no reseed. Drift risk is
  mitigated by a registry guard test and the UI's width check (sample row is only rendered as a
  table when its width equals `expected_columns.length`).
- **Sample row** is `golden_result[0]` only. The service **never** returns the full
  `golden_result`; a unit test asserts rows beyond the first never appear in the response.
- **Row count** is `golden_result.length` (an empty result, e.g. Q8 on the small seed, is a
  valid correct answer and is shown as "0 rows expected").

## Consequences

- Contestants see the target shape on question-select: columns (as a table header), a sample
  row, row count, and whether order matters. Fewer shape-only failures.
- **Partial answer reveal**: one row per question is public. For ordered questions (Q6 top
  spender, Q7 most-recent order) that row is the #1 result. Accepted — a single row can't be
  used to fabricate a full correct result, and a correct (hence rankable) submission still
  requires producing every row. If this proves too revealing, a future option is to show the
  sample row's *types/format* with masked values.
- `expected_columns` must be kept in sync if a reference query's SELECT list changes.

## Artifacts

- PR #16 (G0maa/sql-arena).
- `src/seed/questions.ts` (prompts + expected_columns), `src/arena/arena.service.ts`
  (enriched `listQuestions`), `src/arena/arena.service.spec.ts` (mapping + no-leak + drift
  guard), `public/index.html` (expected-output hint UI).
