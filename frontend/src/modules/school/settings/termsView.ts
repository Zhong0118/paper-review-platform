/**
 * U4-5 检测词表的纯函数。行 id 只在前端（E13），提交时去掉。
 * 校验与后端 Term / TermsInput 一致：去首尾空白后 2–64 字、无控制字符、不重复，最多 200 条，说明 ≤255。
 */
import type { SensitiveTerm } from '@/api/sensitiveChecks'

export interface TermRow extends SensitiveTerm { id: string }
export const MAX_TERMS = 200

let seq = 0
export const toRows = (terms: SensitiveTerm[]): TermRow[] => terms.map((term) => ({ text: term.text, severity: term.severity, description: term.description ?? '', id: `t${++seq}` }))
export const newRow = (): TermRow => ({ id: `t${++seq}`, text: '', severity: 'WARN', description: '' })
export const cloneRows = (rows: TermRow[]): TermRow[] => rows.map((row) => ({ ...row }))
export const toTerms = (rows: TermRow[]): SensitiveTerm[] => rows.map((row) => ({ text: row.text.trim(), severity: row.severity, description: row.description.trim() }))
export const severityText: Record<SensitiveTerm['severity'], string> = { WARN: '警告', BLOCK: '阻断' }

const length = (value: string) => [...value].length
// eslint-disable-next-line no-control-regex
const control = /[\u0000-\u001f]/

export function rowErrors(rows: TermRow[]): Record<string, { text?: string; description?: string }> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.text.trim(), (counts.get(row.text.trim()) ?? 0) + 1)
  const errors: Record<string, { text?: string; description?: string }> = {}
  for (const row of rows) {
    const text = row.text.trim()
    const item: { text?: string; description?: string } = {}
    if (!text) item.text = '请填写词语，或删除这一行'
    else if (control.test(text)) item.text = '不能包含换行等控制字符'
    else if (length(text) < 2 || length(text) > 64) item.text = '词语需要 2–64 个字'
    else if ((counts.get(text) ?? 0) > 1) item.text = '与其他行重复'
    if (length(row.description.trim()) > 255) item.description = '说明不超过 255 个字'
    if (item.text || item.description) errors[row.id] = item
  }
  return errors
}

const same = (a: SensitiveTerm, b: SensitiveTerm) => a.text.trim() === b.text.trim() && a.severity === b.severity && a.description.trim() === b.description.trim()

/** 相对已保存版本的改动处数（按行 id：新增、修改、删除各算一处） */
export function changeCount(base: TermRow[], rows: TermRow[]): number {
  const before = new Map(base.map((row) => [row.id, row]))
  const after = new Set(rows.map((row) => row.id))
  return rows.filter((row) => !before.has(row.id) || !same(before.get(row.id)!, row)).length + base.filter((row) => !after.has(row.id)).length
}

export interface TermChange { kind: 'added' | 'removed' | 'changed'; text: string; detail: string }

/** 两个版本之间的差异（按词语） */
export function termDiff(before: SensitiveTerm[], after: SensitiveTerm[]): TermChange[] {
  const old = new Map(before.map((term) => [term.text.trim(), term]))
  const next = new Map(after.map((term) => [term.text.trim(), term]))
  const changes: TermChange[] = []
  for (const [text, term] of next) {
    const prior = old.get(text)
    if (!prior) changes.push({ kind: 'added', text, detail: severityText[term.severity] })
    else if (prior.severity !== term.severity) changes.push({ kind: 'changed', text, detail: `${severityText[prior.severity]} → ${severityText[term.severity]}` })
    else if (prior.description.trim() !== term.description.trim()) changes.push({ kind: 'changed', text, detail: '说明已修改' })
  }
  for (const text of old.keys()) if (!next.has(text)) changes.push({ kind: 'removed', text, detail: '' })
  return changes
}

/** 409 后：以对方版本为新基准，按词语套用我的增删改；返回新基准与合并后的表格 */
export function mergeTerms(base: TermRow[], rows: TermRow[], theirs: SensitiveTerm[]): { base: TermRow[]; rows: TermRow[] } {
  const nextBase = toRows(theirs)
  const result = cloneRows(nextBase)
  const find = (text: string) => result.find((row) => row.text.trim() === text.trim())
  const before = new Map(base.map((row) => [row.id, row]))
  const kept = new Set(rows.map((row) => row.id))
  for (const row of base) {
    if (kept.has(row.id)) continue
    const target = find(row.text)
    if (target) result.splice(result.indexOf(target), 1)
  }
  for (const row of rows) {
    const prior = before.get(row.id)
    if (prior && same(prior, row)) continue
    const target = find(prior ? prior.text : row.text) ?? (prior ? find(row.text) : undefined)
    if (target) Object.assign(target, { text: row.text, severity: row.severity, description: row.description })
    else result.push({ ...row, id: newRow().id })
  }
  return { base: nextBase, rows: result }
}
