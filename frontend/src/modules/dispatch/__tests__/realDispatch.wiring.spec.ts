import { describe, expect, it } from 'vitest'

import type { ExpertInvitation } from '@/api/expertTasks'

function invitationProjection(row: ExpertInvitation) {
  return {
    anonymousId: row.anonymous_id,
    discipline: row.discipline_name,
    status: row.status,
  }
}

describe('real dispatch wiring', () => {
  it('maps queue item without exposing original file ids to the expert invitation view', () => {
    const view = invitationProjection({
      id: 'task-1',
      status: 'INVITED',
      discipline_code: '0812',
      discipline_name: '计算机科学与技术',
      anonymous_id: 'ab12cd34',
      fee: '未启用',
    })
    expect(view.anonymousId).toBe('ab12cd34')
    expect(view).not.toHaveProperty('files')
    expect(JSON.stringify(view)).not.toContain('original')
  })
})
