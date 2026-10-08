import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authorized, db, ensureSchema } from './_db'

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }
  if (!authorized(req)) {
    res.status(401).json({ error: 'invalid or missing X-Admin-Password' })
    return
  }

  try {
    await ensureSchema()
    const rows = await db()`SELECT id, author, created_at
                            FROM galaxy_revisions
                            ORDER BY id DESC LIMIT 20`
    res.status(200).json({ revisions: rows })
  } catch (err) {
    res.status(500).json({ error: 'database unavailable', detail: String(err) })
  }
}
