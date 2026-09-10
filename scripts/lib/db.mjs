import pg from "pg";

/**
 * A connected Postgres client.
 *
 * `pg` currently treats sslmode=require as verify-full but warns that a future
 * major will adopt libpq semantics, which are weaker — require would stop
 * verifying the certificate chain. Stating verify-full explicitly keeps the
 * stronger behaviour when that change lands, rather than silently downgrading.
 */
export async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Run with:\n");
    console.error("  node --env-file=.env.local <script>\n");
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString: url.replace(/sslmode=require\b/, "sslmode=verify-full"),
  });
  await client.connect();
  return client;
}
