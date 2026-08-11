<script setup lang="ts">
import { computed } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import type { RoleCode } from '@/types/roles'

import StudentNotificationList from '../components/StudentNotificationList.vue'

const auth = useAuthStore()
const role = computed(() => (auth.user as ({ role?: RoleCode } & object) | null)?.role ?? 'student')
const messages = [
  {
    type: '流程提醒',
    title: '匿名稿已通过学校核验',
    detail: '论文 HY-2026-0042 已进入平台派单队列。',
    time: '今天 09:32',
    unread: true,
  },
  {
    type: '任务消息',
    title: '评审任务状态发生变化',
    detail: '专家已接受任务，预计在 8 月 16 日前完成。',
    time: '昨天 16:08',
    unread: true,
  },
  {
    type: '系统公告',
    title: '演示环境数据说明',
    detail: '当前消息为前端演示数据，不会发送短信或邮件。',
    time: '8 月 8 日',
    unread: false,
  },
]
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
      <StudentNotificationList v-if="role === 'student'" />
      <template v-else>
        <div class="notification-filters">
          <button class="active" type="button">全部 3</button><button type="button">未读 2</button
          ><button type="button">流程提醒</button><button type="button">系统公告</button>
        </div>
        <section class="message-sheet" aria-label="消息列表">
          <article v-for="message in messages" :key="message.title" :data-unread="message.unread">
            <i aria-hidden="true" />
            <div>
              <span>{{ message.type }}</span>
              <h2>{{ message.title }}</h2>
              <p>{{ message.detail }}</p>
            </div>
            <time>{{ message.time }}</time>
            <button type="button">查看详情</button>
          </article>
        </section>
      </template>
    </section>
  </PortalLayout>
</template>

<style scoped>
.notification-page {
  display: grid;
  gap: 1rem;
}
.notification-page :deep(.page-header__actions) button,
.notification-filters button {
  border: 1px solid #b9c6d0;
  border-radius: 0.28rem;
  background: #fff;
  color: #375064;
  font-weight: 650;
}
.notification-page :deep(.page-header__actions) button {
  padding: 0.6rem 0.8rem;
}
.notification-filters {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.notification-filters button {
  padding: 0.45rem 0.75rem;
  font-size: 0.7rem;
}
.notification-filters .active {
  border-color: #1b4f8a;
  background: #1b4f8a;
  color: #fff;
}
.message-sheet {
  border: 1px solid #d8e0e6;
  background: #fff;
}
.message-sheet article {
  display: grid;
  grid-template-columns: 0.5rem minmax(0, 1fr) 7rem 5rem;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #e5eaee;
}
.message-sheet article:last-child {
  border-bottom: 0;
}
.message-sheet i {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #c3ccd3;
}
.message-sheet article[data-unread='true'] i {
  background: #cc4e36;
  box-shadow: 0 0 0 0.22rem #fbeae6;
}
.message-sheet span {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
}
.message-sheet h2 {
  margin: 0.2rem 0;
  color: #2d414f;
  font-size: 0.82rem;
}
.message-sheet p {
  margin: 0;
  color: #71808b;
  font-size: 0.7rem;
}
.message-sheet time {
  color: #7b8791;
  font-family: var(--font-data);
  font-size: 0.65rem;
}
.message-sheet button {
  border: 0;
  background: transparent;
  color: #1b4f8a;
  font-size: 0.7rem;
  font-weight: 650;
}
@media (max-width: 680px) {
  .message-sheet article {
    grid-template-columns: 0.5rem 1fr;
  }
  .message-sheet time,
  .message-sheet article > button {
    grid-column: 2;
  }
}
</style>
