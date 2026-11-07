import { describe, expect, it } from 'vitest'

import { expertRecord } from './fixtures'
import { availability, bucket, newExpertErrors, profileDiff, profileErrors, profileFrom, rowPill, splitTags, toProfile } from '../expertView'

describe('expert view', () => {
  it('buckets experts and names each reason separately', () => {
    expect(bucket(expertRecord('a'))).toBe('ready')
    expect(bucket(expertRecord('b', { qualification_status: 'PENDING', account_status: 'DISABLED' }))).toBe('pending')
    expect(bucket(expertRecord('c', { account_status: 'DISABLED' }))).toBe('blocked')
    expect(rowPill(expertRecord('d', { service_status: 'UNAVAILABLE' }))).toEqual({ tone: 'warning', text: '暂停接单' })
    expect(rowPill(expertRecord('e'))).toBeNull()
    expect(availability(expertRecord('f', { qualification_status: 'REJECTED', service_status: 'UNAVAILABLE' })).text).toBe('现在不能指派：资格审核未通过；已暂停接单')
    expect(availability(expertRecord('g', { conflicts: [{ kind: 'SUPERVISOR_NAME', value: '王老师' }] })).text).toBe('可以指派；对 1 项回避对象的论文不可派')
  })

  it('splits tags on semicolons and the enumeration comma', () => {
    expect(splitTags(' 机器学习；图学习;机器学习、 ')).toEqual(['机器学习', '图学习'])
  })

  it('diffs a form against the server record with readable values', () => {
    const row = expertRecord('a')
    const form = profileFrom(row)
    expect(profileDiff(form, row)).toEqual([])
    form.title = '研究员'
    form.masters_supervisor = true
    form.directions = '机器学习；联邦学习'
    expect(profileDiff(form, row, [{ code: '0812', name: '计算机' }]).map((d) => [d.label, d.mine, d.theirs])).toEqual([
      ['职称', '研究员', '教授'], ['硕导', '是', '未知'], ['研究方向', '机器学习、联邦学习', '机器学习'],
    ])
    expect(toProfile({ ...form, province_name: '', source_url: '  ' })).toMatchObject({ province_name: null, source_url: null, research_directions: ['机器学习', '联邦学习'] })
  })

  it('validates the profile and a new expert like the backend', () => {
    const form = { ...profileFrom(expertRecord('a')), discipline_codes: [], directions: '甲', source_url: 'ftp://x.cn' }
    expect(profileErrors(form)).toEqual({ discipline_codes: '至少选择 1 个学科。', directions: '研究方向每项 2–64 个字。', source_url: '来源须为不含账号密码的 http 或 https 链接。' })
    expect(profileErrors({ ...form, discipline_codes: ['0812'], directions: '', source_url: 'https://u:p@x.cn' }).source_url).toBeDefined()
    expect(newExpertErrors({ username: 'Li', display_name: '', password: 'short', again: '', unit: '', title: '', discipline_codes: [] })).toEqual({
      username: '登录名为 3–64 位，只能用字母、数字和 . _ -。', display_name: '请填写姓名。', password: '初始密码至少 12 位。', discipline_codes: '至少选择 1 个学科。',
    })
  })
})
