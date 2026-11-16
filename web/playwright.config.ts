import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Each run gets its own data dir so tests never touch the user's real data/.
const dataDir = process.env.CLIPFORGE_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'clipforge-e2e-'))
process.env.CLIPFORGE_DATA_DIR = dataDir

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'npx prisma db push && npx next dev -H 127.0.0.1 -p 3100',
      url: 'http://127.0.0.1:3100',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { CLIPFORGE_DATA_DIR: dataDir },
    },
    {
      // The real worker, with the tiny Whisper model so tests stay fast.
      command: 'uv run --directory ../worker python -m clipforge_worker',
      wait: { stderr: /waiting for jobs/ },
      timeout: 60_000,
      reuseExistingServer: false,
      env: { CLIPFORGE_DATA_DIR: dataDir, CLIPFORGE_WEB_PORT: '3100', CLIPFORGE_WHISPER_REPO: 'mlx-community/whisper-tiny' },
    },
    {
      // Test-only OpenAI-compatible model (e2e/fake-llm.mjs) so clip finding runs end to end without real AI calls.
      command: 'node e2e/fake-llm.mjs',
      wait: { stdout: /fake llm ready/ },
      reuseExistingServer: false,
      env: { FAKE_LLM_PORT: '3199' },
    },
  ],
})
