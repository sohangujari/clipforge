/** Writes shared/ass-fixtures/<case>.input.json + <case>.ass when ASS_FIXTURES=write (npm run ass:fixtures). Both generators are
 * tested against these files; runs through Vitest so the @/ alias resolves without another dependency. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { join } from 'node:path'
import { buildAss, type AssInput } from '@/lib/ass'
import { keepRanges, middleRanges, retimeWords, zoomAt, zoomRanges, type Range } from '@/lib/cuts'
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
  'hook': { style: builtinPresets[0], words: sample, width: 1080, height: 1920, duration: 6, hook: { text: 'She did NOT expect {this}', end: 3 } },
  'split-middle': { style: { ...builtinPresets[0], animation: 'slide' }, words: sample, width: 1080, height: 1920, duration: 6, middle: [[0.5, 1.6, 50], [3, 9, 66.67]] },
  'hook-top-hindi': { style: { ...boxed, position: 'top' }, words: hindi, width: 1920, height: 1080, duration: 2.5, hook: { text: 'यह देखो', end: 3 } },
}

// Cut/zoom parity: the worker retimes words and builds the zoom curve from what the editor saved.
const talk = ['So', 'um,', 'we', 'set', 'up', 'uh', 'blind', 'dates', 'for', 'science'].map((w, i) => ({ w, s: 10 + i * 0.6 + (i > 5 ? 1.4 : 0), e: 10.45 + i * 0.6 + (i > 5 ? 1.4 : 0) }))
const silences: Range[] = [[9, 10.02], [13.5, 14.95], [16.2, 16.5]]
const keep = keepRanges({ start: 9.5, end: 17.5 }, talk, silences, { fillers: true, pauses: true })
const zooms = zoomRanges(talk, keep, ['blind dates'])
export const cutsFixture = { words: talk, keep, retimed: retimeWords(talk, keep), zooms,
  middle: middleRanges([[9, 12, 2], [13.2, 14.9, 3], [16, 30, 2]], keep, true),
  zoomSamples: [10, 14.9, 15, 15.06, 15.2, 15.75, 15.85, 16].map((t) => [t, zoomAt(zooms, t)]) }
test.runIf(process.env.ASS_FIXTURES === 'write')('write ASS fixtures', () => {
mkdirSync(OUT, { recursive: true })
for (const [id, input] of Object.entries(cases)) {
  writeFileSync(join(OUT, `${id}.input.json`), JSON.stringify(input, null, 2) + '\n')
  writeFileSync(join(OUT, `${id}.ass`), buildAss(input))
}
writeFileSync(join(OUT, '..', 'cuts-fixture.json'), JSON.stringify(cutsFixture, null, 2) + '\n')
console.log(`${Object.keys(cases).length} fixtures → ${OUT}`)
})
