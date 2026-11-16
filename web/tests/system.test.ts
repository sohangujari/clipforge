import { beforeEach, expect, test, vi } from 'vitest'
import { utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshDataDir } from './helpers'

let dir: string
beforeEach(() => { dir = freshDataDir(); vi.resetModules() })
const get = async () => (await (await import('@/app/api/system/route')).GET()).json()

test('workerAlive false when the heartbeat file is missing', async () => {
  expect((await get()).workerAlive).toBe(false)
})

test('workerAlive true for a fresh heartbeat, false for a stale one', async () => {
  const f = join(dir, '.worker-alive')
  writeFileSync(f, '')
  expect((await get()).workerAlive).toBe(true)
  const old = Date.now() / 1000 - 60
  utimesSync(f, old, old)
  expect((await get()).workerAlive).toBe(false)
})
