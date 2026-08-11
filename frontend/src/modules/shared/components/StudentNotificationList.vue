<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useStudentPortalService } from '@/demo/serviceProvider'
import type { StudentNotification } from '@/demo/types'

interface NotificationPresentation {
  type: string
  title: string
}

interface StudentNotificationTarget {
  routeName: '学生工作台' | '学生评审结果'
  query: { thesisId: string }
}

const presentationByKind: Record<StudentNotification['kind'], NotificationPresentation> = {
  THESIS_SUBMITTED: { type: '流程提醒', title: '论文已提交' },
  THESIS_WITHDRAWN: { type: '流程提醒', title: '论文已撤回' },
  WITHDRAWAL_REQUESTED: { type: '流程提醒', title: '撤回申请已提交' },
  RESULT_PUBLISHED: { type: '结果通知', title: '评审结果已发布' },
  OBJECTION_SUBMITTED: { type: '异议消息', title: '异议已提交' },
  OBJECTION_RECEIVED: { type: '异议消息', title: '收到新的异议' },
  DEMO_DATA_RESET: { type: '系统公告', title: '演示数据已重置' },
}

const service = useStudentPortalService()
const router = useRouter()
const notifications = ref<StudentNotification[]>([])
const loading = ref(true)
const error = ref('')
const markingAll = ref(false)
const openingId = ref('')

const unreadCount = computed(() => notifications.value.filter((item) => !item.read).length)

function targetFor(notification: StudentNotification): StudentNotificationTarget | null {
  if (!notification.thesisId) return null
  const routeName = ['RESULT_PUBLISHED', 'OBJECTION_SUBMITTED'].includes(notification.kind)
    ? '学生评审结果'
    : '学生工作台'
  return { routeName, query: { thesisId: notification.thesisId } }
}

async function loadNotifications() {
  loading.value = true
  error.value = ''
  try {
    notifications.value = await service.listStudentNotifications()
  } catch {
    error.value = '消息加载失败，请重试。'
  } finally {
    loading.value = false
  }
}

async function markAllRead() {
  if (markingAll.value || unreadCount.value === 0) return
  markingAll.value = true
  error.value = ''
  try {
    notifications.value = await service.markAllStudentNotificationsRead()
  } catch {
    error.value = '消息状态更新失败，请重试。'
  } finally {
    markingAll.value = false
  }
}

async function updateNotificationRead(id: string) {
  try {
    notifications.value = await service.markStudentNotificationRead(id)
    return true
  } catch {
    error.value = '消息状态更新失败，请重试。'
    return false
  }
}

async function markNotificationRead(notification: StudentNotification) {
  if (openingId.value) return
  openingId.value = notification.id
  error.value = ''
  await updateNotificationRead(notification.id)
  openingId.value = ''
}

async function openNotification(notification: StudentNotification) {
  if (openingId.value) return
  openingId.value = notification.id
  error.value = ''
  if (!(await updateNotificationRead(notification.id))) {
    openingId.value = ''
    return
  }

  const target = targetFor(notification)
  if (!target || !notification.thesisId) {
    openingId.value = ''
    return
  }

  try {
    await service.getStudentThesis(notification.thesisId)
  } catch {
    error.value = '无法打开不属于本人的论文消息。'
    openingId.value = ''
    return
  }

  try {
    await router.push({ name: target.routeName, query: target.query })
  } catch {
    error.value = '关联页面打开失败，请重试。'
  } finally {
    openingId.value = ''
  }
}

onMounted(() => void loadNotifications())
</script>

<template>
  <section class="student-notifications" data-student-notification-list>
    <div class="student-notifications__toolbar">
      <div class="student-notifications__counts" aria-label="消息统计">
        <span data-notification-count="all">全部 {{ notifications.length }}</span>
        <span data-notification-count="unread">未读 {{ unreadCount }}</span>
      </div>
      <button
        type="button"
        data-action="mark-all-notifications-read"
        :disabled="markingAll || unreadCount === 0"
        @click="markAllRead"
      >
        {{ markingAll ? '正在更新…' : '全部标为已读' }}
      </button>
    </div>

    <p v-if="error" class="student-notifications__error" role="alert">
      {{ error }}
      <button
        v-if="notifications.length === 0"
        type="button"
        data-action="reload-notifications"
        @click="loadNotifications"
      >
        重新加载
      </button>
    </p>

    <p v-if="loading" class="student-notifications__state">正在加载消息…</p>
    <p
      v-else-if="!error && notifications.length === 0"
      class="student-notifications__state"
      data-notification-empty
    >
      暂无消息
    </p>

    <section
      v-else-if="notifications.length"
      class="student-notifications__list"
      aria-label="学生消息列表"
    >
      <article
        v-for="notification in notifications"
        :key="notification.id"
        :data-notification-id="notification.id"
        :data-unread="!notification.read"
      >
        <i aria-hidden="true" />
        <div>
          <span data-notification-type>{{ presentationByKind[notification.kind].type }}</span>
          <h2>{{ presentationByKind[notification.kind].title }}</h2>
          <p>{{ notification.message }}</p>
        </div>
        <time>{{ notification.createdAt }}</time>
        <span class="student-notifications__read-state" data-notification-read-state>
          {{ notification.read ? '已读' : '未读' }}
        </span>
        <button
          v-if="targetFor(notification)"
          type="button"
          data-action="open-notification"
          :disabled="openingId === notification.id"
          @click="openNotification(notification)"
        >
          {{ openingId === notification.id ? '正在打开…' : '查看关联页面' }}
        </button>
        <button
          v-else-if="!notification.read"
          type="button"
          data-action="mark-notification-read"
          :disabled="openingId === notification.id"
          @click="markNotificationRead(notification)"
        >
          {{ openingId === notification.id ? '正在更新…' : '标为已读' }}
        </button>
      </article>
    </section>
  </section>
</template>

<style scoped>
.student-notifications {
  display: grid;
  gap: 0.75rem;
}

.student-notifications__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.student-notifications__counts {
  display: flex;
  gap: 0.5rem;
}

.student-notifications__counts span,
.student-notifications__toolbar button,
.student-notifications__error button {
  border: 1px solid #b9c6d0;
  border-radius: 0.28rem;
  background: #fff;
  color: #375064;
  font-size: 0.7rem;
  font-weight: 650;
  padding: 0.45rem 0.75rem;
}

.student-notifications__counts span:first-child {
  border-color: #1b4f8a;
  background: #1b4f8a;
  color: #fff;
}

.student-notifications__toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.student-notifications__state,
.student-notifications__error {
  margin: 0;
  border: 1px solid #d8e0e6;
  background: #fff;
  color: #526675;
  padding: 1rem;
}

.student-notifications__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-color: #e7bdb5;
  background: #fff7f5;
  color: #8a3528;
}

.student-notifications__list {
  border: 1px solid #d8e0e6;
  background: #fff;
}

.student-notifications__list article {
  display: grid;
  grid-template-columns: 0.5rem minmax(0, 1fr) 8.5rem 3rem 7rem;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #e5eaee;
}

.student-notifications__list article:last-child {
  border-bottom: 0;
}

.student-notifications__list i {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #c3ccd3;
}

.student-notifications__list article[data-unread='true'] i {
  background: #cc4e36;
  box-shadow: 0 0 0 0.22rem #fbeae6;
}

.student-notifications__list [data-notification-type] {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
}

.student-notifications__list h2 {
  margin: 0.2rem 0;
  color: #2d414f;
  font-size: 0.82rem;
}

.student-notifications__list p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
}

.student-notifications__list time,
.student-notifications__read-state {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.student-notifications__list button {
  border: 0;
  background: transparent;
  color: #1b4f8a;
  font-size: 0.7rem;
  font-weight: 650;
}

@media (max-width: 680px) {
  .student-notifications__list article {
    grid-template-columns: 0.5rem minmax(0, 1fr);
  }

  .student-notifications__list time,
  .student-notifications__list article > button,
  .student-notifications__read-state {
    grid-column: 2;
  }
}
</style>
