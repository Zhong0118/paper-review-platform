import { describe, expect, it } from 'vitest'

import { codeDiff, effectiveCodes, groupDisciplines, mergeCodes, previewStats, sameCodes } from '../disciplineView'

describe('discipline view', () => {
  it('groups by category with the catalog name, falling back to the fixed table and then the code', () => {
    const groups = groupDisciplines([
      { code: '0812', name: '计算机科学与技术', category_code: '08', category_name: '工学' },
      { code: '0101', name: '哲学' },
      { code: '0801', name: '力学', category_code: '08', category_name: '工学' },
      { code: '9901', name: '试点' },
    ])
    expect(groups.map((g) => [g.code, g.name, g.items.map((i) => i.code)])).toEqual([
      ['01', '哲学', ['0101']], ['08', '工学', ['0812', '0801']], ['99', '99', ['9901']],
    ])
  })

  it('treats an unconfigured school as all options open', () => {
    const options = [{ code: '0812', name: 'a' }, { code: '0101', name: 'b' }]
    expect(effectiveCodes({ configured: false, codes: [], version: 0 }, options)).toEqual(['0101', '0812'])
    expect(effectiveCodes({ configured: true, codes: ['0812'], version: 2 }, options)).toEqual(['0812'])
  })

  it('diffs and merges my picks onto the saved result of someone else', () => {
    expect(codeDiff(['01', '02'], ['02', '03'])).toEqual({ added: ['03'], removed: ['01'] })
    expect(sameCodes(['02', '01'], ['01', '02'])).toBe(true)
    // 我：取消 01、新增 03；对方：新增 04
    expect(mergeCodes(['01', '02'], ['02', '03'], ['01', '02', '04'])).toEqual(['02', '03', '04'])
  })

  it('counts preview actions and inactive entries', () => {
    const entry = (active = true) => ({ name: 'n', official_code: '0812', official_name: 'o', active, source: 's', source_version: 'v' })
    expect(previewStats({
      revision: 3, retained: 4, fingerprint: null, errors: ['第 3 行：应有 4 列'],
      changes: [{ code: 'a', action: '新增', before: null, after: entry() }, { code: 'b', action: '变更', before: entry(), after: entry(false) }, { code: 'c', action: '未变', before: entry(), after: entry() }],
    })).toEqual({ added: 1, changed: 1, unchanged: 1, inactive: 1, retained: 4, errors: 1 })
  })
})
