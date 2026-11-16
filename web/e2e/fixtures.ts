import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A short MP4 with real speech (macOS `say`) over a test pattern. */
export function makeSpeechVideo(text = 'Hello, this is clip forge. We are testing the whole import pipeline on a Mac.'): string {
  const dir = mkdtempSync(join(tmpdir(), 'cf-e2e-'))
  const aiff = join(dir, 's.aiff'), mp4 = join(dir, 'speech-test.mp4')
  execFileSync('say', ['-o', aiff, text])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-i', aiff,
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4])
  return mp4
}

/** Serves one file slowly (bytesPerSec) so a download stays in progress long enough to cancel. */
export function slowServer(file: string, bytesPerSec = 20_000): Promise<{ url: string; server: Server }> {
  const data = readFileSync(file)
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': statSync(file).size })
    let i = 0
    const t = setInterval(() => {
      if (i >= data.length || res.destroyed) { clearInterval(t); res.end(); return }
      res.write(data.subarray(i, i + bytesPerSec / 10)); i += bytesPerSec / 10
    }, 100)
    req.on('close', () => clearInterval(t))
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number }
    r({ url: `http://127.0.0.1:${port}/slow-video.mp4`, server })
  }))
}
