import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authorized, db, ensureSchema } from './_db'
import { normalizeGalaxy } from '../src/data/galaxyData'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  try {
    await ensureSchema()
  } catch (err) {
    res.status(500).json({ error: 'database unavailable', detail: String(err) })
    return
  }

  const sql = db()

  if (req.method === 'GET') {
    const rows = await sql`SELECT data, updated_by, updated_at
                           FROM galaxy_state WHERE id = 1 LIMIT 1`
    if (rows.length === 0) {
      res.status(200).json({ data: null, updated_by: null, updated_at: null })
      return
    }
    res.status(200).json(rows[0])
    return
  }

  if (req.method === 'POST') {
    if (!authorized(req)) {
      res.status(401).json({ error: 'invalid or missing X-Admin-Password' })
      return
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const author = typeof body?.author === 'string' ? body.author.slice(0, 80) : 'anonymous'
    const clean = normalizeGalaxy(body?.data ?? body)
    if (!clean) {
      res.status(400).json({ error: 'invalid galaxy dataset' })
      return
    }
    await sql`
      INSERT INTO galaxy_state (id, data, updated_by, updated_at)
      VALUES (1, ${JSON.stringify(clean)}::jsonb, ${author}, now())
      ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()
    `
    await sql`
      INSERT INTO galaxy_revisions (data, author)
      VALUES (${JSON.stringify(clean)}::jsonb, ${author})
    `
    res.status(200).json({ ok: true, updated_by: author })
    return
  }

  res.status(405).json({ error: 'method not allowed' })
}
