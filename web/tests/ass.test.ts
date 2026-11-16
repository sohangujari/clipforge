import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { buildAss, fontFor, type AssInput } from '@/lib/ass'
import { builtinPresets } from '@/lib/subtitle-presets'

const FIX = join(__dirname, '..', '..', 'shared', 'ass-fixtures')
const preset = (id: string) => builtinPresets.find((p) => p.id === id)!
const words = [{ w: 'we', s: 0, e: 0.4 }, { w: 'set', s: 0.5, e: 0.9 }, { w: 'up', s: 1.0, e: 1.3 }]
const input = (o: Partial<AssInput> = {}): AssInput => ({ style: { ...preset('bold-pop'), wordsPerLine: 3 }, words, width: 1080, height: 1920, duration: 5, ...o })
const dialogues = (ass: string) => ass.split('\n').filter((l) => l.startsWith('Dialogue:'))

test('every preset matches its committed fixture', () => {
  const ids = readdirSync(FIX).filter((f) => f.endsWith('.input.json'))
  expect(ids.length).toBeGreaterThanOrEqual(12)
  for (const f of ids) {
    const i = JSON.parse(readFileSync(join(FIX, f), 'utf8'))
    expect(buildAss(i), f).toBe(readFileSync(join(FIX, f.replace('.input.json', '.ass')), 'utf8'))
  }
})

test('header uses output size and the font name libass matches on', () => {
  const ass = buildAss(input())
  expect(ass).toContain('PlayResX: 1080\nPlayResY: 1920')
  expect(ass).toContain('ScaledBorderAndShadow: yes')
  expect(ass).toMatch(/^Style: Default,Montserrat Thin ExtraBold,64,/m) // Montserrat 800 → that file's family name
})

test('font weight picks the nearest bundled file; unknown family falls back to Inter', () => {
  expect(fontFor('Inter', 700)).toEqual({ name: 'Inter', bold: true })
  expect(fontFor('Inter', 800)).toEqual({ name: 'Inter Black', bold: false }) // 900 is nearer than 700? tie → heavier
  expect(fontFor('Comic Sans', 400)).toEqual({ name: 'Inter', bold: false })
})

test('one dialogue per spoken word; the active word is coloured', () => {
  const d = dialogues(buildAss(input({ style: { ...preset('big-yellow'), wordsPerLine: 3, case: 'none', animation: 'highlight' } })))
  expect(d).toHaveLength(3)
  expect(d[1]).toContain('we {\\1c&HFFFFFF&}set{\\1c&H4DE1FF&} up') // active white on yellow text (#FFE14D → BGR 4DE1FF)
  expect(d[0]).toMatch(/^Dialogue: 0,0:00:00\.00,0:00:00\.50,Default,/)
})

test('typewriter shows words up to the active one', () => {
  const d = dialogues(buildAss(input({ style: { ...preset('typewriter'), wordsPerLine: 3 } })))
  expect(d[0].endsWith('}we{\\1c&HFFFFFF&}') || d[0].includes('}we')).toBe(true)
  expect(d[0]).not.toContain('set')
  expect(d[2]).toContain('set')
})

test('fade adds \\fad once per chunk, slide adds \\move, pop scales the active word', () => {
  const fade = dialogues(buildAss(input({ style: { ...preset('minimal'), wordsPerLine: 3 } })))
  expect(fade).toHaveLength(1)
  expect(fade[0]).toContain('\\fad(120,120)')
  expect(dialogues(buildAss(input({ style: { ...preset('outline-clean'), wordsPerLine: 3 } })))[0]).toMatch(/\\move\(540,\d+,540,\d+,0,150\)/)
  expect(dialogues(buildAss(input()))[1]).toContain('\\t(0,80,\\fscx118\\fscy118)')
})

test('box style uses BorderStyle 4 (one box per line) with the box padding as outline', () => {
  expect(buildAss(input({ style: { ...preset('boxed'), wordsPerLine: 3 } }))).toMatch(/^Style: Default,[^\n]*,4,14,0,5,54,54,0,1$/m)
})

test('upper case applied; braces and backslashes in words cannot inject tags', () => {
  const d = dialogues(buildAss(input({ words: [{ w: '{\\b1}hi\\N', s: 0, e: 1 }] })))
  expect(d[0]).toContain('(/B1)HI/N')
})

test('no words: header only', () => {
  expect(dialogues(buildAss(input({ words: [] })))).toEqual([])
})

test('times format as h:mm:ss.cc and the last word holds until the gap is long', () => {
  const d = dialogues(buildAss(input({ words: [{ w: 'a', s: 61.237, e: 61.5 }, { w: 'b', s: 70, e: 71 }], style: { ...preset('bold-pop'), wordsPerLine: 1 }, duration: 100 })))
  expect(d[0]).toMatch(/^Dialogue: 0,0:01:01\.24,0:01:01\.50,/) // 8.5 s gap: no hold
})

test('text watermark is its own style and spans the whole clip', () => {
  const ass = buildAss(input({ watermarkText: { value: '@clipforge', font: 'Geist', color: '#FFFFFF', opacity: 56, position: 'br', marginPct: 4, sizePct: 12 } }))
  expect(ass).toMatch(/^Style: Watermark,Geist SemiBold,43,&H70FFFFFF,/m)
  expect(ass).toMatch(/^Dialogue: 1,0:00:00\.00,0:00:05\.00,Watermark,,0,0,0,,@clipforge$/m)
})
