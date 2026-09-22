import { httpApi } from './request'
import type { ReviewScoreInput } from '@/demo/types'

export function getReviewDraft(taskId: string) {
  return httpApi.get<Partial<ReviewScoreInput>>(`/expert/tasks/${taskId}/draft`)
}

export function saveReviewDraft(taskId: string, payload: ReviewScoreInput) {
  return httpApi.put(`/expert/tasks/${taskId}/draft`, payload)
}

export function submitFinalReview(taskId: string, payload: ReviewScoreInput) {
  return httpApi.post(`/expert/tasks/${taskId}:submit-final`, payload, {
    idempotencyKey: crypto.randomUUID(),
  })
}

export function getReviewResult(taskId: string) {
  return httpApi.get<ReviewScoreInput>(`/expert/tasks/${taskId}/result`)
}
