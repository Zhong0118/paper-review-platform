/** 检测发现的位置说明（纯函数，核验台与 R1 样板共用）：有页码写页码，否则写来源。 */
import type { SensitiveFinding } from '@/api/sensitiveChecks'

const SOURCES: Record<string, string> = { filename: '文件名', metadata: '文件元数据', thesis_metadata: '登记信息', title: '标题文字核对' }

export const findingSource = (finding: SensitiveFinding) => SOURCES[finding.source ?? finding.location] ?? '其他来源'
export const findingWhere = (finding: SensitiveFinding) => (finding.page_number ? `第 ${finding.page_number} 页` : findingSource(finding))
