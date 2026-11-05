import { describe, expect, it } from 'vitest'

import { changeCount, cloneRows, mergeTerms, rowErrors, termDiff, toRows, toTerms, type TermRow } from '../termsView'

const t = (text: string, severity: 'WARN' | 'BLOCK' = 'WARN', description = '') => ({ text, severity, description })

describe('terms view', () => {
  it('validates each row like the backend', () => {
    const rows: TermRow[] = [
      { id: 'a', ...t(' ') }, { id: 'b', ...t('甲') }, { id: 'c', ...t('示例大学') }, { id: 'd', ...t(' 示例大学 ') },
      { id: 'e', ...t('换\n行') }, { id: 'f', ...t('很长'.repeat(33)) }, { id: 'g', ...t('正常', 'WARN', '说'.repeat(256)) }, { id: 'h', ...t('𠀀𠀀') },
    ]
    expect(rowErrors(rows)).toEqual({
      a: { text: '请填写词语，或删除这一行' }, b: { text: '词语需要 2–64 个字' }, c: { text: '与其他行重复' }, d: { text: '与其他行重复' },
      e: { text: '不能包含换行等控制字符' }, f: { text: '词语需要 2–64 个字' }, g: { description: '说明不超过 255 个字' },
    })
  })

  it('counts added, changed and removed rows and strips ids on submit', () => {
    const base = toRows([t('示例大学'), t('示大'), t('理工楼')])
    const rows = cloneRows(base)
    rows[1]!.severity = 'BLOCK'
    rows.splice(2, 1)
    rows.push({ id: 'n1', ...t(' 出版社 ') })
    expect(changeCount(base, rows)).toBe(3)
    expect(changeCount(base, cloneRows(base))).toBe(0)
    expect(toTerms(rows).at(-1)).toEqual(t('出版社'))
  })

  it('describes what the other version changed', () => {
    expect(termDiff([t('示大'), t('理工楼'), t('实验室', 'WARN', 'a')], [t('示大', 'BLOCK'), t('实验室', 'WARN', 'b'), t('附中')])).toEqual([
      { kind: 'changed', text: '示大', detail: '警告 → 阻断' },
      { kind: 'changed', text: '实验室', detail: '说明已修改' },
      { kind: 'added', text: '附中', detail: '警告' },
      { kind: 'removed', text: '理工楼', detail: '' },
    ])
  })

  it('reapplies my edits onto their version by term text', () => {
    const base = toRows([t('示例大学'), t('示大'), t('理工楼')])
    const rows = cloneRows(base)
    rows[0]!.description = '全称'
    rows.splice(2, 1)
    rows.push({ id: 'n1', ...t('出版社') })
    const merged = mergeTerms(base, rows, [t('示例大学'), t('示大', 'BLOCK'), t('理工楼'), t('附中')])
    expect(toTerms(merged.base)).toEqual([t('示例大学'), t('示大', 'BLOCK'), t('理工楼'), t('附中')])
    expect(toTerms(merged.rows)).toEqual([t('示例大学', 'WARN', '全称'), t('示大', 'BLOCK'), t('附中'), t('出版社')])
    expect(changeCount(merged.base, merged.rows)).toBe(3)
  })
})
