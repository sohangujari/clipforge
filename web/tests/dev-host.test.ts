import { expect, test } from 'vitest'
import pkg from '../package.json'

test('dev server binds to loopback only (saved API keys must not be reachable from the LAN)', () => {
  expect(pkg.scripts.dev).toMatch(/-H 127\.0\.0\.1/)
  expect(pkg.scripts.start).toMatch(/-H 127\.0\.0\.1/)
})
