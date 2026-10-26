import { beforeEach, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/api/request', () => ({ httpApi: http }))

import {
  createTenant, listTenants, listReviewers, createReviewer, suspendTenant,
  disableReviewer, resetReviewerPassword,
} from '../systemOperations'
import {
  createBatch, listBatches, updateBatch, openBatch, closeBatch, archiveBatch,
  listMembers, createMember, updateMember, disableMember, resetMemberPassword,
  listEligibilities, createEligibility, suspendEligibility,
} from '../schoolOperations'

beforeEach(() => vi.resetAllMocks())

it('uses system endpoints and passes one explicit idempotency key with each command', async () => {
  const options = { idempotencyKey: 'one-click' }
  const reviewer = { username: 'school.one', display_name: '管理员', external_id: 'staff-1', password: 'long-secret-1' }
  const tenant = { code: 'pilot', name: '试点学校', organization: { external_id: 'root', name: '试点学校' }, reviewer }
  await listTenants()
  await createTenant(tenant, options)
  await listReviewers('tenant-1')
  await createReviewer('tenant-1', reviewer, options)
  await suspendTenant('tenant-1', options)
  await disableReviewer('tenant-1', 'user-1', options)
  await resetReviewerPassword('tenant-1', 'user-1', 'replacement-secret', options)
  expect(http.get).toHaveBeenCalledWith('/system/tenants')
  expect(http.get).toHaveBeenCalledWith('/system/tenants/tenant-1/reviewers')
  expect(http.post).toHaveBeenCalledWith('/system/tenants', tenant, options)
  expect(http.post).toHaveBeenCalledWith('/system/tenants/tenant-1/reviewers', reviewer, options)
  expect(http.post).toHaveBeenCalledWith('/system/tenants/tenant-1:suspend', {}, options)
  expect(http.post).toHaveBeenCalledWith('/system/tenants/tenant-1/reviewers/user-1:disable', {}, options)
  expect(http.post).toHaveBeenCalledWith('/system/tenants/tenant-1/reviewers/user-1:reset-password', { password: 'replacement-secret' }, options)
  expect(JSON.stringify(tenant)).not.toContain('tenant_id')
  expect(JSON.stringify(tenant)).not.toContain('password_hash')
})

it('uses school batch commands with server version and caller-provided key', async () => {
  const options = { idempotencyKey: 'batch-click' }
  await listBatches()
  await createBatch({ code: '2027', name: '2027 批次', start_at: null, end_at: null }, options)
  await updateBatch('batch-1', { name: '新名称', start_at: null, end_at: null, expected_version: 2 })
  await openBatch('batch-1', 3, options)
  await closeBatch('batch-1', 4, options)
  await archiveBatch('batch-1', 5, options)
  expect(http.get).toHaveBeenCalledWith('/school-admin/batches')
  expect(http.patch).toHaveBeenCalledWith('/school-admin/batches/batch-1', { name: '新名称', start_at: null, end_at: null, expected_version: 2 })
  expect(http.post).toHaveBeenCalledWith('/school-admin/batches/batch-1:open', { expected_version: 3 }, options)
  expect(http.post).toHaveBeenCalledWith('/school-admin/batches/batch-1:close-submissions', { expected_version: 4 }, options)
  expect(http.post).toHaveBeenCalledWith('/school-admin/batches/batch-1:archive', { expected_version: 5 }, options)
})

it('passes member and eligibility data without client-supplied tenant or snapshots', async () => {
  const options = { idempotencyKey: 'member-click' }
  const member = { membership_type: 'STUDENT' as const, username: 'student.new', display_name: '新学生', external_id: '20270001', password: 'long-secret-1' }
  const eligibility = { student_membership_id: 'student-member', supervisor_membership_id: 'supervisor-member', degree_type: '工学硕士' }
  await listMembers('STUDENT')
  await createMember(member, options)
  await updateMember('member-1', { display_name: '更名', contact_phone: null, contact_email: null, expected_updated_at: '2026-09-23T00:00:00Z' })
  await disableMember('member-1', options)
  await resetMemberPassword('member-1', 'replacement-secret', options)
  await listEligibilities('batch-1')
  await createEligibility('batch-1', eligibility, options)
  await suspendEligibility('eligibility-1', options)
  expect(http.get).toHaveBeenCalledWith('/school-admin/members', { params: { membership_type: 'STUDENT' } })
  expect(http.post).toHaveBeenCalledWith('/school-admin/members', member, options)
  expect(http.patch).toHaveBeenCalledWith('/school-admin/members/member-1', expect.objectContaining({ expected_updated_at: '2026-09-23T00:00:00Z' }))
  expect(http.post).toHaveBeenCalledWith('/school-admin/members/member-1:disable', {}, options)
  expect(http.post).toHaveBeenCalledWith('/school-admin/members/member-1:reset-password', { password: 'replacement-secret' }, options)
  expect(http.get).toHaveBeenCalledWith('/school-admin/batches/batch-1/eligibilities')
  expect(http.post).toHaveBeenCalledWith('/school-admin/batches/batch-1/eligibilities', eligibility, options)
  expect(http.post).toHaveBeenCalledWith('/school-admin/eligibilities/eligibility-1:suspend', {}, options)
  expect(JSON.stringify({ member, eligibility })).not.toContain('tenant_id')
  expect(JSON.stringify(eligibility)).not.toContain('student_name')
})
