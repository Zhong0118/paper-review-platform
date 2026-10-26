import { httpApi } from './request'
import type { CheckSummary } from './reviewChecks'
import type { ReviewScoreInput } from '@/demo/types'

export type CorrectionStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'AWAITING_SCHOOL' | 'ACTIVATED' | 'SCHOOL_REJECTED'
export interface Correction {
  id: string; task_id: string; thesis_id?: string; status: CorrectionStatus; version: number
  base_result_id: string; base_revision_id: string | null; created_at: string
  notes: { kind: string; reason: string }[]
  draft_payload?: Partial<ReviewScoreInput>
  before?: { total: number; payload: ReviewScoreInput } | null
  revision: { id: string; total: number; check_summary?: CheckSummary | null; payload: ReviewScoreInput } | null
}
export interface TaskCorrections {
  base_result_id: string; base_revision_id: string | null
  current_payload: ReviewScoreInput; requests: Correction[]
}
export function getTaskCorrections(taskId: string) {
  return httpApi.get<TaskCorrections>(`/expert-tasks/${taskId}/corrections`)
}
export function listCorrections(mode: 'platform' | 'school') {
  return httpApi.get<Correction[]>(`/${mode}-review/corrections`)
}
export type CorrectionAction = 'request' | 'cancel' | 'decide' | 'draft' | 'submit' | 'activate' | 'reject'
export function correctionCommand(action: CorrectionAction, target: string, body: unknown, key: string) {
  const path = {
    request: `/expert-tasks/${target}/corrections`, cancel: `/corrections/${target}:cancel`,
    decide: `/platform-review/corrections/${target}:decide`, draft: `/expert-corrections/${target}/draft`,
    submit: `/expert-corrections/${target}:submit`, activate: `/school-review/corrections/${target}:activate`,
    reject: `/school-review/corrections/${target}:reject`,
  }[action]
  return action === 'draft' ? httpApi.put<Correction>(path, body, { idempotencyKey: key })
    : httpApi.post<Correction>(path, body, { idempotencyKey: key })
}
