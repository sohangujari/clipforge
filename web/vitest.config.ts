import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'next/server': fileURLToPath(new URL('./tests/server-stub.ts', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
