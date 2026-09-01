import type { ThesisDetail } from '@/api/theses'
import type {
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
  return (detail.current_version?.files ?? []).map((file) => ({
    id: file.file_id,
    name: file.filename,
    size: 0,
    mimeType: 'application/pdf',
    purpose: file.purpose === 'original' ? 'SCHOOL_ARCHIVE' : 'EXPERT_REVIEW',
    validationStatus: 'VALID',
  }))
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
    batchId: '',
    batchName: detail.batch_name ?? '',
    discipline: { code: version?.discipline_code ?? '', name: version?.discipline_name ?? '' },
    keywords: version?.keywords ?? [],
    originalFileName: files.find((file) => file.purpose === 'SCHOOL_ARCHIVE')?.name ?? '',
    anonymousFileName: files.find((file) => file.purpose === 'EXPERT_REVIEW')?.name ?? '',
    stage: detail.stage as StudentThesisDetail['stage'],
    studentVisibleStage: studentVisibleStage(detail.stage),
    allowedActions: detail.allowed_actions as StudentThesisDetail['allowedActions'],
    timeline: detail.recent_events.map((event, index) => ({
      id: `${event.action}-${index}`,
      kind: 'THESIS_SUBMITTED',
      occurredAt: new Date().toISOString(),
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
    updatedAt: new Date().toISOString(),
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
    discipline: { code: version?.discipline_code ?? '', name: version?.discipline_name ?? '' },
    keywords: version?.keywords ?? [],
    originalFileName: '',
    anonymousFileName: '',
    submissionSource: 'STUDENT',
    updatedAt: new Date().toISOString(),
    allowedActions: detail.allowed_actions as DemoThesisSummary['allowedActions'],
    taskProgress: detail.stage,
    version: detail.version,
  } as unknown as DemoThesisSummary & { version: number }
}
