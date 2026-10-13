/**
 * Wanted.fun — off-chain submission backend
 * Bun HTTP server + bun:sqlite (WAL mode, crash-safe)
 * Runs on port 3001; the Vite dev server proxies /api → here.
 */

import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// ── Database setup ────────────────────────────────────────────────────────────

const DB_DIR = join(import.meta.dir, '..', '.data')
mkdirSync(DB_DIR, { recursive: true })
const DB_PATH = join(DB_DIR, 'submissions.db')

const db = new Database(DB_PATH, { create: true })

// Crash-safe SQLite config (one process only)
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=FULL;
  PRAGMA busy_timeout=5000;
  PRAGMA foreign_keys=ON;
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id   TEXT    NOT NULL,
    submitter   TEXT    NOT NULL,   -- lowercase wallet address
    content     TEXT    NOT NULL,   -- free text / URL / markdown
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bounty_id, submitter)
  );

  CREATE TABLE IF NOT EXISTS bounty_settings (
    bounty_id       TEXT    PRIMARY KEY,
    poster          TEXT    NOT NULL,   -- lowercase wallet address
    public_subs     INTEGER NOT NULL DEFAULT 0  -- 0=private, 1=public
  );
`)

// ── Types ────────────────────────────────────────────────────────────────────

interface Submission {
  id: number
  bounty_id: string
  submitter: string
  content: string
  created_at: number
}

interface BountySettings {
  bounty_id: string
  poster: string
  public_subs: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status)
}

function normalizeAddr(addr: string): string {
  return addr.toLowerCase().trim()
}

// ── Route handlers ───────────────────────────────────────────────────────────

/**
 * POST /api/bounty-settings
 * Body: { bountyId, poster }
 * Called by createBounty flow after the onchain tx confirms.
 * Idempotent — safe to call multiple times.
 */
function upsertBountySettings(req: Request): Response {
  const body = req.json() as Promise<{ bountyId?: string; poster?: string }>
  return body.then(({ bountyId, poster }) => {
    if (!bountyId || !poster) return err('bountyId and poster required')
    const b = String(bountyId)
    const p = normalizeAddr(poster)
    db.prepare(`
      INSERT INTO bounty_settings (bounty_id, poster, public_subs)
      VALUES (?, ?, 0)
      ON CONFLICT(bounty_id) DO NOTHING
    `).run(b, p)
    return json({ ok: true })
  }) as unknown as Response
}

/**
 * PATCH /api/bounty-settings/:bountyId/visibility
 * Body: { poster, publicSubs: boolean }
 * Only the poster can change visibility.
 */
function setVisibility(bountyId: string, req: Request): Response {
  const body = req.json() as Promise<{ poster?: string; publicSubs?: boolean }>
  return body.then(({ poster, publicSubs }) => {
    if (!poster || publicSubs === undefined) return err('poster and publicSubs required')
    const p = normalizeAddr(poster)
    const settings = db.prepare('SELECT * FROM bounty_settings WHERE bounty_id = ?').get(bountyId) as BountySettings | null
    if (!settings) return err('bounty not found', 404)
    if (settings.poster !== p) return err('not the poster', 403)
    db.prepare('UPDATE bounty_settings SET public_subs = ? WHERE bounty_id = ?').run(publicSubs ? 1 : 0, bountyId)
    return json({ ok: true, publicSubs })
  }) as unknown as Response
}

/**
 * POST /api/submissions
 * Body: { bountyId, submitter, content }
 * No gas. Just store it.
 */
function createSubmission(req: Request): Response {
  const body = req.json() as Promise<{ bountyId?: string; submitter?: string; content?: string }>
  return body.then(({ bountyId, submitter, content }) => {
    if (!bountyId || !submitter || !content) return err('bountyId, submitter, content required')
    if (content.trim().length === 0) return err('content cannot be empty')
    if (content.length > 5000) return err('content too long (max 5000 chars)')
    const b = String(bountyId)
    const s = normalizeAddr(submitter)

    // Check poster cannot submit
    const settings = db.prepare('SELECT poster FROM bounty_settings WHERE bounty_id = ?').get(b) as { poster: string } | null
    if (settings && settings.poster === s) return err('poster cannot submit to their own bounty', 403)

    try {
      const result = db.prepare(`
        INSERT INTO submissions (bounty_id, submitter, content)
        VALUES (?, ?, ?)
      `).run(b, s, content.trim())
      return json({ ok: true, id: result.lastInsertRowid })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('UNIQUE')) return err('already submitted to this bounty', 409)
      throw e
    }
  }) as unknown as Response
}

/**
 * GET /api/submissions/:bountyId?viewer=<address>
 * Returns submissions the viewer is allowed to see:
 *  - poster sees all
 *  - anyone sees all if public_subs = 1
 *  - otherwise viewer sees only their own submission
 */
function getSubmissions(bountyId: string, viewer: string): Response {
  const v = normalizeAddr(viewer)
  const settings = db.prepare('SELECT * FROM bounty_settings WHERE bounty_id = ?').get(bountyId) as BountySettings | null
  const isPoster = settings ? settings.poster === v : false
  const isPublic = settings ? settings.public_subs === 1 : false

  let rows: Submission[]
  if (isPoster || isPublic) {
    rows = db.prepare('SELECT * FROM submissions WHERE bounty_id = ? ORDER BY created_at ASC').all(bountyId) as Submission[]
  } else if (v) {
    rows = db.prepare('SELECT * FROM submissions WHERE bounty_id = ? AND submitter = ?').all(bountyId, v) as Submission[]
  } else {
    rows = []
  }

  const count = (db.prepare('SELECT COUNT(*) as c FROM submissions WHERE bounty_id = ?').get(bountyId) as { c: number }).c

  return json({
    submissions: rows,
    count,
    publicSubs: settings?.public_subs === 1 ?? false,
    isPoster,
  })
}

/**
 * GET /api/submissions/:bountyId/count
 * Public — just the count, no content.
 */
function getSubmissionCount(bountyId: string): Response {
  const row = db.prepare('SELECT COUNT(*) as c FROM submissions WHERE bounty_id = ?').get(bountyId) as { c: number }
  return json({ count: row.c })
}

/**
 * GET /api/submissions/:bountyId/mine?submitter=<address>
 * Returns the viewer's own submission if it exists.
 */
function getMySubmission(bountyId: string, submitter: string): Response {
  const s = normalizeAddr(submitter)
  const row = db.prepare('SELECT * FROM submissions WHERE bounty_id = ? AND submitter = ?').get(bountyId, s) as Submission | null
  return json({ submission: row })
}

// ── Router ───────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    // CORS for dev
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const wrap = (res: Response | Promise<Response>) =>
      Promise.resolve(res).then(r => {
        const headers = new Headers(r.headers)
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v))
        return new Response(r.body, { status: r.status, headers })
      })

    // POST /api/bounty-settings
    if (method === 'POST' && path === '/bounty-settings') return wrap(upsertBountySettings(req))

    // PATCH /api/bounty-settings/:id/visibility
    const visMatch = path.match(/^\/bounty-settings\/([^/]+)\/visibility$/)
    if (method === 'PATCH' && visMatch) return wrap(setVisibility(visMatch[1], req))

    // POST /api/submissions
    if (method === 'POST' && path === '/submissions') return wrap(createSubmission(req))

    // GET /api/submissions/:id/count
    const countMatch = path.match(/^\/submissions\/([^/]+)\/count$/)
    if (method === 'GET' && countMatch) return wrap(getSubmissionCount(countMatch[1]))

    // GET /api/submissions/:id/mine
    const mineMatch = path.match(/^\/submissions\/([^/]+)\/mine$/)
    if (method === 'GET' && mineMatch) {
      const submitter = url.searchParams.get('submitter') ?? ''
      return wrap(getMySubmission(mineMatch[1], submitter))
    }

    // GET /api/submissions/:id
    const subsMatch = path.match(/^\/submissions\/([^/]+)$/)
    if (method === 'GET' && subsMatch) {
      const viewer = url.searchParams.get('viewer') ?? ''
      return wrap(getSubmissions(subsMatch[1], viewer))
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`Wanted.fun backend running on port ${server.port}`)
