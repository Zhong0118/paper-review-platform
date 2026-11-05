import { expect, it } from 'vitest'

import { accountInitial } from '../accountInitial'

it('takes the last character of the name without academic titles', () => {
  expect(accountInitial('周明远教授')).toBe('远')
  expect(accountInitial('赵文博副教授')).toBe('博')
  expect(accountInitial('王老师')).toBe('王')
  expect(accountInitial('陈岚')).toBe('岚')
  expect(accountInitial('')).toBe('我')
  expect(accountInitial('身份未取得')).toBe('我')
  expect(accountInitial(null)).toBe('我')
})
