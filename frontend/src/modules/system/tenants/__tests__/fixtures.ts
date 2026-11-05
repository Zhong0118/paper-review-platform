import type { InstitutionOption } from '@/api/catalogs'
import type { SchoolReviewer, TenantSummary } from '@/api/systemOperations'

export const tenantRecord = (patch: Partial<TenantSummary> = {}): TenantSummary => ({
  id: 'tenant-1',
  code: 'pilot',
  name: '试点大学',
  status: 'ACTIVE',
  root_organization: { id: 'org-1', external_id: 'GS', name: '研究生院' },
  reviewer_count: 1,
  created_at: '2026-09-23T08:00:00Z',
  allowed_actions: ['SUSPEND'],
  ...patch,
})

export const reviewerRecord = (patch: Partial<SchoolReviewer> = {}): SchoolReviewer => ({
  membership_id: 'member-1',
  user_id: 'user-1',
  username: 'school.one',
  display_name: '甲管理员',
  external_id: 'T001',
  status: 'ACTIVE',
  is_active: true,
  ...patch,
})

export const institution = (patch: Partial<InstitutionOption> = {}): InstitutionOption => ({
  code: '4111010001',
  name: '北方农业大学',
  province: '北京市',
  city: '北京市',
  level: '本科',
  ...patch,
})
