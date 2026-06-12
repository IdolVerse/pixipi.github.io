import { Hono } from 'hono'
import { dbFirst, dbAll } from '../db'
import { authMiddleware } from '../middleware/auth'
import type { HonoEnv } from '../types'

export const photosRouter = new Hono<HonoEnv>()

function extractR2Key(url: string, publicBase: string): string | null {
  const base = publicBase.replace(/\/$/, '')
  if (!url.startsWith(base + '/')) return null
  return url.slice(base.length + 1)
}

photosRouter.get('/', async (c) => {
  try {
    return c.json(await dbAll(c.env.DB, 'SELECT id,event_id,photo_url,caption,member_tag,uploaded_by,created_at FROM photos ORDER BY created_at DESC'))
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

photosRouter.get('/event/:event_id', async (c) => {
  try {
    return c.json(await dbAll(c.env.DB,
      'SELECT id,event_id,photo_url,caption,member_tag,uploaded_by,created_at FROM photos WHERE event_id=? ORDER BY created_at DESC',
      c.req.param('event_id'),
    ))
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

photosRouter.get('/member/:tag', async (c) => {
  try {
    return c.json(await dbAll(c.env.DB,
      'SELECT id,event_id,photo_url,caption,member_tag,created_at FROM photos WHERE LOWER(member_tag)=LOWER(?) ORDER BY created_at DESC LIMIT 12',
      c.req.param('tag'),
    ))
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

photosRouter.post('/', authMiddleware, async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('photo') as File | null
    if (!file) return c.json({ error: 'No file uploaded' }, 400)

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowed.includes(file.type) && !['.jpg','.jpeg','.png','.gif','.webp'].some(e => file.name.toLowerCase().endsWith(e)))
      return c.json({ error: 'Invalid file type' }, 400)
    if (file.size > 50 * 1024 * 1024) return c.json({ error: 'File too large (max 50MB)' }, 400)

    const event_id  = formData.get('event_id')  as string | null
    const caption   = formData.get('caption')   as string | null
    const member_tag = formData.get('member_tag') as string | null

    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
    const key = `photos/photo-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`

    await c.env.R2.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })

    const photoUrl = `${c.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`

    const me = c.get('user') as any
    const row = await dbFirst(c.env.DB,
      'INSERT INTO photos (event_id,photo_url,caption,member_tag,uploaded_by) VALUES (?,?,?,?,?) RETURNING *',
      event_id ?? null, photoUrl, caption ?? null, member_tag ?? 'Group', me.id,
    )
    return c.json(row, 201)
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

photosRouter.put('/:id', authMiddleware, async (c) => {
  try {
    const { caption, member_tag, event_id } = await c.req.json<any>()
    const row = await dbFirst(c.env.DB,
      'UPDATE photos SET caption=?,member_tag=?,event_id=? WHERE id=? RETURNING *',
      caption ?? null, member_tag ?? 'Group', event_id ?? null, c.req.param('id'),
    )
    if (!row) return c.json({ error: 'Photo not found' }, 404)
    return c.json(row)
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

photosRouter.delete('/:id', authMiddleware, async (c) => {
  try {
    const row = await dbFirst(c.env.DB, 'DELETE FROM photos WHERE id=? RETURNING *', c.req.param('id'))
    if (!row) return c.json({ error: 'Photo not found' }, 404)

    const key = extractR2Key(row.photo_url as string, c.env.R2_PUBLIC_URL)
    if (key) {
      try { await c.env.R2.delete(key) } catch { /* best-effort */ }
    }
    return c.json({ message: 'Photo deleted', photo: row })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})
