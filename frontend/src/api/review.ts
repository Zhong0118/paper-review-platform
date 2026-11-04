import { httpApi } from './request'
import type { CheckAck } from './reviewChecks'
import type { ReviewDimensionKey, ReviewScoreInput } from '@/demo/types'

export interface ReviewRuleDimension {
  key: ReviewDimensionKey
  label: string
  max_score: number
}

export interface ReviewRule {
  version: string
  required_experts: number
  mode: string
  dimensions: ReviewRuleDimension[]
  bands: { min: number; max: number; code: string; label: string }[]
}

export function getReviewRules(taskId: string) {
  return httpApi.get<ReviewRule>(`/expert/tasks/${taskId}/rules`)
}

export type SavedReviewDraft = Partial<ReviewScoreInput> & { revision: number }

export function getReviewDraft(taskId: string) {
  return httpApi.get<SavedReviewDraft>(`/expert/tasks/${taskId}/draft`)
}

export function saveReviewDraft(taskId: string, payload: ReviewScoreInput, expectedRevision: number) {
  return httpApi.put<SavedReviewDraft>(`/expert/tasks/${taskId}/draft`, { ...payload, expected_revision: expectedRevision })
}

export function submitFinalReview(taskId: string, payload: ReviewScoreInput, checkAck: CheckAck | undefined, expectedRevision: number, idempotencyKey: string) {
  return httpApi.post(`/expert/tasks/${taskId}:submit-final`, { ...payload, expected_revision: expectedRevision, ...(checkAck ? { check_ack: checkAck } : {}) }, {
    idempotencyKey,
  })
}

export function getReviewResult(taskId: string) {
  return httpApi.get<ReviewScoreInput>(`/expert/tasks/${taskId}/result`)
}
