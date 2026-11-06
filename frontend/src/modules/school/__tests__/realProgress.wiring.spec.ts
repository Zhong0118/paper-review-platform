import { afterEach, describe, expect, it, vi } from 'vitest'

import { portalMenus } from '@/router/menus'

const api = vi.hoisted(() => ({ schoolProgressList: vi.fn() }))
vi.mock('@/api/dispatch', () => api)
afterEach(() => vi.unstubAllEnvs())

describe('school progress wiring', () => {
  // 真实模式租户显示已随 R3-1 移到 progress/__tests__/schoolProgressDesk.spec.ts
  it('puts live school progress on the real-mode menu', () => {
    expect(portalMenus('school_reviewer', false).map((item) => item.path)).toContain('/school/progress')
  })

  it('maps progress aliases without expert identity', () => {
    const row = {
      thesis_id: 't1',
      title: '门禁论文',
      student_name: '林知远',
      stage: 'UNDER_REVIEW',
      invited_count: 0,
      in_review_count: 1,
      submitted_count: 0,
      rejected_count: 0,
      tasks: [{ alias: 'T-001', status: 'IN_REVIEW' }],
    }
    const blob = JSON.stringify(row)
    expect(blob).toContain('T-001')
    expect(blob).not.toContain('周明远')
    expect(blob).not.toContain('expert_id')
  })
})
