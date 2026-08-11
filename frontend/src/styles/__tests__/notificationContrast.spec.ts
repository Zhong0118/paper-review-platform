import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import studentListSource from '@/modules/shared/components/StudentNotificationList.vue?raw'
import notificationPageSource from '@/modules/shared/pages/NotificationCenterPage.vue?raw'

const themeSource = readFileSync(`${process.cwd()}/src/styles/theme.css`, 'utf8')

function token(name: string) {
  const value = themeSource
    .split(`${name}:`)[1]
    ?.trim()
    .match(/^#[0-9a-f]{6}/i)?.[0]
  if (!value) throw new Error(`Missing color token: ${name}`)
  return value
}

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

describe('notification secondary text contrast', () => {
  it('uses the shared secondary token with WCAG AA contrast for small text', () => {
    const secondary = token('--color-text-secondary')
    const background = token('--color-bg')

    expect(contrast(secondary, background)).toBeGreaterThanOrEqual(4.5)
    expect(studentListSource).toContain('var(--color-text-secondary)')
    expect(notificationPageSource).toContain('var(--color-text-secondary)')
    expect(studentListSource).not.toMatch(/#71808b|#7b8791/i)
    expect(notificationPageSource).not.toMatch(/#71808b|#7b8791/i)
  })
})
