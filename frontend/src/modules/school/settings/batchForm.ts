/**
 * U4-3 批次表单：服务端批次 ↔ 编辑缓冲。起止时间用本地 datetime-local 字符串编辑，提交时转回 ISO。
 * 期限留空 = 不限期（null）；只收 1–32767 的整数（DeadlineInput）。
 */
import type { ReviewBatch } from '@/api/schoolOperations'

export interface BatchForm {
  name: string
  startAt: string
  endAt: string
  acceptDays: string
  reviewDays: string
}

export function toLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

export function formFrom(batch: ReviewBatch): BatchForm {
  return {
    name: batch.name,
    startAt: toLocal(batch.start_at),
    endAt: toLocal(batch.end_at),
    acceptDays: batch.accept_days == null ? '' : String(batch.accept_days),
    reviewDays: batch.review_days == null ? '' : String(batch.review_days),
  }
}

/** null = 不限期；undefined = 不是合法天数 */
export function parseDays(value: string): number | null | undefined {
  const text = value.trim()
  if (!text) return null
  if (!/^\d+$/.test(text)) return undefined
  const days = Number(text)
  return days >= 1 && days <= 32767 ? days : undefined
}

const BASIC = ['name', 'startAt', 'endAt'] as const
const DEADLINES = ['acceptDays', 'reviewDays'] as const
export const fieldLabels: Record<keyof BatchForm, string> = {
  name: '名称', startAt: '开始时间', endAt: '结束时间', acceptDays: '接单期限（天）', reviewDays: '评阅期限（天）',
}

const same = (form: BatchForm, server: BatchForm, key: keyof BatchForm) => form[key].trim() === server[key].trim()

export function changedParts(form: BatchForm, batch: ReviewBatch) {
  const server = formFrom(batch)
  return {
    basic: BASIC.some((key) => !same(form, server, key)),
    deadlines: DEADLINES.some((key) => !same(form, server, key)),
  }
}

export function display(key: keyof BatchForm, value: string): string {
  if (!value.trim()) return key === 'acceptDays' || key === 'reviewDays' ? '不限期' : key === 'name' ? '（空）' : '未设置'
  return key === 'startAt' || key === 'endAt' ? value.replace('T', ' ') : value.trim()
}

export interface FieldDiff { key: keyof BatchForm; label: string; mine: string; theirs: string }

/** 你的修改与服务端当前值不同的字段 */
export function diffFields(form: BatchForm, batch: ReviewBatch): FieldDiff[] {
  const server = formFrom(batch)
  return (Object.keys(fieldLabels) as (keyof BatchForm)[])
    .filter((key) => !same(form, server, key))
    .map((key) => ({ key, label: fieldLabels[key], mine: display(key, form[key]), theirs: display(key, server[key]) }))
}

export type FormErrors = Partial<Record<keyof BatchForm, string>>

export function validate(form: BatchForm, parts: { basic: boolean; deadlines: boolean }): FormErrors {
  const errors: FormErrors = {}
  if (parts.basic) {
    if (!form.name.trim()) errors.name = '请填写名称。'
    else if (form.name.trim().length > 128) errors.name = '名称不超过 128 个字。'
    if (form.startAt && form.endAt && new Date(form.startAt) >= new Date(form.endAt)) errors.endAt = '结束时间须晚于开始时间。'
  }
  if (parts.deadlines) {
    if (parseDays(form.acceptDays) === undefined) errors.acceptDays = '请填写 1–32767 的整数，或留空表示不限期。'
    if (parseDays(form.reviewDays) === undefined) errors.reviewDays = '请填写 1–32767 的整数，或留空表示不限期。'
  }
  return errors
}

export const batchStatusText: Record<ReviewBatch['status'], string> = {
  DRAFT: '草稿', OPEN: '开放中', SUBMISSION_CLOSED: '已截止收件', ARCHIVED: '已归档',
}
const ORDER: ReviewBatch['status'][] = ['OPEN', 'DRAFT', 'SUBMISSION_CLOSED', 'ARCHIVED']
export function sortBatches(rows: ReviewBatch[]): ReviewBatch[] {
  return [...rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
}
