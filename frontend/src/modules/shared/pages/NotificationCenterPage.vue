<script setup lang="ts">
import { computed } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import type { RoleCode } from '@/types/roles'
import type { RoleNotification } from '@/demo/types'

import StudentNotificationList from '../components/StudentNotificationList.vue'

const auth = useAuthStore()
const role = computed(() => (auth.user as ({ role?: RoleCode } & object) | null)?.role ?? 'student')

/** Task 9：运营端与专家端走同一角色通知列表，按当前角色投影（设计 §5.10）。 */
const recipientRole = computed<RoleNotification['recipientRole'] | undefined>(() => {
  if (role.value === 'platform_reviewer' || role.value === 'expert') return role.value
  return undefined
})
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole[role] ?? []"
    active-path="/notifications"
    context-label="消息中心"
    :user-name="auth.user?.displayName ?? '演示用户'"
  >
    <section class="notification-page">
      <PageHeader
        eyebrow="PAGE-015 · NOTIFICATIONS"
        title="消息通知"
        description="集中查看与当前角色有关的流程、任务和系统消息；不同角色只能看到自己的通知。"
      >
        <template v-if="role !== 'student'" #actions
          ><button type="button">全部标为已读</button></template
        >
      </PageHeader>
      <BlindRail
        audience="当前账号的站内消息与业务提醒"
        hidden-from="其他角色和其他组织的通知"
        stage="演示数据 · 邮件与短信后端待接入"
      />
      <!-- 学生端沿用学生通知列表（本人论文视角）；运营端/专家端按角色投影同一列表。 -->
      <StudentNotificationList v-if="role === 'student'" />
      <StudentNotificationList v-else-if="recipientRole" :recipient-role="recipientRole" />
    </section>
  </PortalLayout>
</template>

<style scoped>
.notification-page {
  display: grid;
  gap: 1rem;
}
.notification-page :deep(.page-header__actions) button {
  border: 1px solid #b9c6d0;
  border-radius: 0.28rem;
  background: #fff;
  color: #375064;
  font-weight: 650;
}
.notification-page :deep(.page-header__actions) button {
  padding: 0.6rem 0.8rem;
}
</style>
