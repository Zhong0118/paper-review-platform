/**
 * U4-1 学校确认／不予确认更正。
 * - 幂等键按命令内容复用：同一次操作失败后重试用同一把键，改了原因就换新键。
 * - 409：记录已变化，交给调用方重读后再核对；不自动重试。
 * - 卸载后不再写回状态。
 */
import { onBeforeUnmount, ref } from 'vue'

import { correctionCommand, type Correction } from '@/api/corrections'
import { apiFailure } from '@/api/failure'

export type SchoolDecision = 'activate' | 'reject'
export type DecisionOutcome = { ok: true; row: Correction } | { ok: false; conflict: boolean }

export function useSchoolCorrection() {
  const pending = ref(false)
  const error = ref('')
  let retry: { signature: string; key: string } | null = null
  let alive = true
  onBeforeUnmount(() => (alive = false))

  async function decide(action: SchoolDecision, row: Correction, reason: string): Promise<DecisionOutcome | null> {
    if (pending.value || !reason.trim()) return null
    const body = { version: row.version, reason: reason.trim() }
    const signature = JSON.stringify({ action, id: row.id, body })
    if (retry?.signature !== signature) retry = { signature, key: crypto.randomUUID() }
    pending.value = true
    error.value = ''
    try {
      const result = await correctionCommand(action, row.id, body, retry.key, { quiet: true })
      if (!alive) return null
      retry = null
      return { ok: true, row: result }
    } catch (reasonError) {
      if (!alive) return null
      const failure = apiFailure(reasonError)
      const conflict = failure.status === 409
      if (conflict) retry = null
      error.value = conflict ? '这条更正在你打开之后有变化，已重新读取，请核对后再操作。' : failure.message
      return { ok: false, conflict }
    } finally {
      if (alive) pending.value = false
    }
  }

  function clear() {
    error.value = ''
    retry = null
  }

  return { pending, error, decide, clear }
}
