import type { ExpertRecord } from '@/api/expertOperations'

export const expertRecord = (id: string, extra: Partial<ExpertRecord> = {}): ExpertRecord => ({
  id, user_id: `u-${id}`, username: `expert.${id}`, display_name: `专家${id}`, account_status: 'ACTIVE', unit: '示例大学', title: '教授',
  discipline_codes: ['0812'], province_name: '北京市', doctoral_supervisor: true, masters_supervisor: null, research_directions: ['机器学习'],
  keywords: ['图神经网络'], source_url: null, source_note: null, source_checked_at: '2026-10-01T00:00:00Z',
  qualification_status: 'APPROVED', service_status: 'AVAILABLE', conflicts: [], version: 3, ...extra,
})
