/** Writes shared/ass-fixtures/<case>.input.json + <case>.ass when ASS_FIXTURES=write (npm run ass:fixtures). Both generators are
 * tested against these files; runs through Vitest so the @/ alias resolves without another dependency. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { join } from 'node:path'
import { buildAss, type AssInput } from '@/lib/ass'
import { builtinPresets } from '@/lib/subtitle-presets'

const OUT = join(__dirname, '..', '..', 'shared', 'ass-fixtures')
const sample = ['So', 'we', 'set', 'up', 'blind', 'dates', '{really}'].map((w, i) => ({ w, s: i * 0.45 + (i > 3 ? 0.8 : 0), e: i * 0.45 + 0.4 + (i > 3 ? 0.8 : 0) }))
const hindi = ['हम', 'बाज़ार', 'गए', 'और', 'खाना', 'ख़रीदा'].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.45 }))
const boxed = builtinPresets.find((p) => p.id === 'boxed')!

const cases: Record<string, AssInput> = {
  ...Object.fromEntries(builtinPresets.map((style) => [style.id, { style, words: sample, width: 1080, height: 1920, duration: 6 }])),
  'hindi-boxed': { style: boxed, words: hindi, width: 1080, height: 1920, duration: 4 },
  'square-top-offset': { style: { ...builtinPresets[0], position: 'top', offsetPct: 7, lines: 2 }, words: sample, width: 1080, height: 1080, duration: 6 },
  'watermark-text': { style: builtinPresets[2], words: sample, width: 1920, height: 1080, duration: 6.5,
    watermarkText: { value: '@clipforge', font: 'Geist', color: '#FFFFFF', opacity: 56, position: 'tl', marginPct: 3, sizePct: 15 } },
}
test.runIf(process.env.ASS_FIXTURES === 'write')('write ASS fixtures', () => {
mkdirSync(OUT, { recursive: true })
for (const [id, input] of Object.entries(cases)) {
  writeFileSync(join(OUT, `${id}.input.json`), JSON.stringify(input, null, 2) + '\n')
  writeFileSync(join(OUT, `${id}.ass`), buildAss(input))
}
console.log(`${Object.keys(cases).length} fixtures → ${OUT}`)
})
