<script setup lang="ts">
/**
 * U2-1 学校送审准备（真实模式）：/school/preparation 为清单，?thesis=<id> 为核验台。
 * 清单数据在这里读一次，清单与核验台共用（核验台只用它算位置与下一篇）。
 * demo 模式仍走旧页 PreparationListPage（见 router/routes.ts）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { ThesisDetail } from '@/api/theses'
import { listSchoolTheses } from '@/api/schoolReview'
import type { NavGroup, WorkspaceAccount } from '@/components/workspace/types'
import { useTimeScope } from '@/composables/useTimeScope'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import { apiFailure } from './checkReport'
import PreparationQueue from './PreparationQueue.vue'
import VerifyDesk from './VerifyDesk.vue'

const route = useRoute()
const auth = useAuthStore()
const timeScope = useTimeScope()
const thesisId = computed(() => (typeof route.query.thesis === 'string' && route.query.thesis ? route.query.thesis : ''))

const rows = ref<ThesisDetail[]>([])
const loading = ref(true)
const error = ref('')
let generation = 0

async function load() {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const items = await listSchoolTheses(...timeScope.request())
    if (request !== generation) return
    rows.value = items
  } catch (reason) {
    if (request !== generation) return
    rows.value = []
    error.value = apiFailure(reason).message
  } finally {
    if (request === generation) loading.value = false
  }
}
watch([timeScope.scope, timeScope.identity], () => void load(), { immediate: true })
onBeforeUnmount(() => generation++)

const verifyCount = computed(() => (loading.value || error.value ? undefined : rows.value.filter((row) => row.stage === 'PREPARING').length))
const nav = computed<NavGroup[]>(() => [
  {
    items: portalMenus('school_reviewer').map((item) => ({
      label: item.label,
      to: item.path,
      active: item.path === '/school/preparation',
      count: item.path === '/school/preparation' ? verifyCount.value : undefined,
    })),
  },
])
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '学校审核',
  org: auth.user?.tenantCode ?? '',
}))
</script>

<template>
  <div class="ws">
    <VerifyDesk
      v-if="thesisId"
      :key="thesisId"
      :thesis-id="thesisId"
      :rows="rows"
      :rows-ready="!loading && !error"
      :account="account"
      @changed="load"
    />
    <PreparationQueue
      v-else
      :rows="rows"
      :loading="loading"
      :error="error"
      :nav="nav"
      :account="account"
      :scope="timeScope.scope.value"
      @set-scope="timeScope.setScope"
      @retry="load"
    />
  </div>
</template>
