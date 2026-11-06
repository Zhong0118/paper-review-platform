/**
 * R1 样板数据：全部为虚构，只用于视觉验收（dev 构建可达，生产构建不包含）。
 * 只做类型导入，字段与真实接口一致；姓名、单位、论文与评语都不是真实数据。
 */
import type { ExpertOptions, ExpertRecord } from '@/api/expertOperations'
import type { SensitiveFinding } from '@/api/sensitiveChecks'
import type { NavGroup, WorkspaceAccount } from '@/components/workspace/types'

export const SAMPLE_NOTE = '样板数据均为虚构，仅用于视觉验收，不连接真实接口。'

export const disciplines: ExpertOptions['disciplines'] = [
  { code: '0101', name: '哲学' },
  { code: '0202', name: '应用经济学' },
  { code: '0301', name: '法学' },
  { code: '0401', name: '教育学' },
  { code: '0501', name: '中国语言文学' },
  { code: '0701', name: '数学' },
  { code: '0702', name: '物理学' },
  { code: '0703', name: '化学' },
  { code: '0710', name: '生物学' },
  { code: '0802', name: '机械工程' },
  { code: '0808', name: '电气工程' },
  { code: '0809', name: '电子科学与技术' },
  { code: '0810', name: '信息与通信工程' },
  { code: '0811', name: '控制科学与工程' },
  { code: '0812', name: '计算机科学与技术' },
  { code: '0835', name: '软件工程' },
  { code: '1201', name: '管理科学与工程' },
  { code: '1202', name: '工商管理学' },
]

export const options: ExpertOptions = {
  provinces: ['北京市', '上海市', '江苏省', '浙江省', '湖北省', '广东省', '四川省', '陕西省', '山东省', '辽宁省'],
  titles: ['教授', '研究员', '副教授', '副研究员', '高级工程师'],
  schools: [
    { id: 's-dc', name: '东川理工大学（样板）', status: 'ACTIVE' },
    { id: 's-ny', name: '南屿师范大学（样板）', status: 'ACTIVE' },
    { id: 's-bl', name: '北岭大学（样板）', status: 'ACTIVE' },
  ],
  disciplines,
}

const NAMES = ['林知远', '周慕白', '沈清和', '顾长宁', '陆安澜', '苏以衡', '许望舒', '宋怀瑾', '韩若谷', '程既白', '方晏清', '叶承舟', '秦砚秋', '唐书禾', '温景行', '江晚照', '何知微', '罗明远', '谢闻笛', '贺远山', '邵青梧', '孟时雨', '傅南乔', '钟听澜', '袁一苇', '冯星河', '曹予安', '彭照野']
const UNITS = [
  '东川理工大学 计算机科学与技术学院（人工智能学院）',
  '南屿师范大学 教育学部',
  '北岭大学 信息科学技术学院',
  '西原交通大学 电子与信息学部',
  '中洲科学院 自动化研究所',
  '东川理工大学 机械工程学院',
  '海川大学 经济与管理学院',
  '云麓大学 文学院',
  '北岭大学 数学科学学院',
  '西原交通大学 软件学院',
]
const DISC_SETS = [['0812', '0835'], ['0401'], ['0812', '0810', '0811'], ['0809', '0810'], ['0811', '0802'], ['0802'], ['0202', '1202', '1201'], ['0501'], ['0701'], ['0835', '0812']]
const DIRECTIONS = [['程序分析', '软件可靠性'], ['课程与教学论', '教师教育'], ['机器学习', '图像理解', '联邦学习'], ['集成电路设计'], ['智能控制', '机器人'], ['精密制造'], ['产业经济', '数字金融'], ['现当代文学'], ['偏微分方程'], ['需求工程', '形式化方法']]

export const experts: ExpertRecord[] = NAMES.map((name, i) => {
  const k = i % 10
  const pending = i === 3 || i === 11 || i === 19
  const rejected = i === 7
  const paused = i === 5 || i === 14 || i === 22
  const disabled = i === 25
  return {
    id: `x-${i + 1}`,
    user_id: `u-${i + 1}`,
    username: `expert${String(i + 1).padStart(2, '0')}`,
    display_name: name,
    account_status: disabled ? 'DISABLED' : 'ACTIVE',
    unit: UNITS[k]!,
    title: options.titles[i % 5]!,
    discipline_codes: DISC_SETS[k]!,
    province_name: i === 9 ? null : options.provinces[(i * 3) % 10]!,
    doctoral_supervisor: i % 4 === 0 ? true : i % 4 === 1 ? false : i % 4 === 2 ? true : null,
    masters_supervisor: i % 5 === 4 ? null : true,
    research_directions: DIRECTIONS[k]!,
    keywords: i % 3 === 0 ? ['静态分析', '缺陷预测'] : [],
    source_url: i % 2 === 0 ? 'https://example.edu/faculty/profile' : null,
    source_note: i % 2 === 0 ? '学院官网教师主页（样板）' : null,
    source_checked_at: i % 2 === 0 ? '2026-10-20T08:00:00Z' : null,
    qualification_status: pending ? 'PENDING' : rejected ? 'REJECTED' : 'APPROVED',
    service_status: paused ? 'UNAVAILABLE' : 'AVAILABLE',
    conflicts: i % 6 === 0 ? [{ kind: 'TENANT_ID', value: 's-dc' }] : i % 9 === 1 ? [{ kind: 'TENANT_ID', value: 's-ny' }, { kind: 'SUPERVISOR_NAME', value: '王某某' }] : [],
    version: 3,
  }
})

/* 六角色导航：菜单取自 router/workspaceNav（真实模式 portalMenus），这里只给样板账户 */
export const sampleAccounts: Record<string, { account: WorkspaceAccount; workspace: string }> = {
  school_reviewer: { account: { name: '学校审核员（样板）', username: 'school.sample', role: '学校审核', org: 'dc-tech' }, workspace: '东川理工大学（样板）' },
  platform_reviewer: { account: { name: '运营人员（样板）', username: 'platform.sample', role: '百杰运营', org: '' }, workspace: '百杰平台' },
  expert: { account: { name: '评审专家（样板）', username: 'expert.sample', role: '评审专家', org: '' }, workspace: '' },
  student: { account: { name: '学生（样板）', username: 'student.sample', role: '学生', org: 'dc-tech' }, workspace: '东川理工大学（样板）' },
  supervisor: { account: { name: '导师（样板）', username: 'supervisor.sample', role: '导师', org: 'dc-tech' }, workspace: '东川理工大学（样板）' },
  system_admin: { account: { name: '系统管理员（样板）', username: 'admin.sample', role: '系统管理员', org: '' }, workspace: '系统管理' },
}

/* 学校匿名核验：虚构论文与检测发现（结构同 SensitiveReport.findings） */
export const verifyThesis = {
  title: '面向多源异构日志的软件缺陷定位方法研究：以分布式事务系统为例',
  student: '学生（样板）',
  program: '计算机科学与技术（学术学位）',
  batch: '2026 秋季送审（样板）',
  pages: 12,
  position: { index: 3, total: 9 },
}

export const verifyFindings: SensitiveFinding[] = [
  { field: 'student_name', location: 'body', kind: 'IDENTITY', source: 'body', page_number: 1, matched_text: '学生（样板）', context: '作者：学生（样板）　指导教师：……', severity: 'BLOCK' },
  { field: 'supervisor_name', location: 'body', kind: 'IDENTITY', source: 'body', page_number: 1, matched_text: '导师（样板）', context: '指导教师：导师（样板）教授', severity: 'BLOCK' },
  { field: 'student_no', location: 'metadata', kind: 'IDENTITY', source: 'metadata', page_number: null, matched_text: '20260417', context: 'PDF 文档属性“作者”字段', severity: 'BLOCK' },
  { field: 'school_term', location: 'body', kind: 'SCHOOL_TERM', source: 'body', page_number: 4, matched_text: '东川理工', context: '……实验在东川理工高性能计算平台上完成……', severity: 'WARN', description: '本校词表：学校简称' },
  { field: 'school_term', location: 'body', kind: 'SCHOOL_TERM', source: 'body', page_number: 9, matched_text: '软件可靠性实验室', context: '感谢软件可靠性实验室各位同学的帮助', severity: 'WARN', description: '本校词表：实验室名称' },
]

/* 正式反馈：结构同 /my/theses/:id/published-result，经 readPublished 解读 */
export const publishedSample = {
  snapshot_schema_version: 2,
  thesis_id: 't-sample',
  base_result_id: 'r-sample',
  effective_revision_id: null,
  total: 82,
  correction_pending: false,
  outcome: { code: 'REVISION_REQUIRED', label: '修改后通过' },
  rule_snapshot: {
    version: '2026-秋',
    required_experts: 1,
    mode: 'single',
    dimensions: [
      { key: 'topicValue', label: '选题与价值', max_score: 15 },
      { key: 'literatureTheory', label: '文献综述与理论基础', max_score: 20 },
      { key: 'methodology', label: '研究方法与过程', max_score: 25 },
      { key: 'results', label: '成果与创新', max_score: 25 },
      { key: 'writing', label: '写作规范', max_score: 15 },
    ],
    bands: [],
  },
  items: [
    {
      alias: 'A',
      total: 82,
      scores: { topicValue: 13, literatureTheory: 16, methodology: 20, results: 21, writing: 12 },
      recommendation: '修改后答辩',
      overall_comment:
        '论文针对分布式事务系统中多源日志难以对齐的问题，提出了基于事件因果图的缺陷定位方法，选题具有明确的工程价值。作者对相关工作的梳理较为完整，实验覆盖了三个开源系统和一组工业数据集，结果总体可信。\n\n论文的主要贡献在于把日志模板抽取、跨服务时间对齐与因果推断放在同一框架内处理，第四章的消融实验说明了各组成部分的作用。整体写作清楚，图表规范。',
      issues:
        '1. 第三章对因果图构建的时间窗口选择缺少依据，建议说明窗口大小对结果的敏感性。\n2. 工业数据集的来源与脱敏方式交代不足，读者难以判断其代表性。\n3. 与基线方法的比较中，部分基线使用了默认参数，可能低估了其效果。',
      revision_advice:
        '建议补充时间窗口的敏感性分析（可在第四章增加一组实验）；在 3.2 节说明工业数据集的规模、时间范围和脱敏处理；对主要基线做参数调优后重新比较，并在表 4-3 中注明参数设置。参考文献中 2019 年之前的工作占比偏高，可补充近两年关于日志异常检测的代表性研究。',
    },
  ],
}

export function navFor(role: string, groups: NavGroup[]) {
  return { ...sampleAccounts[role]!, nav: groups }
}
