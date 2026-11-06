import { describe, expect, it } from 'vitest'

import { beijingDate, beijingTime } from '../taskTiming'

describe('beijing date and time (F1 · A7)', () => {
  it('formats the date in Beijing time, not by slicing the UTC string', () => {
    // 2026-11-05T17:30Z 是北京时间 11 月 6 日凌晨
    expect(beijingDate('2026-11-05T17:30:00Z')).toBe('2026/11/6')
    expect(beijingDate('2026-11-05T02:00:00Z')).toBe('2026/11/5')
  })
  it('uses the same calendar style as beijingTime', () => {
    expect(beijingTime('2026-11-05T02:17:51Z')).toBe('2026/11/5 10:17:51')
  })
  it('is empty for missing values', () => {
    expect(beijingDate(null)).toBe('')
    expect(beijingDate(undefined)).toBe('')
  })
})
