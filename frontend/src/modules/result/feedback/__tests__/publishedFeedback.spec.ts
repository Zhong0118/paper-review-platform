import { expect, it } from 'vitest'

import { readPublished } from '../publishedFeedback'
import { published } from './fixtures'


it('reads a v2 snapshot with its revision advice, scores and outcome', () => {
  const view = readPublished(published())!
  expect(view.schema).toBe(2)
  expect(view.maxTotal).toBe(100)
  expect(view.outcome.label).toBe('通过')
  expect(view.items[0].advice).toEqual({ kind: 'v2', text: '补充对照实验。' })
  expect(view.items[0].scores.map((s) => [s.label, s.score, s.max])).toEqual([['选题与综述', 34, 40], ['研究方法', 52, 60]])
})

it('keeps an empty v2 advice apart from a v1 snapshot that never had the field', () => {
  expect(readPublished(published({}, { revision_advice: '' }))!.items[0].advice).toEqual({ kind: 'v2', text: '' })
  const legacy = published({ snapshot_schema_version: 1 })
  delete (legacy.items[0] as Record<string, unknown>).revision_advice
  expect(readPublished(legacy)!.items[0].advice).toEqual({ kind: 'v1' })
})

it('treats an unknown version or a malformed structure as an interface error', () => {
  expect(readPublished(published({ snapshot_schema_version: 3 }))).toBeNull()
  expect(readPublished(published({ snapshot_schema_version: undefined }))).toBeNull()
  expect(readPublished(published({ snapshot_schema_version: 1 }))).toBeNull()
  expect(readPublished(published({}, { revision_advice: undefined }))).toBeNull()
  expect(readPublished(published({}, { scores: { topic: 34 } }))).toBeNull()
  expect(readPublished(published({}, { issues: null }))).toBeNull()
  expect(readPublished(published({ items: [] }))).toBeNull()
  expect(readPublished(published({ outcome: null }))).toBeNull()
  expect(readPublished(null)).toBeNull()
})

it('keeps zero scores as scores and flags correction states', () => {
  const view = readPublished(published({ correction_pending: true }, { scores: { topic: 0, method: 0 } }))!
  expect(view.items[0].scores.map((s) => s.score)).toEqual([0, 0])
  expect(view.correctionPending).toBe(true)
  expect(view.corrected).toBe(false)
  expect(readPublished(published({ effective_revision_id: 'rev-1' }))!.corrected).toBe(true)
})
