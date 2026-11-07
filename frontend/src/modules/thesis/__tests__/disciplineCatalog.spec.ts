import { describe, expect, it } from 'vitest'

import { disciplineCatalog, searchDisciplines } from '../data/disciplineCatalog'

const categoryNames = new Map([
  ['01', '哲学'],
  ['02', '经济学'],
  ['03', '法学'],
  ['04', '教育学'],
  ['05', '文学'],
  ['06', '历史学'],
  ['07', '理学'],
  ['08', '工学'],
  ['09', '农学'],
  ['10', '医学'],
  ['11', '军事学'],
  ['12', '管理学'],
  ['13', '艺术学'],
  ['14', '交叉学科'],
])

describe('2022 graduate discipline catalog', () => {
  it('contains the complete controlled directory with unique codes', () => {
    expect(disciplineCatalog).toHaveLength(184)
    expect(new Set(disciplineCatalog.map((item) => item.code)).size).toBe(184)
    expect(disciplineCatalog.filter((item) => item.type === 'ACADEMIC')).toHaveLength(117)
    expect(disciplineCatalog.filter((item) => item.type === 'PROFESSIONAL')).toHaveLength(67)
    expect(disciplineCatalog).toContainEqual(
      expect.objectContaining({
        code: '0812',
        name: '计算机科学与技术',
        type: 'ACADEMIC',
      }),
    )
    expect(disciplineCatalog).toContainEqual(
      expect.objectContaining({ code: '1452', name: '密码', type: 'PROFESSIONAL' }),
    )
  })

  it('uses valid four-digit codes and the official category for every entry', () => {
    for (const entry of disciplineCatalog) {
      expect(entry.code).toMatch(/^\d{4}$/)
      expect(entry.categoryCode).toBe(entry.code.slice(0, 2))
      expect(entry.categoryName).toBe(categoryNames.get(entry.categoryCode))
      expect(entry.aliases).toEqual(expect.any(Array))
    }
  })

  it('searches by code, name, and aliases without changing the controlled catalog', () => {
    expect(searchDisciplines('0812').map((item) => item.name)).toEqual(['计算机科学与技术'])
    expect(searchDisciplines('计算机').map((item) => item.code)).toContain('0812')
    expect(searchDisciplines(' 0812 ')).toEqual(searchDisciplines('0812'))
    expect(searchDisciplines('不存在的专业')).toEqual([])
    expect(searchDisciplines('')).toHaveLength(184)
  })
})
