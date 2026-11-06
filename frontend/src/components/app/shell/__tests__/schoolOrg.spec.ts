import { describe, expect, it } from 'vitest'

import { schoolOrg } from '../schoolOrg'

describe('schoolOrg (F1 · A1)', () => {
  it('shows the school name when the session has one', () => {
    expect(schoolOrg({ tenantName: '演示大学', tenantCode: 'demo-univ' })).toBe('演示大学')
  })
  it('falls back to the code for sessions saved before tenantName existed', () => {
    expect(schoolOrg({ tenantCode: 'demo-univ' })).toBe('demo-univ')
    expect(schoolOrg({ tenantName: '', tenantCode: 'demo-univ' })).toBe('demo-univ')
  })
  it('is empty without a user', () => {
    expect(schoolOrg(null)).toBe('')
  })
})
