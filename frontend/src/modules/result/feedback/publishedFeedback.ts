/**
 * U2-6 正式反馈：按发布快照 schema 版本解读已发布结果（v2.1 C-RESULT）。
 * - v1（服务端对无版本标记的旧快照补 1）：没有 revision_advice → “此历史发布版本未收录修改建议”。
 * - v2：每条评阅都带 revision_advice 字符串；空字符串 → “未填写修改建议”。
 * - 未知版本或结构不对（缺字段、类型不符、v1 却带修改建议）→ 整体按接口错误处理，一个部分也不显示，不猜。
 * 只取公开字段：总分、档位、建议、总体评价、主要问题、修改建议、分项得分；不读 strengths 或分项评价文字。
 */
export type Advice = { kind: 'v1' } | { kind: 'v2'; text: string }

export interface FeedbackScore {
  key: string
  label: string
  score: number
  max: number
}

export interface FeedbackItem {
  alias: string
  total: number
  recommendation: string
  overall: string
  issues: string
  advice: Advice
  scores: FeedbackScore[]
}

export interface FeedbackView {
  schema: 1 | 2
  total: number
  outcome: { code: string; label: string }
  ruleVersion: string
  maxTotal: number
  items: FeedbackItem[]
  /** 有专家更正待学校确认：当前仍显示已发布版本 */
  correctionPending: boolean
  /** 这是学校确认更正后的发布版本 */
  corrected: boolean
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isText = (value: unknown): value is string => typeof value === 'string'

/** 返回 null 表示快照无法识别；调用方按接口错误处理 */
export function readPublished(data: unknown): FeedbackView | null {
  if (!isObject(data)) return null
  const schema = data.snapshot_schema_version
  if (schema !== 1 && schema !== 2) return null
  if (!isNumber(data.total) || !isObject(data.outcome) || !isText(data.outcome.code) || !isText(data.outcome.label)) return null
  const rule = data.rule_snapshot
  if (!isObject(rule) || !isText(rule.version) || !Array.isArray(rule.dimensions) || !rule.dimensions.length) return null
  const dimensions: { key: string; label: string; max: number }[] = []
  for (const dimension of rule.dimensions) {
    if (!isObject(dimension) || !isText(dimension.key) || !isText(dimension.label) || !isNumber(dimension.max_score)) return null
    dimensions.push({ key: dimension.key, label: dimension.label, max: dimension.max_score })
  }
  if (!Array.isArray(data.items) || !data.items.length) return null
  const items: FeedbackItem[] = []
  for (const raw of data.items) {
    if (!isObject(raw) || !isText(raw.alias) || !isNumber(raw.total) || !isObject(raw.scores)) return null
    if (!isText(raw.recommendation) || !isText(raw.overall_comment) || !isText(raw.issues)) return null
    let advice: Advice
    if (schema === 2) {
      if (!isText(raw.revision_advice)) return null
      advice = { kind: 'v2', text: raw.revision_advice }
    } else {
      if ('revision_advice' in raw) return null
      advice = { kind: 'v1' }
    }
    const scores: FeedbackScore[] = []
    for (const dimension of dimensions) {
      const score = raw.scores[dimension.key]
      if (!isNumber(score)) return null
      scores.push({ ...dimension, score })
    }
    items.push({ alias: raw.alias, total: raw.total, recommendation: raw.recommendation, overall: raw.overall_comment, issues: raw.issues, advice, scores })
  }
  return {
    schema,
    total: data.total,
    outcome: { code: data.outcome.code, label: data.outcome.label },
    ruleVersion: rule.version,
    maxTotal: dimensions.reduce((sum, dimension) => sum + dimension.max, 0),
    items,
    correctionPending: data.correction_pending === true,
    corrected: isText(data.effective_revision_id) && data.effective_revision_id.length > 0,
  }
}
