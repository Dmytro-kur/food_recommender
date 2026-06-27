# Neon migrations

`neon/migrations` is the source of truth for the database schema.

- Use [`../schema.sql`](../schema.sql) for a fresh bootstrap in Neon SQL Editor.
- Use the numbered files in this directory for incremental upgrades.
- After editing or adding migrations, run `npm run db:build-schema` to rebuild `neon/schema.sql`.
- The latest product simplification lives in `0006_simplify_cookbook.sql`: it removes planner-era tables, keeps recipes/pantry state, and adds purchase-request templates.

Conventions:

- Do not edit an already-applied migration for behavior changes.
- Put each new change in a new numbered file.
- Keep one-off backfills or temporary compatibility helpers in their own migration file.
- Treat `neon/schema.sql` as generated output, not as the authoring surface.
