/**
 * 学生视角的阶段文案、材料就绪情况与处理记录。
 * 只翻译服务端给的 stage / files / anonymization / recent_events，不推断、不编造时间。
 */
import type { ThesisDetail } from '@/api/theses'
import type { PillTone } from '@/components/workspace/StatusPill.vue'

export interface StageView {
  pill: string
  tone: PillTone
  next: string
  /** 主动作：edit 需 allowed_actions 含 EDIT_THESIS；result 为阅读正式反馈 */
  action: 'edit' | 'result' | ''
}

export function stageView(thesis: ThesisDetail): StageView {
  switch (thesis.stage) {
    case 'DRAFT':
      return thesis.return_reason
        ? { pill: '已退回', tone: 'warning', next: '按学校的退回原因修改后重新提交', action: 'edit' }
        : { pill: '草稿', tone: 'neutral', next: '补齐信息和材料后提交给学校核验', action: 'edit' }
    case 'SUBMITTED':
    case 'PREPARING':
      return { pill: '学校核验中', tone: 'action', next: '等待学校核验匿名材料，现在不需要你操作', action: '' }
    case 'READY_FOR_DISPATCH':
      return { pill: '待学校送出', tone: 'action', next: '学校已核验通过，等待送出给评阅专家', action: '' }
    case 'UNDER_REVIEW':
      return { pill: '专家评阅中', tone: 'action', next: '评阅进行中，学校发布结果后会通知你', action: '' }
    case 'RESULT_PROCESSING':
      return { pill: '结果处理中', tone: 'action', next: '评阅已完成，学校正在处理结果', action: '' }
    case 'COMPLETED':
      return { pill: '结果已发布', tone: 'success', next: '阅读专家的正式反馈；如有异议可以在反馈页登记', action: 'result' }
    case 'TERMINATED':
      return { pill: '已终止', tone: 'danger', next: '学校终止了这篇论文的送审；如有疑问请联系学院研究生秘书', action: '' }
    default:
      return { pill: thesis.stage, tone: 'neutral', next: '', action: '' }
  }
}

export interface MaterialItem {
  label: string
  text: string
  tone: PillTone
}

/** 草稿的四项就绪情况：论文信息、原稿、匿名稿、匿名检测 */
export function materialsOf(thesis: ThesisDetail): MaterialItem[] {
  const version = thesis.current_version
  const files = version?.files ?? []
  const has = (purpose: string) => files.some((file) => file.purpose === purpose)
  const infoReady = Boolean(version?.title?.trim() && version.abstract?.trim() && version.keywords?.length && version.discipline_code)
  const report = thesis.anonymization
  const check: MaterialItem = !report?.auto_conclusion
    ? { label: '匿名检测', text: '未运行', tone: 'neutral' }
    : report.stale
      ? { label: '匿名检测', text: '需要重新检测', tone: 'warning' }
      : report.auto_conclusion === 'FAIL'
        ? { label: '匿名检测', text: '不通过', tone: 'danger' }
        : report.auto_conclusion === 'REVIEW_REQUIRED'
          ? { label: '匿名检测', text: '有提示', tone: 'warning' }
          : { label: '匿名检测', text: '未发现线索', tone: 'success' }
  return [
    { label: '论文信息', text: infoReady ? '已填写' : '未填完', tone: infoReady ? 'success' : 'warning' },
    { label: '原稿', text: has('original') ? '已上传' : '未上传', tone: has('original') ? 'success' : 'warning' },
    { label: '匿名稿', text: has('anonymous') ? '已上传' : '未上传', tone: has('anonymous') ? 'success' : 'warning' },
    check,
  ]
}

const EVENT_TEXT: Record<string, string> = {
  create_draft: '你创建了这篇论文',
  submit: '你提交了论文',
  start_anonymization: '进入学校核验',
  anonymization_failed: '匿名检测不通过，退回草稿',
  confirm_anonymization: '学校核验通过',
  reject_anonymization: '学校退回修改',
  withdraw: '你撤回了提交',
  confirm_dispatch: '学校送出给评阅专家',
  results_ready: '评阅完成，学校处理结果',
  publish: '学校发布了评阅结果',
  terminate: '学校终止了送审',
}

export function eventText(event: ThesisDetail['recent_events'][number]): string {
  return EVENT_TEXT[event.action] ?? ''
}
