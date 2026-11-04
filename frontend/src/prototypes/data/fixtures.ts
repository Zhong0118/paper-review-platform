/**
 * U1 原型的虚构数据。所有姓名、学校、论文与评语均为虚构，仅用于判断信息顺序与密度。
 * 字段形状参照现有 API（dispatch.ts、sensitiveChecks.ts、review/rules.py），但不是接口合同。
 */
import type { MockPage, ProtoAccount } from '../kit/types'

export const accounts = {
  school: { name: '王宁', username: 'demo_school_01', role: '学校审核', org: '学校代码 demo-u01' },
  platform: { name: '李沐', username: 'demo_ops_02', role: '百杰运营', org: '平台级账号' },
  expert: { name: '王曦', username: 'demo_expert_07', role: '专家', org: '平台级账号' },
  student: { name: '林知夏', username: 'demo_stu_2023101', role: '学生', org: '学校代码 demo-u01' },
  supervisor: { name: '周衡', username: 'demo_sup_0042', role: '导师', org: '学校代码 demo-u01' },
} satisfies Record<string, ProtoAccount>

/** 与现行 sensitiveChecks 投影一致：自动结论、单项严重程度、时效、人工结论是不同维度。 */
export type AutoConclusion = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL' | null
export type QueueView = 'verify' | 'ready' | 'returned' | 'other'

export interface SchoolRow {
  id: string
  title: string
  student: string
  studentNo: string
  program: string
  materialVersion: number
  check: { auto: AutoConclusion; warn: number; block: number; stale: boolean; manual: 'PASS' | 'REJECT' | null } | null
  view: QueueView
  statusText: string
  updated: string
}

export const schoolRows: SchoolRow[] = [
  { id: 't01', title: '面向边缘计算的容错任务调度方法研究', student: '林知夏', studentNo: '2023101', program: '0812 计算机科学与技术', materialVersion: 2, check: { auto: 'REVIEW_REQUIRED', warn: 2, block: 0, stale: false, manual: null }, view: 'verify', statusText: '待核验', updated: '11-04 09:12' },
  { id: 't02', title: '黄河下游滩区土地利用变化及其生态效应：基于 1990—2025 年遥感影像的分析', student: '陈予安', studentNo: '2022087', program: '0705 地理学', materialVersion: 1, check: { auto: 'PASS', warn: 0, block: 0, stale: false, manual: null }, view: 'verify', statusText: '待核验', updated: '11-04 08:40' },
  { id: 't03', title: '宋代地方志书写中的水利叙事', student: '许清禾', studentNo: '2021033', program: '0602 中国史', materialVersion: 3, check: { auto: 'FAIL', warn: 1, block: 1, stale: false, manual: null }, view: 'verify', statusText: '待核验', updated: '11-03 17:25' },
  { id: 't04', title: '基于深度强化学习的微电网能量管理策略', student: '赵屿', studentNo: '2023056', program: '0808 电气工程', materialVersion: 2, check: { auto: 'PASS', warn: 0, block: 0, stale: true, manual: null }, view: 'verify', statusText: '待核验', updated: '11-03 15:02' },
  { id: 't05', title: '城市更新中的社区参与机制研究——以三个街道为例', student: '孙亦舟', studentNo: '2022140', program: '1204 公共管理', materialVersion: 1, check: { auto: 'REVIEW_REQUIRED', warn: 1, block: 0, stale: false, manual: null }, view: 'verify', statusText: '待核验', updated: '11-03 11:47' },
  { id: 't06', title: '高熵合金涂层的高温氧化行为', student: '韩芷若', studentNo: '2023019', program: '0805 材料科学与工程', materialVersion: 1, check: { auto: 'PASS', warn: 0, block: 0, stale: false, manual: null }, view: 'verify', statusText: '待核验', updated: '11-02 20:16' },
  { id: 't07', title: '低资源场景下的藏汉神经机器翻译', student: '吴见山', studentNo: '2022066', program: '0812 计算机科学与技术', materialVersion: 2, check: { auto: 'REVIEW_REQUIRED', warn: 3, block: 0, stale: false, manual: null }, view: 'verify', statusText: '待核验', updated: '11-02 16:30' },
  { id: 't08', title: '碳排放权交易对制造业企业绿色创新的影响', student: '沈星遥', studentNo: '2021102', program: '0202 应用经济学', materialVersion: 2, check: { auto: 'PASS', warn: 0, block: 0, stale: false, manual: 'PASS' }, view: 'ready', statusText: '已通过核验，待确认送出', updated: '11-02 10:05' },
  { id: 't09', title: '儿童青少年近视进展的影响因素队列研究', student: '郭南乔', studentNo: '2022011', program: '1004 公共卫生与预防医学', materialVersion: 1, check: { auto: 'REVIEW_REQUIRED', warn: 1, block: 0, stale: false, manual: 'PASS' }, view: 'ready', statusText: '已通过核验，待确认送出', updated: '11-01 14:22' },
  { id: 't10', title: '明清徽州契约文书中的女性财产权', student: '唐砚', studentNo: '2020045', program: '0602 中国史', materialVersion: 2, check: { auto: 'PASS', warn: 0, block: 0, stale: false, manual: 'PASS' }, view: 'ready', statusText: '已通过核验，待确认送出', updated: '10-31 09:48' },
  { id: 't11', title: '大跨度斜拉桥风致振动的主动控制', student: '宋可期', studentNo: '2021077', program: '0814 土木工程', materialVersion: 2, check: { auto: 'FAIL', warn: 0, block: 2, stale: false, manual: 'REJECT' }, view: 'returned', statusText: '已退回，等待学生修改', updated: '10-30 18:11' },
  { id: 't12', title: '二维材料异质结中的激子输运', student: '何未晞', studentNo: '2022093', program: '0702 物理学', materialVersion: 1, check: { auto: 'REVIEW_REQUIRED', warn: 2, block: 0, stale: false, manual: 'REJECT' }, view: 'returned', statusText: '已退回，等待学生修改', updated: '10-29 13:37' },
  { id: 't13', title: '乡村振兴背景下县域职业教育供给研究', student: '罗以宁', studentNo: '2021120', program: '0401 教育学', materialVersion: 1, check: null, view: 'other', statusText: '已送出，评审中', updated: '10-27 10:20' },
  { id: 't14', title: '多模态医学影像的弱监督分割方法', student: '秦朗', studentNo: '2022058', program: '0812 计算机科学与技术', materialVersion: 2, check: null, view: 'other', statusText: '结果已发布', updated: '10-20 16:00' },
  { id: 't15', title: '数字平台算法定价的反垄断规制', student: '周子期', studentNo: '2021009', program: '0301 法学', materialVersion: 1, check: null, view: 'other', statusText: '已送出，待平台派单', updated: '10-18 09:30' },
]

export interface Finding {
  id: string
  /** 单项严重程度只有 WARN / BLOCK；无法提取文字的页来自 source_metadata.uncertain_pages，不是严重程度 */
  severity: 'BLOCK' | 'WARN'
  kind: string
  page: number
  matched: string
  context: string
  source: string
}

export const verifyFindings: Record<string, Finding[]> = {
  warn: [
    { id: 'f1', severity: 'WARN', kind: '身份线索', page: 3, matched: '周老师', context: '……感谢周老师在选题与实验设计上给予的耐心指导……', source: '致谢' },
    { id: 'f2', severity: 'WARN', kind: '学校词表', page: 7, matched: '东湖校区实验平台', context: '……实验在东湖校区实验平台的 32 节点集群上完成……', source: '本校词表 v12' },
  ],
  fail: [
    { id: 'f4', severity: 'BLOCK', kind: '身份线索', page: 1, matched: '作者：许清禾', context: '封面保留了作者姓名与学号。', source: '检测器' },
    { id: 'f1', severity: 'WARN', kind: '身份线索', page: 3, matched: '周老师', context: '……感谢周老师在选题与实验设计上给予的耐心指导……', source: '致谢' },
  ],
}

const body = (topic: string) => [
  `本章围绕${topic}展开。首先说明问题背景与已有研究的不足，随后给出本文的研究假设与技术路线。`,
  '已有方法大多假设节点失效相互独立，并以静态冗余换取可靠性；在资源受限、负载波动明显的场景下，这一假设往往不成立，冗余成本也难以承受。',
  '本文将失效相关性显式纳入调度模型，提出一种按任务关键度分级的副本放置策略，并给出近似最优性的理论界。',
  '实验部分在模拟环境与真实集群上分别验证。结果显示，在同等资源开销下，任务完成率较基线方法提高约 9 个百分点，尾部延迟下降约三成。',
  '需要指出的是，上述结论依赖于失效相关性的估计精度；当估计偏差较大时，策略收益会明显收窄，第五章对此作了敏感性分析。',
]

export function documentPages(kind: 'anonymous' | 'original', count = 12): MockPage[] {
  const cover: MockPage =
    kind === 'original'
      ? { heading: '面向边缘计算的容错任务调度方法研究', lines: ['作者：林知夏　学号：2023101', '导师：周衡 教授', '学科：0812 计算机科学与技术', '示例大学　二〇二六年十月'] }
      : { heading: '面向边缘计算的容错任务调度方法研究', lines: ['作者：［已匿名］', '导师：［已匿名］', '学科：0812 计算机科学与技术', '［培养单位已匿名］　二〇二六年十月'] }
  const pages: MockPage[] = [cover, { heading: '摘　要', lines: body('边缘计算任务调度的容错问题').slice(0, 4) }]
  const chapters = ['绪论', '相关工作', '问题建模', '分级副本放置策略', '实验与分析', '结论与展望']
  for (let i = 2; i < count; i++) {
    const chapter = chapters[(i - 2) % chapters.length]!
    const lines = body(chapter)
    if (i === 2) lines.push('致谢：感谢周老师在选题与实验设计上给予的耐心指导。')
    if (i === 6) lines.push('实验在东湖校区实验平台的 32 节点集群上完成，平台配置见附录 B。')
    pages.push({ heading: i % 2 === 0 ? `第${['一', '二', '三', '四', '五', '六'][(i - 2) % 6]}章　${chapter}` : undefined, lines })
  }
  return pages
}

/** 规则快照：形状与 backend/app/modules/review/rules.py 的 pilot-single-v1 一致。 */
export const reviewRule = {
  version: 'pilot-single-v1',
  dimensions: [
    { key: 'topicValue', label: '选题价值', max_score: 15 },
    { key: 'literatureTheory', label: '文献与理论基础', max_score: 15 },
    { key: 'methodology', label: '研究方法', max_score: 20 },
    { key: 'innovation', label: '创新性', max_score: 25 },
    { key: 'writingStandards', label: '写作与学术规范', max_score: 10 },
    { key: 'resultsWorkload', label: '研究成果与工作量', max_score: 15 },
  ],
  bands: [
    { min: 0, max: 59, code: 'FAIL', label: '不通过' },
    { min: 60, max: 79, code: 'REVISION_REQUIRED', label: '修改后通过' },
    { min: 80, max: 100, code: 'PASS', label: '通过' },
  ],
} as const

export type DimensionKey = (typeof reviewRule.dimensions)[number]['key']

export interface DispatchItem {
  id: string
  title: string
  school: string
  program: string
  keywords: string[]
  view: 'pending' | 'active' | 'follow'
  line: string
  task?: { expert: string; status: string; since: string; deadline: string }
  history?: { expert: string; result: string; at: string; note: string }[]
  extension?: { expert: string; original: string; requested: string; reason: string }
}

export const dispatchItems: DispatchItem[] = [
  { id: 'd1', title: '面向边缘计算的容错任务调度方法研究', school: '示例大学', program: '0812 计算机科学与技术', keywords: ['边缘计算', '容错调度', '副本放置'], view: 'pending', line: '学校已确认送出，待指派' },
  { id: 'd2', title: '低资源场景下的藏汉神经机器翻译', school: '示例大学', program: '0812 计算机科学与技术', keywords: ['机器翻译', '低资源', '藏语'], view: 'follow', line: '专家已拒绝，需重新指派', history: [{ expert: '方立', result: '已拒绝', at: '11-03 10:12', note: '时间冲突，11 月下旬出差' }] },
  { id: 'd3', title: '碳排放权交易对制造业企业绿色创新的影响', school: '示例财经学院', program: '0202 应用经济学', keywords: ['碳交易', '绿色创新'], view: 'pending', line: '学校已确认送出，待指派' },
  { id: 'd4', title: '大跨度斜拉桥风致振动的主动控制', school: '示例理工大学', program: '0814 土木工程', keywords: ['斜拉桥', '风振控制'], view: 'pending', line: '学校已确认送出，待指派' },
  { id: 'd5', title: '多模态医学影像的弱监督分割方法', school: '示例大学', program: '0812 计算机科学与技术', keywords: ['医学影像', '弱监督'], view: 'active', line: '评阅中，截止 11-20', task: { expert: '顾远', status: '评阅中', since: '10-28', deadline: '11-20' } },
  { id: 'd6', title: '二维材料异质结中的激子输运', school: '示例理工大学', program: '0702 物理学', keywords: ['二维材料', '激子'], view: 'follow', line: '延期申请待审批', task: { expert: '白露', status: '评阅中', since: '10-25', deadline: '11-10' }, extension: { expert: '白露', original: '11-10', requested: '11-17', reason: '需要复核第四章的实验数据，与作者原始数据表对照。' } },
]

export interface Candidate {
  id: string
  name: string
  unit: string
  title: string
  score: number
  reasons: { kind: '研究方向' | '关键词'; tag: string; points: number }[]
  invited: number
  inReview: number
  blocked: string | null
  version: number
}

export const candidates: Candidate[] = [
  { id: 'e1', name: '王曦', unit: '示例工业大学 计算机学院', title: '教授', score: 14, reasons: [{ kind: '研究方向', tag: '分布式系统', points: 6 }, { kind: '研究方向', tag: '边缘计算', points: 5 }, { kind: '关键词', tag: '容错调度', points: 3 }], invited: 0, inReview: 2, blocked: null, version: 7 },
  { id: 'e2', name: '刘清远', unit: '示例科技大学 信息学院', title: '研究员', score: 11, reasons: [{ kind: '研究方向', tag: '边缘计算', points: 5 }, { kind: '关键词', tag: '副本放置', points: 3 }, { kind: '关键词', tag: '容错调度', points: 3 }], invited: 1, inReview: 1, blocked: null, version: 3 },
  { id: 'e3', name: '赵敏行', unit: '示例大学 计算机学院', title: '教授', score: 12, reasons: [{ kind: '研究方向', tag: '分布式系统', points: 6 }, { kind: '关键词', tag: '边缘计算', points: 3 }], invited: 0, inReview: 0, blocked: '回避：与论文同一单位', version: 4 },
  { id: 'e4', name: '孟川', unit: '示例师范大学 计算机系', title: '副教授', score: 8, reasons: [{ kind: '研究方向', tag: '云计算', points: 5 }, { kind: '关键词', tag: '调度', points: 3 }], invited: 0, inReview: 4, blocked: null, version: 2 },
  { id: 'e5', name: '许知远', unit: '示例交通大学 电信学院', title: '教授', score: 9, reasons: [{ kind: '研究方向', tag: '物联网', points: 5 }, { kind: '关键词', tag: '边缘计算', points: 3 }], invited: 0, inReview: 1, blocked: '暂停服务（本人申请，至 12-01）', version: 9 },
  { id: 'e6', name: '钱若水', unit: '示例理工大学 计算机学院', title: '副教授', score: 6, reasons: [{ kind: '关键词', tag: '调度', points: 3 }, { kind: '关键词', tag: '容错', points: 3 }], invited: 0, inReview: 0, blocked: '资格未通过', version: 1 },
]

export const feedback = {
  title: '面向边缘计算的容错任务调度方法研究',
  program: '0812 计算机科学与技术',
  batch: '2026 年秋季学位论文送审',
  total: 74,
  outcome: '修改后通过',
  recommendation: '建议修改',
  overall:
    '论文针对边缘计算环境中节点失效相关性被忽视的问题，提出按任务关键度分级的副本放置策略，选题具有现实意义。模型推导基本清楚，实验覆盖了模拟与真实集群两类环境，工作量饱满。主要不足在于失效相关性估计方法的可靠性论证不够，部分实验对比的基线选择偏弱，影响了结论的说服力。',
  issues:
    '1. 第三章失效相关性的估计依赖历史日志，但未讨论日志稀疏或分布漂移时的偏差，建议补充误差分析。\n2. 第五章实验对比的三种基线均为静态冗余方法，缺少与近两年动态副本调整方法的比较。\n3. 定理 4.2 的证明中，对任务到达过程的独立性假设与第三章的相关性建模存在张力，需要说明二者如何兼容。',
  advice:
    '建议在第五章增加至少一种动态副本调整方法作为对比基线，并补充失效相关性估计误差对完成率影响的敏感性曲线。第四章可将定理证明中的假设单独列出，与第三章模型对照说明适用范围。文字方面，图 5-3、图 5-4 的坐标轴缺少单位，参考文献格式存在不统一。',
  scores: [
    { label: '选题价值', score: 12, max: 15 },
    { label: '文献与理论基础', score: 10, max: 15 },
    { label: '研究方法', score: 14, max: 20 },
    { label: '创新性', score: 17, max: 25 },
    { label: '写作与学术规范', score: 8, max: 10 },
    { label: '研究成果与工作量', score: 13, max: 15 },
  ],
}

export const supervisedStudents = [
  { id: 's1', name: '林知夏', title: '面向边缘计算的容错任务调度方法研究' },
  { id: 's2', name: '吴见山', title: '低资源场景下的藏汉神经机器翻译' },
]
