import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { scenarioService } from '@/demo/serviceProvider'
import type { DemoScenarioSnapshot } from '@/demo/types'
import type { RoleCode } from '@/types/roles'

export const useDemoScenarioStore = defineStore('demoScenario', () => {
  const snapshot = ref<DemoScenarioSnapshot | null>(null)
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)

  const activeRole = computed(() => snapshot.value?.context.role ?? null)
  const allowedActions = computed(() => snapshot.value?.thesis.allowedActions ?? [])

  async function run(command: () => Promise<DemoScenarioSnapshot>) {
    loading.value = true
    errorMessage.value = null
    try {
      snapshot.value = await command()
      return snapshot.value
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '场景操作失败'
      throw error
    } finally {
      loading.value = false
    }
  }

  function loginAs(role: RoleCode) {
    return run(() => scenarioService.loginAs(role))
  }

  function reset() {
    return run(() => scenarioService.reset())
  }

  return {
    snapshot,
    loading,
    errorMessage,
    activeRole,
    allowedActions,
    loginAs,
    reset,
    run,
  }
})
