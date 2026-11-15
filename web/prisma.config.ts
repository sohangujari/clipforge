import { defineConfig } from 'prisma/config'
import { dbFile } from './lib/paths'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: `file:${dbFile()}` },
})
