/**
 * U4-7 平台批准／驳回更正申请（decide）。
 * - 幂等键按命令内容复用：同一次操作失败后重试用同一把键，改了原因就换新键。
 * - 409：交给调用方重读后判断；不自动重试。卸载后不再写回状态。
 */
import { onBeforeUnmount, ref } from 'vue'

import { correctionCommand, type Correction } from '@/api/corrections'
import { apiFailure } from '@/api/failure'

export type PlatformDecision = 'APPROVE' | 'REJECT'
export type DecideOutcome = { ok: true; row: Correction } | { ok: false; status: number | undefined; message: string }

export function usePlatformCorrection() {
  const pending = ref(false)
  let retry: { signature: string; key: string } | null = null
  let alive = true
  onBeforeUnmount(() => (alive = false))

  async function decide(row: Correction, decision: PlatformDecision, reason: string): Promise<DecideOutcome | null> {
    if (pending.value || !reason.trim()) return null
    const body = { version: row.version, decision, reason: reason.trim() }
    const signature = JSON.stringify({ id: row.id, body })
    if (retry?.signature !== signature) retry = { signature, key: crypto.randomUUID() }
    pending.value = true
    try {
      const result = await correctionCommand('decide', row.id, body, retry.key, { quiet: true })
      if (!alive) return null
      retry = null
      return { ok: true, row: result }
    } catch (cause) {
      if (!alive) return null
      const failure = apiFailure(cause)
      if (failure.status === 409 || failure.status === 404) retry = null
      return { ok: false, status: failure.status, message: failure.message }
    } finally {
      if (alive) pending.value = false
    }
  }

  return { pending, decide }
}
