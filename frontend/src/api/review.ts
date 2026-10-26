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

export function getReviewDraft(taskId: string) {
  return httpApi.get<Partial<ReviewScoreInput>>(`/expert/tasks/${taskId}/draft`)
}

export function saveReviewDraft(taskId: string, payload: ReviewScoreInput) {
  return httpApi.put(`/expert/tasks/${taskId}/draft`, payload)
}

export function submitFinalReview(taskId: string, payload: ReviewScoreInput, checkAck?: CheckAck) {
  return httpApi.post(`/expert/tasks/${taskId}:submit-final`, { ...payload, ...(checkAck ? { check_ack: checkAck } : {}) }, {
    idempotencyKey: crypto.randomUUID(),
  })
}

export function getReviewResult(taskId: string) {
  return httpApi.get<ReviewScoreInput>(`/expert/tasks/${taskId}/result`)
}
