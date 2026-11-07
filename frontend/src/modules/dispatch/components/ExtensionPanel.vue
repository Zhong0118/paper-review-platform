<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { httpApi } from '@/api/request'
import { beijingTime, type ExtensionRecord } from '@/api/taskTiming'

const props = defineProps<{ taskId?: string; canRequest?: boolean; due?: string }>()
const emit = defineEmits<{ changed: [] }>()
const history = ref<ExtensionRecord[]>([]),
  loading = ref(true),
  busy = ref(false)
const error = ref(''),
  feedback = ref(''),
  target = ref(''),
  reason = ref('')
const decisions = ref<Record<string, string>>({})
const listUrl = props.taskId
  ? '/expert/tasks/' + props.taskId + '/extensions'
  : '/platform-review/task-extensions'
const loaded = ref(false)
const mayApply = computed(
  () => props.canRequest && !history.value.some((r) => r.status !== 'REJECTED'),
)
const labels = { PENDING: '待审批', APPROVED: '已批准', REJECTED: '已驳回' }
async function load() {
  loading.value = true
  error.value = ''
  try {
    history.value = await httpApi.get<ExtensionRecord[]>(listUrl)
    loaded.value = true
    const approved = history.value.find((r) => r.status === 'APPROVED')
    if (props.taskId && approved && beijingTime(approved.requested_due_at) !== props.due)
      emit('changed')
  } catch {
    loaded.value = false
    history.value = []
    error.value = '未能加载延期记录，请刷新。'
  } finally {
    loading.value = false
  }
}
async function send(id?: string, status?: 'APPROVED' | 'REJECTED') {
  if (busy.value) return
  busy.value = true
  feedback.value = ''
  error.value = ''
  try {
    const key = { idempotencyKey: crypto.randomUUID() }
    if (id)
      await httpApi.post(
        listUrl + '/' + id + ':decide',
        { status, reason: decisions.value[id]?.trim() },
        key,
      )
    else
      await httpApi.post(
        listUrl,
        {
          requested_due_at: new Date(target.value + ':00+08:00').toISOString(),
          reason: reason.value.trim(),
        },
        key,
      )
    await load()
    if (id) emit('changed')
    reason.value = ''
    target.value = ''
    feedback.value = id ? '审批结果已保存' : '延期申请已提交'
  } catch (err) {
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    await load()
    error.value = msg || '操作未完成，请核对当前期限与任务状态。'
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>
<template>
  <section class="extensions" aria-label="评阅延期" data-extension-panel>
    <header>
      <strong>{{ taskId ? '我的延期记录' : '评阅延期审批' }}</strong
      ><button type="button" @click="load" :disabled="loading || busy">刷新记录</button>
    </header>
    <p v-if="taskId && due">当前评阅截止：{{ due }}（北京时间）</p>
    <p v-if="feedback" role="status">{{ feedback }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading">正在读取延期记录…</p>
    <template v-else>
      <p v-if="!history.length && !error">暂无延期记录</p>
      <article v-for="r in history" :key="r.id" :data-extension-status="r.status">
        <strong
          >任务 {{ r.task_id.slice(0, 8) }} ·
          {{
            r.status === 'PENDING' && !r.actionable ? '任务已结束（未审批）' : labels[r.status]
          }}</strong
        >
        <p>
          原截止 {{ beijingTime(r.original_due_at) }} → 申请截止
          {{ beijingTime(r.requested_due_at) }}（北京时间）
        </p>
        <p>{{ beijingTime(r.requested_at) }} 申请：{{ r.reason }}</p>
        <p v-if="r.decided_at">{{ beijingTime(r.decided_at) }} 审批：{{ r.decision_reason }}</p>
        <template v-if="!taskId && r.actionable">
          <label>审批理由<input v-model="decisions[r.id]" maxlength="500" required /></label>
          <button
            type="button"
            :disabled="busy || !decisions[r.id]?.trim()"
            @click="send(r.id, 'APPROVED')"
          >
            批准延期
          </button>
          <button
            type="button"
            :disabled="busy || !decisions[r.id]?.trim()"
            @click="send(r.id, 'REJECTED')"
          >
            驳回申请
          </button>
        </template>
      </article>
      <form v-if="mayApply && loaded" @submit.prevent="send()">
        <label>申请截止（北京时间）<input v-model="target" type="datetime-local" required /></label>
        <label>延期理由<input v-model="reason" maxlength="500" required /></label>
        <button :disabled="busy || !target || !reason.trim()">提交延期申请</button>
      </form>
    </template>
  </section>
</template>
<style scoped>
.extensions {
  display: grid;
  gap: 0.6rem;
  padding: 1rem;
  border: 1px solid #ccd7e1;
  border-radius: 0.35rem;
  background: white;
  color: #243846;
}
header,
form,
article {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem;
}
header {
  justify-content: space-between;
}
article {
  border-top: 1px solid #dde3eb;
  padding-top: 0.65rem;
}
article p {
  width: 100%;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
  font-size: 0.85rem;
}
label {
  display: grid;
  gap: 0.2rem;
}
input,
button {
  border: 1px solid #becddd;
  border-radius: 0.25rem;
  padding: 0.4rem;
}
button {
  background: #f2f7fd;
  color: #183b62;
  cursor: pointer;
  transition: transform 0.15s;
}
button:hover:enabled {
  transform: translateY(-1px);
}
button:disabled {
  opacity: 0.55;
}
</style>
