import { describe, expect, it } from 'vitest'

import type { ThesisDetail } from '@/api/theses'
import { selectSchoolResultQueue } from '@/api/adapters'

function thesis(partial: Partial<ThesisDetail> & Pick<ThesisDetail, 'id' | 'stage'>): ThesisDetail {
  return {
    version: 1,
    return_reason: null,
    allowed_actions: [],
    anonymization: { auto_conclusion: null, manual_conclusion: null, findings: [] },
    current_version: {
      id: `v-${partial.id}`,
      title: partial.id,
      abstract: '',
      discipline_code: '0812',
      discipline_name: '计算机科学与技术',
      keywords: ['盲审'],
      is_editable: false,
      files: [],
    },
    recent_events: [],
    ...partial,
  }
}

describe('school result queue', () => {
  it('keeps only result-processing and completed theses instead of the first list row', () => {
    const queue = selectSchoolResultQueue([
      thesis({ id: 'draft', stage: 'DRAFT' }),
      thesis({ id: 'ready', stage: 'READY_FOR_DISPATCH' }),
      thesis({ id: 'done', stage: 'COMPLETED', allowed_actions: [] }),
      thesis({ id: 'waiting', stage: 'RESULT_PROCESSING', allowed_actions: ['PUBLISH_RESULT'] }),
    ])
    expect(queue.map((item) => item.id)).toEqual(['done', 'waiting'])
    expect(queue.find((item) => item.id === 'waiting')?.allowed_actions).toEqual(['PUBLISH_RESULT'])
  })
})
