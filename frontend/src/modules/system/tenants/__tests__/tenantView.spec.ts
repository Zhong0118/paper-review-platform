import { describe, expect, it } from 'vitest'

import { codeOwner, emptyTenant, matchTenant, passwordError, reviewerErrors, tenantErrors, toTenantInput, type TenantDraft } from '../tenantView'
import { institution, tenantRecord } from './fixtures'

const filled = (): TenantDraft => ({
  code: ' North-Agri ',
  org_id: ' GS ',
  org_name: ' 研究生院 ',
  reviewer: { display_name: ' 吕青 ', username: ' Lv.Qing ', external_id: ' T009 ', password: 'abcdefghijkl', again: 'abcdefghijkl' },
})

describe('tenantView', () => {
  it('filters by name or code and by status', () => {
    const a = tenantRecord()
    const b = tenantRecord({ id: 't2', code: 'north-agri', name: '北方农业大学', status: 'SUSPENDED' })
    expect([a, b].filter((t) => matchTenant(t, 'AGRI', ''))).toEqual([b])
    expect([a, b].filter((t) => matchTenant(t, '试点', ''))).toEqual([a])
    expect([a, b].filter((t) => matchTenant(t, '', 'SUSPENDED'))).toEqual([b])
    expect([a, b].filter((t) => matchTenant(t, '试点', 'SUSPENDED'))).toEqual([])
  })

  it('checks passwords like the server', () => {
    expect(passwordError('', '')).toBe('请输入密码。')
    expect(passwordError('short', 'short')).toBe('至少 12 位。')
    expect(passwordError('x'.repeat(129), 'x'.repeat(129))).toBe('不超过 128 位。')
    expect(passwordError('abcdefghijkl', 'abcdefghijkm')).toBe('两次输入不一致。')
    expect(passwordError('abcdefghijkl', 'abcdefghijkl')).toBe('')
  })

  it('checks the school and the first admin, including the staff id', () => {
    const errors = tenantErrors(emptyTenant(), null)
    expect(Object.keys(errors).sort()).toEqual(['code', 'institution', 'org_id', 'org_name', 'reviewer'])
    expect(Object.keys(errors.reviewer!).sort()).toEqual(['display_name', 'external_id', 'password', 'username'])
    expect(tenantErrors({ ...filled(), code: 'a' }, institution()).code).toBeTruthy()
    expect(tenantErrors({ ...filled(), code: 'bad_code' }, institution()).code).toBeTruthy()
    expect(reviewerErrors({ ...filled().reviewer, username: 'ab' }).username).toBeTruthy()
    expect(reviewerErrors({ ...filled().reviewer, username: '中文名字' }).username).toBeTruthy()
    expect(tenantErrors(filled(), institution())).toEqual({})
  })

  it('builds the request from the official institution and finds the school using a code', () => {
    expect(toTenantInput(filled(), institution())).toEqual({
      institution_code: '4111010001',
      code: 'north-agri',
      name: '北方农业大学',
      organization: { external_id: 'GS', name: '研究生院' },
      reviewer: { username: 'lv.qing', display_name: '吕青', external_id: 'T009', password: 'abcdefghijkl' },
    })
    expect(codeOwner([tenantRecord()], ' PILOT ')?.id).toBe('tenant-1')
    expect(codeOwner([tenantRecord()], 'other')).toBeNull()
  })
})
