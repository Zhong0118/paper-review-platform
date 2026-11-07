<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useScenarioService } from '@/demo/serviceProvider'
import type { RoleNotification, StudentNotification } from '@/demo/types'

interface NotificationPresentation {
  type: string
  title: string
}

interface StudentNotificationTarget {
  routeName: '学生工作台' | '学生评审结果'
  query: { thesisId: string }
}

/** Task 9：角色通知（platform_reviewer/expert）的关联页面目标。 */
interface RoleNotificationTarget {
  path: '/expert/tasks' | '/expert/finance' | '/platform/dispatch'
  query: Record<string, string>
}

/** 列表投影：学生与角色两种数据源统一为渲染所需的最小字段。 */
interface DisplayNotification {
  id: string
  message: string
  createdAt: string
  read: boolean
  type: string
  title: string
  target: StudentNotificationTarget | RoleNotificationTarget | null
}

const props = defineProps<{ recipientRole?: RoleNotification['recipientRole'] }>()

const isRoleList = computed(() => props.recipientRole !== undefined)

const studentPresentationByKind: Record<StudentNotification['kind'], NotificationPresentation> = {
  THESIS_SUBMITTED: { type: '流程提醒', title: '论文已提交' },
  THESIS_WITHDRAWN: { type: '流程提醒', title: '论文已撤回' },
  THESIS_RETURNED: { type: '学校退回', title: '论文材料已退回' },
  WITHDRAWAL_REQUESTED: { type: '流程提醒', title: '撤回申请已提交' },
  EXPERT_REVIEW_STARTED: { type: '流程提醒', title: '已进入送审评阅' },
  RESULT_PUBLISHED: { type: '结果通知', title: '评审结果已发布' },
  OBJECTION_SUBMITTED: { type: '异议消息', title: '异议已提交' },
  OBJECTION_RECEIVED: { type: '异议消息', title: '收到新的异议' },
  DEMO_DATA_RESET: { type: '系统公告', title: '演示数据已重置' },
}

/** Task 9：角色通知的类型与标题投影（设计 §5.10 六类事件）。 */
const rolePresentationByKind: Record<RoleNotification['kind'], NotificationPresentation> = {
  TASK_INVITED: { type: '接单邀请', title: '收到评审邀请' },
  TASK_ACCEPTED: { type: '任务消息', title: '专家已接受任务' },
  TASK_REJECTED: { type: '任务消息', title: '专家拒绝接单' },
  TASK_TIMEOUT: { type: '任务消息', title: '接单已超时' },
  REVIEW_REMINDER: { type: '催审提醒', title: '平台催审提醒' },
  CORRECTION_DECIDED: { type: '更正审批', title: '更正审批结果' },
  WITHDRAWAL_DECIDED: { type: '提现消息', title: '提现结果' },
}

const service = useScenarioService()
const router = useRouter()
const notifications = ref<DisplayNotification[]>([])
const loading = ref(true)
const error = ref('')
const markingAll = ref(false)
const openingId = ref('')

const unreadCount = computed(() => notifications.value.filter((item) => !item.read).length)

/** 学生通知跳转：结果/异议类进评审结果页，其余进学生工作台（行为与 Task 6 前一致）。 */
function studentTargetFor(notification: StudentNotification): StudentNotificationTarget | null {
  if (!notification.thesisId) return null
  const routeName = ['RESULT_PUBLISHED', 'OBJECTION_SUBMITTED'].includes(notification.kind)
    ? '学生评审结果'
    : '学生工作台'
  return { routeName, query: { thesisId: notification.thesisId } }
}

/** Task 9：角色通知跳转——平台侧进运营台，专家侧进任务列表/费用页（设计 §5.10）。 */
function roleTargetFor(notification: RoleNotification): RoleNotificationTarget | null {
  if (notification.recipientRole === 'platform_reviewer') {
    return { path: '/platform/dispatch', query: {} }
  }
  if (notification.kind === 'WITHDRAWAL_DECIDED') {
    return {
      path: '/expert/finance',
      query: notification.withdrawalId ? { withdrawalId: notification.withdrawalId } : {},
    }
  }
  return {
    path: '/expert/tasks',
    query: notification.taskId ? { taskId: notification.taskId } : {},
  }
}

/** 统一展示投影（学生/角色两套数据源 → DisplayNotification）。 */
function toDisplay(
  item: StudentNotification | RoleNotification,
  isRole: boolean,
): DisplayNotification {
  const presentation = isRole
    ? rolePresentationByKind[(item as RoleNotification).kind]
    : studentPresentationByKind[(item as StudentNotification).kind]
  return {
    id: item.id,
    message: item.message,
    createdAt: item.createdAt,
    read: item.read,
    type: presentation?.type ?? '系统公告',
    title: presentation?.title ?? '平台消息',
    target: isRole
      ? roleTargetFor(item as RoleNotification)
      : studentTargetFor(item as StudentNotification),
  }
}

async function loadNotifications() {
  loading.value = true
  error.value = ''
  try {
    const list = isRoleList.value
      ? await service.listRoleNotifications(props.recipientRole!)
      : await service.listStudentNotifications()
    notifications.value = list.map((item) => toDisplay(item, isRoleList.value))
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
    const list = isRoleList.value
      ? await service.markAllRoleNotificationsRead(props.recipientRole!)
      : await service.markAllStudentNotificationsRead()
    notifications.value = list.map((item) => toDisplay(item, isRoleList.value))
  } catch {
    error.value = '消息状态更新失败，请重试。'
  } finally {
    markingAll.value = false
  }
}

async function updateNotificationRead(id: string) {
  try {
    const list = isRoleList.value
      ? await service.markRoleNotificationRead(props.recipientRole!, id)
      : await service.markStudentNotificationRead(id)
    notifications.value = list.map((item) => toDisplay(item, isRoleList.value))
    return true
  } catch {
    error.value = '消息状态更新失败，请重试。'
    return false
  }
}

async function markNotificationRead(notification: DisplayNotification) {
  if (openingId.value) return
  openingId.value = notification.id
  error.value = ''
  await updateNotificationRead(notification.id)
  openingId.value = ''
}

async function openNotification(notification: DisplayNotification) {
  if (openingId.value) return
  openingId.value = notification.id
  error.value = ''
  if (!(await updateNotificationRead(notification.id))) {
    openingId.value = ''
    return
  }

  const target = notification.target
  if (!target) {
    openingId.value = ''
    return
  }

  // 学生通知按「本人论文」校验归属（他人论文消息拒绝跳转）；角色通知按 recipientRole
  // 隔离（列表数据已由服务过滤，无需论文归属校验）。
  if (!isRoleList.value && 'routeName' in target) {
    try {
      await service.getStudentThesis(target.query.thesisId)
    } catch {
      error.value = '无法打开不属于本人的论文消息。'
      openingId.value = ''
      return
    }
  }

  try {
    if ('path' in target) {
      await router.push({ path: target.path, query: target.query })
    } else {
      await router.push({ name: target.routeName, query: target.query })
    }
  } catch {
    error.value = '关联页面打开失败，请重试。'
  } finally {
    openingId.value = ''
  }
}

onMounted(() => void loadNotifications())
</script>

<template>
  <section
    class="student-notifications"
    :data-student-notification-list="isRoleList ? undefined : true"
    :data-role-notification-list="isRoleList ? true : undefined"
  >
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
      :aria-label="isRoleList ? '角色消息列表' : '学生消息列表'"
    >
      <article
        v-for="notification in notifications"
        :key="notification.id"
        :data-notification-id="notification.id"
        :data-unread="!notification.read"
      >
        <i aria-hidden="true" />
        <div>
          <span data-notification-type>{{ notification.type }}</span>
          <h2>{{ notification.title }}</h2>
          <p>{{ notification.message }}</p>
        </div>
        <time>{{ notification.createdAt }}</time>
        <span class="student-notifications__read-state" data-notification-read-state>
          {{ notification.read ? '已读' : '未读' }}
        </span>
        <button
          v-if="notification.target"
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
  color: var(--color-text-secondary);
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
