import type { D1Database } from '@cloudflare/workers-types'

interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfter?: number  // seconds until window resets
}

/**
 * Simple D1-backed rate limiter.
 * key        — unique string, e.g. "magic-send:1.2.3.4"
 * max        — max requests allowed per window
 * windowSecs — window duration in seconds
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  max: number,
  windowSecs: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000)

  const row = await db.prepare(
    'SELECT count, window_start FROM rate_limits WHERE key = ?'
  ).bind(key).first<{ count: number; window_start: number }>()

  if (!row || now - row.window_start >= windowSecs) {
    // New window — upsert with count 1
    await db.prepare(
      'INSERT INTO rate_limits (key, count, window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=1, window_start=excluded.window_start'
    ).bind(key, now).run()
    return { allowed: true, remaining: max - 1 }
  }

  if (row.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: windowSecs - (now - row.window_start),
    }
  }

  await db.prepare(
    'UPDATE rate_limits SET count = count + 1 WHERE key = ?'
  ).bind(key).run()

  return { allowed: true, remaining: max - row.count - 1 }
}
