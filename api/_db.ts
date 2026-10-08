import crypto from 'node:crypto'
import postgres from 'postgres'

/**
 * Shared Postgres connection + lazy schema bootstrap for the API routes.
 * Connection string comes from the DATABASE_URL env var (Neon/Supabase/any
 * Postgres). The schema is created on first use, so setup is just:
 *   set DATABASE_URL and hit the API once.
 */

let sql: ReturnType<typeof postgres> | null = null
let schemaReady: Promise<void> | null = null

export function db(): ReturnType<typeof postgres> {
  if (!sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    sql = postgres(url, { max: 1, ssl: 'require', prepare: false })
  }
  return sql
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const s = db()
      await s`CREATE TABLE IF NOT EXISTS galaxy_state (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
      await s`CREATE TABLE IF NOT EXISTS galaxy_revisions (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL,
        author TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    })().catch((err) => {
      schemaReady = null
      throw err
    })
  }
  return schemaReady
}

export function authorized(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const admin = process.env.ADMIN_PASSWORD
  if (!admin) return false // no password set → writes disabled
  const raw = req.headers['x-admin-password']
  const given = Array.isArray(raw) ? raw[0] : raw
  if (!given) return false
  // constant-time-ish compare on hashes
  const a = crypto.createHash('sha256').update(String(given)).digest()
  const b = crypto.createHash('sha256').update(admin).digest()
  return crypto.timingSafeEqual(a, b)
}
