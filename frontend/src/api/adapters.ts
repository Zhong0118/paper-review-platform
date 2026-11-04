import type { PublishedItem } from '@/api/results'
import type { ThesisDetail } from '@/api/theses'
import type {
  DemoPublishedResult,
  DemoThesisSummary,
  StudentEligibility,
  StudentThesisDetail,
  StudentVisibleStage,
  ThesisFileMeta,
} from '@/demo/types'

export function studentVisibleStage(stage: string): StudentVisibleStage {
  if (stage === 'DRAFT') return 'MATERIALS'
  if (stage === 'SUBMITTED' || stage === 'PREPARING' || stage === 'READY_FOR_DISPATCH') return 'SCHOOL_REVIEW'
  if (stage === 'UNDER_REVIEW') return 'EXPERT_REVIEW'
  if (stage === 'RESULT_PROCESSING') return 'RESULT_PROCESSING'
  return 'COMPLETED'
}

function filesFrom(detail: ThesisDetail): ThesisFileMeta[] {
  return (detail.current_version?.files ?? []).filter(f => f.purpose === 'original' || f.purpose === 'anonymous').map((file) => ({
    id: file.file_id,
    name: file.filename,
    size: 0,
    mimeType: 'application/pdf',
    purpose: file.purpose === 'original' ? 'SCHOOL_ARCHIVE' : 'EXPERT_REVIEW',
    validationStatus: 'VALID',
  }))
}

function displayDiscipline(version:ThesisDetail['current_version']) {
  const local=version?.school_program
  const official=version?.discipline_name ?? ''
  return {code:version?.discipline_code ?? '',name:local ? `${official} · 校内 ${local.code} ${local.name}` : official}
}

export function toStudentThesisDetail(detail: ThesisDetail): StudentThesisDetail {
  const version = detail.current_version
  const files = filesFrom(detail)
  return {
    id: detail.id,
    anonymousId: version?.id?.slice(0, 8) ?? detail.id.slice(0, 8),
    title: version?.title || '未命名论文',
    abstract: version?.abstract ?? '',
    studentId: detail.student?.student_no ?? '',
    studentName: detail.student?.name ?? '',
    batchId: detail.review_batch?.id ?? '',
    batchName: detail.batch_name ?? '',
    discipline: displayDiscipline(version),
    keywords: version?.keywords ?? [],
    originalFileName: files.find((file) => file.purpose === 'SCHOOL_ARCHIVE')?.name ?? '',
    anonymousFileName: files.find((file) => file.purpose === 'EXPERT_REVIEW')?.name ?? '',
    stage: detail.stage as StudentThesisDetail['stage'],
    studentVisibleStage: studentVisibleStage(detail.stage),
    allowedActions: detail.allowed_actions as StudentThesisDetail['allowedActions'],
    timeline: detail.recent_events.map((event, index) => ({
      id: `${event.action}-${index}`,
      kind: 'THESIS_SUBMITTED',
      occurredAt: '时间未提供',
      message: event.reason ?? event.to_stage,
    })),
    publicReason: detail.return_reason ?? undefined,
    submissionSource: 'STUDENT',
    student: {
      id: detail.student?.student_no ?? '',
      name: detail.student?.name ?? '',
      tenantName: detail.student?.tenant_name ?? '',
    },
    form: {
      title: version?.title ?? '',
      abstract: version?.abstract ?? '',
      discipline: { code: version?.discipline_code ?? '', name: version?.discipline_name ?? '' },
      keywords: version?.keywords ?? [],
    },
    files,
    updatedAt: '时间未提供',
    version: detail.version,
  } as StudentThesisDetail & { version: number }
}

export function fallbackEligibility(): StudentEligibility {
  return {
    eligible: true,
    status: 'ELIGIBLE',
    reason: '',
    batchId: 'seed-batch',
    batchName: '2026 年春季硕士论文盲审',
    deadline: '',
  }
}

export function selectSchoolResultQueue(items: ThesisDetail[]): ThesisDetail[] {
  return items.filter((item) => item.stage === 'RESULT_PROCESSING' || item.stage === 'COMPLETED')
}

export function toSchoolRow(detail: ThesisDetail): DemoThesisSummary {
  const version = detail.current_version
  return {
    id: detail.id,
    anonymousId: version?.id?.slice(0, 8) ?? detail.id.slice(0, 8),
    title: version?.title || '未命名论文',
    stage: detail.stage as DemoThesisSummary['stage'],
    studentName: detail.student?.name ?? '',
    studentId: detail.student?.student_no ?? '',
    batchId: '',
    batchName: '',
    discipline: displayDiscipline(version),
    keywords: version?.keywords ?? [],
    originalFileName: '',
    anonymousFileName: '',
    submissionSource: 'STUDENT',
    updatedAt: '时间未提供',
    allowedActions: detail.allowed_actions as DemoThesisSummary['allowedActions'],
    taskProgress: detail.stage,
    version: detail.version,
  } as unknown as DemoThesisSummary & { version: number }
}

/** An absent advice field means the original publication predates the public advice schema. */
export function toAnonymousResult(item: PublishedItem): DemoPublishedResult {
  return { expertAlias: item.alias, score: item.total, recommendation: item.recommendation,
    comment: item.overall_comment, issues: item.issues, revisionAdvice: item.revision_advice ?? null, submittedAt: '' }
}
