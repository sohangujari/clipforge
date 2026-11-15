import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ZodError } from 'zod'
import { getSetting, isSettingKey, setSetting } from '@/lib/settings'
import { dataDir } from '@/lib/paths'

function du(dir: string): number {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(/*turbopackIgnore: true*/ dir, e.name)
    total += e.isDirectory() ? du(p) : statSync(p).size
  }
  return total
}

type Ctx = { params: Promise<{ key: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { key } = await ctx.params
  if (!isSettingKey(key)) return Response.json({ error: 'Unknown setting' }, { status: 404 })
  const value = await getSetting(key)
  if (key === 'profile') return Response.json({ ...value, dataDir: dataDir(), diskUsageBytes: du(dataDir()) })
  return Response.json(value)
}

export async function PUT(req: Request, ctx: Ctx) {
  const { key } = await ctx.params
  if (!isSettingKey(key)) return Response.json({ error: 'Unknown setting' }, { status: 404 })
  try {
    return Response.json(await setSetting(key, await req.json()))
  } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError) {
      return Response.json({ error: 'Invalid value', issues: e instanceof ZodError ? e.issues : [] }, { status: 400 })
    }
    throw e
  }
}
