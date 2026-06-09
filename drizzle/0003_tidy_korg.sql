-- Rename the figurine_style enum value 'disney' -> 'storybook' (trademark cleanup).
-- Postgres ALTER TYPE ... RENAME VALUE is atomic and preserves existing rows;
-- drizzle-kit's generated drop/recreate would have failed the ::figurine_style
-- cast-back on any pre-existing 'disney' row. Snapshot 0003 already reflects the
-- renamed value, so future `generate` diffs stay consistent.
ALTER TYPE "public"."figurine_style" RENAME VALUE 'disney' TO 'storybook';
