import { beforeEach, expect, test, vi } from 'vitest'
import { rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { freshDataDir } from './helpers'

let dir: string
beforeEach(() => { dir = freshDataDir(); vi.resetModules() })
const load = () => import('@/lib/secret')

test('roundtrip', async () => {
  const { encrypt, decrypt } = await load()
  expect(decrypt(encrypt('sk-abc'))).toBe('sk-abc')
})

test('random iv', async () => {
  const { encrypt } = await load()
  expect(encrypt('x')).not.toBe(encrypt('x'))
})

test('tamper', async () => {
  const { encrypt, decrypt, SecretError } = await load()
  const blob = encrypt('sk-abc')
  const parts = blob.split(':')
  const ct = Buffer.from(parts[3], 'base64'); ct[0] ^= 1
  parts[3] = ct.toString('base64')
  expect(() => decrypt(parts.join(':'))).toThrow(SecretError)
})

test('key file mode', async () => {
  const { encrypt } = await load()
  encrypt('x')
  expect(statSync(join(dir, '.secret')).mode & 0o777).toBe(0o600)
})

test('wrong key', async () => {
  const blob = (await load()).encrypt('sk-abc')
  rmSync(join(dir, '.secret'))
  vi.resetModules()
  const { decrypt, SecretError } = await load()
  expect(() => decrypt(blob)).toThrow(SecretError)
})

import { writeFileSync } from 'node:fs'

test('corrupt .secret is replaced, old blobs become undecryptable, saving still works', async () => {
  const { encrypt, decrypt, SecretError } = await load()
  const blob = encrypt('sk-abc')
  writeFileSync(join(dir, '.secret'), 'junk')
  expect(() => decrypt(blob)).toThrow(SecretError)
  expect(decrypt(encrypt('sk-new'))).toBe('sk-new')
})

test('.secret deleted while running is noticed without a restart', async () => {
  const { encrypt, decrypt, SecretError } = await load()
  const blob = encrypt('sk-abc')
  rmSync(join(dir, '.secret'))
  expect(() => decrypt(blob)).toThrow(SecretError)
})
