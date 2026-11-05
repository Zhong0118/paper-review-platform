/**
 * 学校核验：把服务端 SensitiveReport 按 C-CHECK 分维度读出来（U2 计划 §4.1）。
 * - 自动结论原样映射，不合成 WARN；未知值视为“尚未检测”。
 * - 严重程度只有 BLOCK / WARN，各自计数；扫描页、人工结论单独给出。
 * - 通过规则照搬后端 confirm_anonymization，不另加门槛。
 */
import type { SensitiveFinding } from '@/api/sensitiveChecks'
import type { ThesisDetail } from '@/api/theses'

export type AutoConclusion = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL' | null
export type Tone = 'neutral' | 'action' | 'warning' | 'danger' | 'success'

export interface ReportView {
  auto: AutoConclusion
  stale: boolean
  manual: 'PASS' | 'FAIL' | null
  /** 过期报告的单项发现不再对应当前材料，不展示 */
  findings: SensitiveFinding[]
  blockCount: number
  warnCount: number
  uncertainPages: number[]
  titleStatus: 'FOUND' | 'TITLE_NOT_FOUND' | 'NOT_CHECKED' | null
  termsVersion: number | null
  pageCount: number | null
  /** 学校词表 WARN 项存在时，后端要求通过说明 */
  passNeedsReason: boolean
  /** 后端必拒“通过”的原因；空串表示可以提交 */
  passBlocked: string
}

const AUTO = new Set(['PASS', 'REVIEW_REQUIRED', 'FAIL'])

export function anonymousFile(detail: ThesisDetail) {
  return detail.current_version?.files.find((file) => file.purpose === 'anonymous') ?? null
}

export function originalFile(detail: ThesisDetail) {
  return detail.current_version?.files.find((file) => file.purpose === 'original') ?? null
}

export function readReport(detail: ThesisDetail): ReportView {
  const report = detail.anonymization
  const source = report?.source_metadata ?? null
  const auto = (AUTO.has(report?.auto_conclusion ?? '') ? report!.auto_conclusion : null) as AutoConclusion
  const mismatch = !source || source.file_id !== anonymousFile(detail)?.file_id || source.thesis_version_id !== detail.current_version?.id
  const stale = auto !== null && Boolean(report?.stale || mismatch)
  const findings = stale ? [] : (report?.findings ?? []).filter((finding) => finding.kind !== 'TITLE_NOT_FOUND')
  const manual = report?.manual_conclusion === 'PASS' || report?.manual_conclusion === 'FAIL' ? report.manual_conclusion : null
  let passBlocked = ''
  if (auto === null) passBlocked = '还没有当前匿名稿的检测报告，不能通过核验'
  else if (auto === 'FAIL') passBlocked = '自动检测不通过，不能通过核验'
  else if (stale) passBlocked = '检测报告已过期，不能依据它通过核验'
  return {
    auto,
    stale,
    manual,
    findings,
    blockCount: findings.filter((finding) => finding.severity === 'BLOCK').length,
    warnCount: findings.filter((finding) => finding.severity === 'WARN').length,
    uncertainPages: stale ? [] : [...(source?.uncertain_pages ?? [])],
    titleStatus: source?.title_status ?? null,
    termsVersion: source?.terms_version ?? null,
    pageCount: source?.page_count ?? null,
    passNeedsReason: findings.some((finding) => finding.kind === 'SCHOOL_TERM' && finding.severity === 'WARN'),
    passBlocked,
  }
}

const AUTO_TEXT: Record<Exclude<AutoConclusion, null>, string> = { PASS: '未发现线索', REVIEW_REQUIRED: '需人工复核', FAIL: '不通过' }

export function autoText(auto: AutoConclusion) {
  return auto ? AUTO_TEXT[auto] : '尚未检测'
}

export function autoTone(view: ReportView): Tone {
  if (view.stale || view.auto === 'PASS' || view.auto === null) return 'neutral'
  return view.auto === 'FAIL' ? 'danger' : 'warning'
}

export function reportPills(view: ReportView): { tone: Tone; text: string }[] {
  if (view.manual === 'PASS' && !view.stale) return [{ tone: 'success', text: '人工已通过核验' }]
  if (view.auto === null) return [{ tone: 'neutral', text: '尚未检测' }]
  const pills = [{ tone: autoTone(view), text: `${view.stale ? '上次自动结论' : '自动'}：${autoText(view.auto)}` }]
  if (view.stale) pills.push({ tone: 'warning', text: '报告已过期' })
  return pills
}

export function findingCounts(view: ReportView) {
  if (view.stale || (view.manual === 'PASS' && !view.stale)) return ''
  return [view.blockCount && `阻断 ${view.blockCount}`, view.warnCount && `警告 ${view.warnCount}`].filter(Boolean).join('，')
}

const STAGES: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  PREPARING: '待核验',
  READY_FOR_DISPATCH: '待送出',
  UNDER_REVIEW: '送审中',
  RESULT_PROCESSING: '结果处理中',
  COMPLETED: '已完成',
  TERMINATED: '已终止',
}

export function stageLabel(stage: string) {
  return STAGES[stage] ?? stage
}

export function apiFailure(error: unknown): { status?: number; code?: string; message: string } {
  const response = (error as { response?: { status?: number; data?: { code?: string; message?: string } } })?.response
  return {
    status: response?.status,
    code: response?.data?.code,
    message: response?.data?.message ?? (error instanceof Error ? error.message : '请求失败'),
  }
}

export const isNotFound = (error: unknown) => {
  const failure = apiFailure(error)
  return failure.status === 404 || failure.code === 'RESOURCE_NOT_FOUND' || failure.status === 403
}
