/**
 * U4-5 学科与专业的纯函数：按门类分组、勾选差异、409 后把我的改动套到对方结果上、预览统计。
 */
import type { CatalogOption, DisciplineSettings } from '@/api/catalogs'
import type { CatalogPreview } from '@/api/schoolPrograms'

/** 国家学科门类（目录项缺 category_name 时兜底） */
export const categoryNames: Record<string, string> = {
  '01': '哲学', '02': '经济学', '03': '法学', '04': '教育学', '05': '文学', '06': '历史学', '07': '理学',
  '08': '工学', '09': '农学', '10': '医学', '11': '军事学', '12': '管理学', '13': '艺术学', '14': '交叉学科',
}

export interface DisciplineGroup { code: string; name: string; items: CatalogOption[] }

export function groupDisciplines(items: CatalogOption[]): DisciplineGroup[] {
  const groups = new Map<string, DisciplineGroup>()
  for (const item of items) {
    const code = item.category_code || item.code.slice(0, 2)
    const group = groups.get(code) ?? { code, name: item.category_name || categoryNames[code] || code, items: [] }
    group.items.push(item)
    groups.set(code, group)
  }
  return [...groups.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/** 设置生效的口径：未设置时开放全部启用学科 */
export const effectiveCodes = (settings: DisciplineSettings, options: CatalogOption[]) =>
  (settings.configured ? [...settings.codes] : options.map((item) => item.code)).sort()

export function codeDiff(base: string[], picked: string[]) {
  return { added: picked.filter((code) => !base.includes(code)), removed: base.filter((code) => !picked.includes(code)) }
}

export const sameCodes = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join()

/** 把我相对 base 的新增与取消套到对方保存的结果上 */
export function mergeCodes(base: string[], picked: string[], theirs: string[]): string[] {
  const mine = codeDiff(base, picked)
  return [...new Set([...theirs, ...mine.added])].filter((code) => !mine.removed.includes(code)).sort()
}

export function previewStats(preview: CatalogPreview) {
  const count = (action: string) => preview.changes.filter((row) => row.action === action).length
  return {
    added: count('新增'),
    changed: count('变更'),
    unchanged: count('未变'),
    inactive: preview.changes.filter((row) => !row.after.active).length,
    retained: preview.retained,
    errors: preview.errors.length,
  }
}
