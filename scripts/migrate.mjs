#!/usr/bin/env node
/**
 * Apply pending SQL migrations.
 *
 *   node --env-file=.env.local scripts/migrate.mjs          # apply pending
 *   node --env-file=.env.local scripts/migrate.mjs --status  # list only
 *
 * Deliberately small and written by hand rather than pulled from a library: the
 * whole mechanism is a table of what has run, a lexical ordering of files, and a
 * transaction per migration. Worth understanding before reaching for a tool that
 * hides it.
 */
import { connect } from "./lib/db.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DIR = "db/migrations";
const statusOnly = process.argv.includes("--status");

const client = await connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: applied } = await client.query(
    "SELECT filename, checksum FROM schema_migrations",
  );
  const appliedBy = new Map(applied.map((r) => [r.filename, r.checksum]));

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

  let pending = 0;
  for (const file of files) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
    const previous = appliedBy.get(file);

    if (previous) {
      /* An applied migration that no longer matches what ran means the file was
         edited after the fact. The database and the repo now disagree and no
         amount of re-running fixes it — the correct move is a new migration. */
      if (previous !== checksum) {
        console.error(`\n✗ ${file} was modified after being applied.`);
        console.error(`  applied ${previous}, file is now ${checksum}`);
        console.error(`  Write a new migration instead of editing this one.\n`);
        process.exit(1);
      }
      if (statusOnly) console.log(`  applied  ${file}`);
      continue;
    }

    pending++;
    if (statusOnly) {
      console.log(`  PENDING  ${file}`);
      continue;
    }

    // One transaction per migration: a failure leaves nothing half-applied.
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [file, checksum],
      );
      await client.query("COMMIT");
      console.log(`  ✓ ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`\n✗ ${file} failed and was rolled back:\n  ${err.message}\n`);
      process.exit(1);
    }
  }

  if (statusOnly) console.log(`\n${pending} pending`);
  else console.log(pending ? `\n${pending} migration(s) applied` : "already up to date");
} finally {
  await client.end();
}
