/**
 * U3 原型的虚构数据。姓名、学校、论文、专家与评语均为虚构；账号名只作示意，没有任何密码。
 * 字段形状参照现有 API（results / objections / schoolOperations / expertOperations / corrections /
 * systemOperations / catalogs），但不是接口合同。
 */
import type { ProtoAccount } from '../kit/types'

export const systemAccount: ProtoAccount = { name: '方远', username: 'demo_sys_01', role: '系统管理员', org: '平台级账号' }

/* ---------- P09 结果处理 ---------- */

export const dimensions = [
  { key: 'topicValue', label: '选题价值', max: 15 },
  { key: 'literatureTheory', label: '文献与理论基础', max: 15 },
  { key: 'methodology', label: '研究方法', max: 20 },
  { key: 'innovation', label: '创新性', max: 25 },
  { key: 'writingStandards', label: '写作与学术规范', max: 10 },
  { key: 'resultsWorkload', label: '研究成果与工作量', max: 15 },
] as const

export type OutcomeCode = 'PASS' | 'REVISION_REQUIRED' | 'FAIL'
export const outcomeLabel: Record<OutcomeCode, string> = { PASS: '通过', REVISION_REQUIRED: '修改后通过', FAIL: '不通过' }

export interface ResultItem {
  alias: string
  total: number
  recommendation: string
  overall: string
  issues: string
  advice: string
  scores: number[]
  /** 专家提交时确认过的复核提示：只有代码与数量，不改变结论 */
  checks: { label: string; count: number }[]
}

export interface ResultThesis {
  id: string
  title: string
  student: string
  studentNo: string
  program: string
  view: 'publish' | 'correction' | 'published'
  outcome: OutcomeCode
  total: number
  version: number
  items: ResultItem[]
  publishedAt?: string
  correction?: {
    id: string
    alias: string
    requestedAt: string
    reason: string
    before: { total: number; fields: { label: string; value: string }[] }
    after: { total: number; fields: { label: string; value: string }[] }
  }
}

export const resultTheses: ResultThesis[] = [
  {
    id: 'r1',
    title: '面向边缘计算的容错任务调度方法研究',
    student: '林知夏',
    studentNo: '2023101',
    program: '0812 计算机科学与技术',
    view: 'publish',
    outcome: 'REVISION_REQUIRED',
    total: 76,
    version: 4,
    items: [
      {
        alias: 'E-001',
        total: 76,
        recommendation: '修改后答辩',
        overall:
          '论文围绕边缘节点失效场景下的任务调度展开，问题来源清楚，实验平台搭建完整。第三章提出的冗余放置策略有一定新意，但与已有检查点方法的边界交代不足。',
        issues:
          '1. 第 4.2 节对比实验只选了两种基线，缺少近两年的代表性方法。\n2. 故障注入的参数设置没有说明依据，结论的适用范围不清楚。\n3. 部分图表坐标轴缺少单位。',
        advice: '补充一到两种近年基线并说明选择理由；在第 5 章讨论参数敏感性；统一全文图表规范。',
        scores: [12, 11, 15, 18, 7, 13],
        checks: [{ label: '评语与分数可能不一致', count: 1 }],
      },
    ],
  },
  {
    id: 'r2',
    title: '碳排放权交易对制造业企业绿色创新的影响',
    student: '沈星遥',
    studentNo: '2021102',
    program: '0202 应用经济学',
    view: 'correction',
    outcome: 'PASS',
    total: 84,
    version: 6,
    publishedAt: '10-28',
    items: [
      {
        alias: 'E-001',
        total: 84,
        recommendation: '同意答辩',
        overall: '论文利用试点政策构造准自然实验，识别策略清晰，稳健性检验较充分，写作规范。',
        issues: '1. 机制检验部分的中介变量选择理由偏弱。\n2. 样本期截至 2022 年，对政策后期效应讨论不足。',
        advice: '在机制部分补充替代解释的排除；在结论中说明样本期限制。',
        scores: [13, 13, 17, 21, 9, 11],
        checks: [],
      },
    ],
    correction: {
      id: 'c1',
      alias: 'E-001',
      requestedAt: '11-03',
      reason: '复核时发现“研究成果与工作量”一项误填，应为 13 分；总体评价补充一句对数据来源的说明。',
      before: {
        total: 84,
        fields: [
          { label: '研究成果与工作量', value: '11' },
          { label: '总体评价', value: '论文利用试点政策构造准自然实验，识别策略清晰，稳健性检验较充分，写作规范。' },
        ],
      },
      after: {
        total: 86,
        fields: [
          { label: '研究成果与工作量', value: '13' },
          {
            label: '总体评价',
            value: '论文利用试点政策构造准自然实验，识别策略清晰，稳健性检验较充分，写作规范。企业层面数据来源可靠，处理过程有记录。',
          },
        ],
      },
    },
  },
  {
    id: 'r3',
    title: '多模态医学影像的弱监督分割方法',
    student: '秦朗',
    studentNo: '2022058',
    program: '0812 计算机科学与技术',
    view: 'published',
    outcome: 'PASS',
    total: 88,
    version: 5,
    publishedAt: '10-20',
    items: [
      {
        alias: 'E-001',
        total: 88,
        recommendation: '同意答辩',
        overall: '方法设计合理，实验覆盖三个公开数据集，消融充分。',
        issues: '1. 与全监督方法的差距分析可以更具体。',
        advice: '',
        scores: [13, 13, 18, 22, 9, 13],
        checks: [],
      },
    ],
  },
  {
    id: 'r4',
    title: '明清徽州契约文书中的女性财产权',
    student: '唐砚',
    studentNo: '2020045',
    program: '0602 中国史',
    view: 'publish',
    outcome: 'FAIL',
    total: 55,
    version: 3,
    items: [
      {
        alias: 'E-001',
        total: 55,
        recommendation: '不同意答辩',
        overall: '选题有价值，史料搜集用功，但论证主要停留在个案罗列，未形成清晰的问题意识。',
        issues: '1. 第二、三章材料重复。\n2. 对既有研究的回应不足，结论与绪论的问题不对应。\n3. 引文格式多处不统一。',
        advice: '重新组织章节，围绕一个核心问题展开；补充与既有研究的对话。',
        scores: [10, 8, 10, 14, 6, 7],
        checks: [
          { label: '评语较短', count: 1 },
          { label: '评语与分数可能不一致', count: 1 },
        ],
      },
    ],
  },
  {
    id: 'r5',
    title: '城市更新中的社区参与机制研究——以三个街道为例',
    student: '孙亦舟',
    studentNo: '2022140',
    program: '1204 公共管理',
    view: 'published',
    outcome: 'REVISION_REQUIRED',
    total: 71,
    version: 4,
    publishedAt: '10-15',
    items: [
      {
        alias: 'E-001',
        total: 71,
        recommendation: '修改后答辩',
        overall: '田野材料扎实，访谈记录详细，但理论框架与经验材料的衔接偏松。',
        issues: '1. 三个案例的选择标准未说明。\n2. 部分结论缺少材料支撑。',
        advice: '补充案例选择的说明，压缩描述性内容。',
        scores: [11, 10, 14, 17, 7, 12],
        checks: [],
      },
    ],
  },
]

/* ---------- P11 异议 ---------- */

export interface ObjectionRow {
  id: string
  thesisId: string
  title: string
  student: string
  studentNo: string
  status: 'SUBMITTED' | 'PROCESSING' | 'RESOLVED'
  createdAt: string
  reason: string
  request: string
  channel?: 'ONLINE' | 'OFFLINE'
  conclusion?: string
}

export const objectionRows: ObjectionRow[] = [
  {
    id: 'o1',
    thesisId: 'r5',
    title: '城市更新中的社区参与机制研究——以三个街道为例',
    student: '孙亦舟',
    studentNo: '2022140',
    status: 'SUBMITTED',
    createdAt: '11-04',
    reason: '评阅意见认为“三个案例的选择标准未说明”，但论文第 2.3 节专门说明了案例选择标准，似乎评阅时没有注意到。',
    request: '希望学院核实第 2.3 节内容，必要时请专家复核这一条意见。',
  },
  {
    id: 'o2',
    thesisId: 'r3',
    title: '多模态医学影像的弱监督分割方法',
    student: '秦朗',
    studentNo: '2022058',
    status: 'PROCESSING',
    createdAt: '10-29',
    reason: '“研究方法”一项得分与评语描述不太一致，评语认为方法合理，分数却偏低。',
    request: '希望了解该项的评分依据。',
  },
  {
    id: 'o3',
    thesisId: 'r9',
    title: '高熵合金涂层的高温氧化行为',
    student: '韩芷若',
    studentNo: '2023019',
    status: 'RESOLVED',
    createdAt: '10-12',
    reason: '修改建议中提到的参考文献我无法检索到。',
    request: '请提供准确的文献信息。',
    channel: 'OFFLINE',
    conclusion: '已与学生当面沟通，经核对为文献年份笔误，正确信息已告知学生；评阅结论不变。',
  },
]

/* ---------- P12a 批次 ---------- */

export type BatchStatus = 'DRAFT' | 'OPEN' | 'SUBMISSION_CLOSED' | 'ARCHIVED'
export const batchStatusText: Record<BatchStatus, string> = { DRAFT: '草稿', OPEN: '开放收件', SUBMISSION_CLOSED: '已截止收件', ARCHIVED: '已归档' }

export interface Batch {
  id: string
  code: string
  name: string
  status: BatchStatus
  start: string
  end: string
  acceptDays: number | null
  reviewDays: number | null
  programVersion: string | null
  ruleVersion: string
  version: number
  counts: { theses: number; published: number }
  closeout: { unpublished: { id: string; title: string }[]; objections: { id: string; title: string }[]; corrections: { id: string; title: string }[] }
}

export const programVersions = [
  { id: 'pv3', label: '2026 年第 2 版（48 个专业）', published: '09-01' },
  { id: 'pv2', label: '2026 年第 1 版（46 个专业）', published: '06-15' },
  { id: 'pv1', label: '2025 年第 1 版（44 个专业）', published: '2025-06-20' },
]

export const batches: Batch[] = [
  {
    id: 'b1',
    code: '2026-AUT',
    name: '2026 年秋季学位论文送审',
    status: 'OPEN',
    start: '2026-09-01',
    end: '2026-12-15',
    acceptDays: 3,
    reviewDays: 14,
    programVersion: 'pv3',
    ruleVersion: '第 3 版',
    version: 7,
    counts: { theses: 15, published: 2 },
    closeout: {
      unpublished: [
        { id: 'r1', title: '面向边缘计算的容错任务调度方法研究' },
        { id: 'r4', title: '明清徽州契约文书中的女性财产权' },
      ],
      objections: [
        { id: 'o1', title: '城市更新中的社区参与机制研究——以三个街道为例' },
        { id: 'o2', title: '多模态医学影像的弱监督分割方法' },
      ],
      corrections: [{ id: 'r2', title: '碳排放权交易对制造业企业绿色创新的影响' }],
    },
  },
  {
    id: 'b2',
    code: '2027-SPR',
    name: '2027 年春季学位论文送审',
    status: 'DRAFT',
    start: '2027-02-20',
    end: '2027-05-31',
    acceptDays: null,
    reviewDays: null,
    programVersion: null,
    ruleVersion: '第 3 版',
    version: 1,
    counts: { theses: 0, published: 0 },
    closeout: { unpublished: [], objections: [], corrections: [] },
  },
  {
    id: 'b3',
    code: '2026-SPR',
    name: '2026 年春季学位论文送审',
    status: 'SUBMISSION_CLOSED',
    start: '2026-02-20',
    end: '2026-05-31',
    acceptDays: 3,
    reviewDays: 14,
    programVersion: 'pv2',
    ruleVersion: '第 2 版',
    version: 12,
    counts: { theses: 38, published: 38 },
    closeout: { unpublished: [], objections: [], corrections: [] },
  },
  {
    id: 'b4',
    code: '2025-AUT',
    name: '2025 年秋季学位论文送审',
    status: 'ARCHIVED',
    start: '2025-09-01',
    end: '2025-12-15',
    acceptDays: 5,
    reviewDays: 21,
    programVersion: 'pv1',
    ruleVersion: '第 2 版',
    version: 15,
    counts: { theses: 41, published: 41 },
    closeout: { unpublished: [], objections: [], corrections: [] },
  },
]

/* ---------- P12b 成员 ---------- */

export interface Member {
  id: string
  type: 'STUDENT' | 'SUPERVISOR'
  name: string
  externalId: string
  username: string
  active: boolean
  phone: string
  email: string
  updated: string
  eligibility?: { status: 'ELIGIBLE' | 'SUSPENDED'; degree: string; supervisor: string } | null
  hasDraft?: boolean
}

export const members: Member[] = [
  { id: 'm1', type: 'STUDENT', name: '林知夏', externalId: '2023101', username: 'demo_stu_2023101', active: true, phone: '138 0000 0101', email: 'lzx@example.edu', updated: '11-02', eligibility: { status: 'ELIGIBLE', degree: '学术型硕士', supervisor: '周衡' }, hasDraft: false },
  { id: 'm2', type: 'STUDENT', name: '陈予安', externalId: '2022087', username: 'demo_stu_2022087', active: true, phone: '138 0000 0102', email: 'cya@example.edu', updated: '10-30', eligibility: { status: 'SUSPENDED', degree: '学术型硕士', supervisor: '许明川' }, hasDraft: true },
  { id: 'm3', type: 'STUDENT', name: '赵屿', externalId: '2023056', username: 'demo_stu_2023056', active: true, phone: '', email: 'zy@example.edu', updated: '10-28', eligibility: null },
  { id: 'm4', type: 'STUDENT', name: '何未晞', externalId: '2022093', username: 'demo_stu_2022093', active: false, phone: '138 0000 0104', email: '', updated: '09-18', eligibility: { status: 'ELIGIBLE', degree: '专业型硕士', supervisor: '周衡' } },
  { id: 'm5', type: 'SUPERVISOR', name: '周衡', externalId: 'T0042', username: 'demo_sup_0042', active: true, phone: '139 0000 0042', email: 'zh@example.edu', updated: '10-11' },
  { id: 'm6', type: 'SUPERVISOR', name: '许明川', externalId: 'T0017', username: 'demo_sup_0017', active: true, phone: '', email: 'xmc@example.edu', updated: '09-02' },
  { id: 'm7', type: 'STUDENT', name: '孙亦舟', externalId: '2022140', username: 'demo_stu_2022140', active: true, phone: '138 0000 0107', email: 'syz@example.edu', updated: '08-30', eligibility: { status: 'ELIGIBLE', degree: '专业型硕士', supervisor: '许明川' } },
]

/* ---------- P12c 学科与专业 ---------- */

export const disciplineGroups = [
  { group: '02 经济学', items: [{ code: '0201', name: '理论经济学' }, { code: '0202', name: '应用经济学' }] },
  { group: '03 法学', items: [{ code: '0301', name: '法学' }, { code: '0302', name: '政治学' }] },
  { group: '04 教育学', items: [{ code: '0401', name: '教育学' }, { code: '0402', name: '心理学' }] },
  { group: '06 历史学', items: [{ code: '0601', name: '考古学' }, { code: '0602', name: '中国史' }, { code: '0603', name: '世界史' }] },
  { group: '07 理学', items: [{ code: '0702', name: '物理学' }, { code: '0703', name: '化学' }, { code: '0705', name: '地理学' }] },
  {
    group: '08 工学',
    items: [
      { code: '0805', name: '材料科学与工程' },
      { code: '0808', name: '电气工程' },
      { code: '0812', name: '计算机科学与技术' },
      { code: '0814', name: '土木工程' },
    ],
  },
  { group: '10 医学', items: [{ code: '1004', name: '公共卫生与预防医学' }] },
  { group: '12 管理学', items: [{ code: '1201', name: '管理科学与工程' }, { code: '1204', name: '公共管理' }] },
]
export const openDisciplines = ['0202', '0301', '0401', '0602', '0702', '0705', '0805', '0808', '0812', '0814', '1004', '1204']

export const programPreview = {
  revision: 3,
  retained: 44,
  added: [
    { code: '081201', name: '计算机系统结构', official: '0812 计算机科学与技术' },
    { code: '081205', name: '人工智能（交叉）', official: '0812 计算机科学与技术' },
  ],
  changed: [{ code: '120401', name: '行政管理', before: '公共管理（行政）', official: '1204 公共管理' }],
  removed: [{ code: '070502', name: '人文地理学（旧）', official: '0705 地理学' }],
  errors: ['第 31 行：官方学科代码 0899 不在启用的官方目录中', '第 47 行：专业代码 060201 重复'],
}

/* ---------- P12d 检测词表 ---------- */

export interface Term {
  id: string
  text: string
  severity: 'WARN' | 'BLOCK'
  description: string
}
export const terms: Term[] = [
  { id: 'k1', text: '示例大学', severity: 'BLOCK', description: '本校全称，出现即暴露学校' },
  { id: 'k2', text: '示大', severity: 'WARN', description: '本校简称，常见于致谢' },
  { id: 'k3', text: '本校重点实验室', severity: 'WARN', description: '可能指向具体实验室' },
  { id: 'k4', text: '国家自然科学基金（批准号', severity: 'WARN', description: '基金编号可回溯到项目负责人' },
  { id: 'k5', text: '指导教师', severity: 'BLOCK', description: '封面或致谢中的导师信息' },
]
export const termsTheirs = {
  by: '另一位学校审核',
  added: [{ id: 'k6', text: '示例大学学报', severity: 'WARN', description: '本校刊物' }] as Term[],
  changed: [{ id: 'k2', field: '严重程度', before: '警告', after: '阻断' }],
}

/* ---------- P13a 专家库 ---------- */

export interface Expert {
  id: string
  name: string
  username: string
  unit: string
  title: string
  province: string
  disciplines: string[]
  directions: string[]
  keywords: string[]
  doctoral: boolean | null
  masters: boolean | null
  qualification: 'PENDING' | 'APPROVED' | 'REJECTED'
  service: 'AVAILABLE' | 'UNAVAILABLE'
  conflicts: { kind: 'TENANT' | 'SUPERVISOR'; value: string }[]
  sourceUrl: string
  sourceNote: string
  checkedAt: string
  inFlight: number
}
export const qualificationText = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过' } as const
export const serviceText = { AVAILABLE: '可接单', UNAVAILABLE: '暂停服务' } as const

export const experts: Expert[] = [
  { id: 'x1', name: '王曦', username: 'demo_expert_07', unit: '虚构理工大学 计算机学院', title: '教授', province: '江苏', disciplines: ['0812 计算机科学与技术'], directions: ['分布式系统', '边缘计算'], keywords: ['容错', '调度', '资源管理'], doctoral: true, masters: true, qualification: 'APPROVED', service: 'AVAILABLE', conflicts: [{ kind: 'TENANT', value: '示例大学（demo-u01）' }], sourceUrl: 'https://example.edu/faculty/wx', sourceNote: '学院官网教师页', checkedAt: '2026-10-08', inFlight: 2 },
  { id: 'x2', name: '陈砚秋', username: 'demo_expert_12', unit: '虚构师范大学 历史文化学院', title: '教授', province: '安徽', disciplines: ['0602 中国史'], directions: ['明清社会经济史', '徽学'], keywords: ['契约文书', '宗族'], doctoral: true, masters: true, qualification: 'APPROVED', service: 'UNAVAILABLE', conflicts: [], sourceUrl: 'https://example.edu/history/cyq', sourceNote: '学院官网', checkedAt: '2026-09-21', inFlight: 0 },
  { id: 'x3', name: '刘启明', username: 'demo_expert_19', unit: '虚构财经大学 经济学院', title: '副教授', province: '上海', disciplines: ['0202 应用经济学'], directions: ['环境经济学', '产业组织'], keywords: ['碳交易', '绿色创新'], doctoral: false, masters: true, qualification: 'PENDING', service: 'AVAILABLE', conflicts: [], sourceUrl: '', sourceNote: '本人提交简历', checkedAt: '', inFlight: 0 },
  { id: 'x4', name: '周临渊', username: 'demo_expert_23', unit: '虚构交通大学 土木工程学院', title: '研究员', province: '四川', disciplines: ['0814 土木工程'], directions: ['桥梁抗风'], keywords: ['斜拉桥', '振动控制'], doctoral: true, masters: true, qualification: 'APPROVED', service: 'AVAILABLE', conflicts: [{ kind: 'SUPERVISOR', value: '周衡' }], sourceUrl: 'https://example.edu/civil/zly', sourceNote: '学院官网', checkedAt: '2026-08-30', inFlight: 4 },
  { id: 'x5', name: '袁听澜', username: 'demo_expert_31', unit: '虚构医科大学 公共卫生学院', title: '副研究员', province: '湖北', disciplines: ['1004 公共卫生与预防医学'], directions: ['流行病学'], keywords: ['队列研究', '近视'], doctoral: false, masters: true, qualification: 'REJECTED', service: 'AVAILABLE', conflicts: [], sourceUrl: '', sourceNote: '学会推荐', checkedAt: '2026-07-12', inFlight: 0 },
]

/** 现行导入只更新已有专家的档案字段（按账号精确匹配），不新建账号；任何一行有错，整份预览不能应用。 */
export const expertImport = {
  file: '专家档案-第四批.csv',
  expires: '10 分钟内有效',
  changes: [
    { username: 'demo_expert_12', diff: [{ field: '职称', before: '教授', after: '二级教授' }, { field: '研究方向', before: '明清社会经济史、徽学', after: '明清社会经济史、徽学、社会史' }] },
    { username: 'demo_expert_19', diff: [{ field: '博导', before: '否', after: '是' }] },
    { username: 'demo_expert_23', diff: [] },
  ],
  errors: [
    { row: 6, message: '用户名未精确匹配已有专家' },
    { row: 9, message: '学科须选自启用目录' },
  ],
}

/* ---------- P13b 更正审批 ---------- */

export interface CorrectionRow {
  id: string
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'AWAITING_SCHOOL' | 'ACTIVATED' | 'SCHOOL_REJECTED' | 'CANCELLED'
  expert: string
  task: string
  title: string
  school: string
  requestedAt: string
  reason: string
  notes: { kind: string; text: string }[]
}
export const correctionStatusText: Record<CorrectionRow['status'], string> = {
  REQUESTED: '待审批',
  APPROVED: '已批准，专家起草中',
  REJECTED: '已驳回',
  AWAITING_SCHOOL: '待学校确认',
  ACTIVATED: '学校已确认，已生效',
  SCHOOL_REJECTED: '学校不予确认',
  CANCELLED: '专家已撤回',
}
export const correctionRows: CorrectionRow[] = [
  { id: 'c3', status: 'REQUESTED', expert: '王曦', task: 'T-2026-0412', title: '面向边缘计算的容错任务调度方法研究', school: 'demo-u01', requestedAt: '11-04 10:22', reason: '发布后发现“研究方法”评分录入有误，应为 16 分；其余内容不变。', notes: [] },
  { id: 'c4', status: 'REQUESTED', expert: '周临渊', task: 'T-2026-0398', title: '大跨度斜拉桥风致振动的主动控制', school: 'demo-u02', requestedAt: '11-03 18:05', reason: '主要问题第 2 条引用的章节号写错，需改为第 4.3 节。', notes: [] },
  { id: 'c1', status: 'AWAITING_SCHOOL', expert: '刘启明', task: 'T-2026-0377', title: '碳排放权交易对制造业企业绿色创新的影响', school: 'demo-u01', requestedAt: '11-01 09:40', reason: '“研究成果与工作量”一项误填，总体评价补充数据来源说明。', notes: [{ kind: '平台批准', text: '理由清楚，同意更正。' }] },
  { id: 'c2', status: 'REJECTED', expert: '陈砚秋', task: 'T-2026-0350', title: '明清徽州契约文书中的女性财产权', school: 'demo-u01', requestedAt: '10-30 15:12', reason: '希望整体重写总体评价。', notes: [{ kind: '平台驳回', text: '更正只用于纠正明确的录入错误，不用于改写评价立场。' }] },
]

/* ---------- P14 系统管理 ---------- */

export interface Tenant {
  id: string
  code: string
  name: string
  org: string
  status: 'ACTIVE' | 'SUSPENDED'
  reviewers: { id: string; name: string; username: string; active: boolean }[]
  created: string
}
export const tenants: Tenant[] = [
  { id: 's1', code: 'demo-u01', name: '示例大学', org: '研究生院', status: 'ACTIVE', created: '2026-03-02', reviewers: [{ id: 'v1', name: '王宁', username: 'demo_school_01', active: true }, { id: 'v2', name: '郑可', username: 'demo_school_02', active: true }] },
  { id: 's2', code: 'demo-u02', name: '虚构交通大学', org: '研究生院学位办', status: 'ACTIVE', created: '2026-05-18', reviewers: [{ id: 'v3', name: '吕青', username: 'demo_school_11', active: true }] },
  { id: 's3', code: 'demo-u03', name: '虚构海洋学院', org: '研究生处', status: 'SUSPENDED', created: '2026-06-09', reviewers: [{ id: 'v4', name: '蓝屿', username: 'demo_school_21', active: false }] },
]
export const institutions = [
  { code: '19001', name: '虚构农业大学', province: '山东' },
  { code: '19002', name: '虚构政法大学', province: '重庆' },
  { code: '19003', name: '虚构交通大学', province: '四川' },
  { code: '19004', name: '虚构农业职业学院', province: '河南' },
]

/** 现行接口：预览不需要上传，服务端读取内置的官方来源快照并与库内目录比较；只返回计数与来源，不返回逐条变化。 */
export const catalogPreview = {
  fingerprint: 'fp-2026-10-a1',
  disciplines: { added: 3, changed: 2, unchanged: 107 },
  institutions: { added: 14, changed: 6, unchanged: 2840 },
  sources: [
    { name: '学位授予和人才培养学科目录（虚构快照）', version: '2026-10', url: 'https://example.gov/disciplines' },
    { name: '全国高等学校名单（虚构快照）', version: '2026-10', url: 'https://example.gov/institutions' },
  ],
}
