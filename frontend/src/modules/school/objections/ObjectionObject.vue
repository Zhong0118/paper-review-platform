<script setup lang="ts">
/**
 * U4-2 异议对象区：学生原文 → 办理（开始处理）或办结（渠道＋结论，均必填，结论学生可见）。
 * 两个命令都没有版本号：409 时重读，已是目标状态（办结且结论一致）按成功说明，否则提示状态已变化。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { apiFailure } from '@/api/failure'
import { resolveObjection, startObjection, type ObjectionRow } from '@/api/objections'
import { beijingDate } from '@/api/taskTiming'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StatusPill, { type PillTone } from '@/components/workspace/StatusPill.vue'

import { channelText, type ObjectionStatus } from './objectionView'

const props = defineProps<{
  row: ObjectionRow
  title: string
  studentNo: string
  /** 找到对应论文时才给出结果链接 */
  thesisFound: boolean
  /** P1-5：本校论文列表没有取到，题目位置显示说明并给重试 */
  titleMissing?: boolean
  reload: () => Promise<ObjectionRow[] | null>
}>()
const emit = defineEmits<{ moved: [status: ObjectionStatus] }>()

let alive = true
onBeforeUnmount(() => (alive = false))
const flash = ref('')
const conflict = ref('')
const pending = ref(false)

const pill = computed<{ tone: PillTone; text: string }>(() =>
  props.row.status === 'SUBMITTED' ? { tone: 'action', text: '待处理' } : props.row.status === 'PROCESSING' ? { tone: 'warning', text: '处理中' } : { tone: 'success', text: '已办结' },
)

const retrying = ref(false)
async function retryTitle() {
  if (retrying.value) return
  retrying.value = true
  try {
    await props.reload()
  } finally {
    if (alive) retrying.value = false
  }
}

const STARTED = '已开始处理。学生会看到“学校正在处理你的异议”。'
const RESOLVED = '已办结。学生现在可以在反馈页看到处理结论。'

// ---- 开始处理 ----
const startError = ref('')
async function start() {
  if (pending.value) return
  pending.value = true
  startError.value = ''
  conflict.value = ''
  try {
    await startObjection(props.row.id, { quiet: true })
    if (!alive) return
    flash.value = STARTED
    await props.reload()
    emit('moved', 'PROCESSING')
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status !== 409) {
      startError.value = failure.message
      return
    }
    const now = (await props.reload())?.find((item) => item.id === props.row.id)
    if (!alive) return
    if (now?.status === 'PROCESSING') {
      flash.value = STARTED
      emit('moved', 'PROCESSING')
    } else conflict.value = '这条异议的状态在你打开之后有变化，已重新读取，请核对。'
  } finally {
    if (alive) pending.value = false
  }
}

// ---- 办结 ----
const channel = ref<'ONLINE' | 'OFFLINE' | ''>('')
const conclusion = ref('')
const tried = ref(false)
const confirmOpen = ref(false)
const resolveError = ref('')
const missing = computed(() => ({ channel: tried.value && !channel.value, conclusion: tried.value && !conclusion.value.trim() }))

function requestResolve() {
  tried.value = true
  if (!channel.value || !conclusion.value.trim()) return
  resolveError.value = ''
  confirmOpen.value = true
}
async function resolve() {
  if (pending.value || !channel.value || !conclusion.value.trim()) return
  const body = { channel: channel.value, conclusion: conclusion.value.trim() }
  pending.value = true
  resolveError.value = ''
  conflict.value = ''
  try {
    await resolveObjection(props.row.id, body, { quiet: true })
    if (!alive) return
    confirmOpen.value = false
    flash.value = RESOLVED
    await props.reload()
    emit('moved', 'RESOLVED')
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status !== 409) {
      resolveError.value = failure.message
      return
    }
    confirmOpen.value = false
    const now = (await props.reload())?.find((item) => item.id === props.row.id)
    if (!alive) return
    if (now?.status === 'RESOLVED' && now.channel === body.channel && now.conclusion === body.conclusion) {
      flash.value = RESOLVED
      emit('moved', 'RESOLVED')
    } else conflict.value = '这条异议的状态在你打开之后有变化，已重新读取，请核对。你写的结论没有提交。'
  } finally {
    if (alive) pending.value = false
  }
}
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head">
      <div class="wsd-obj__row">
        <StatusPill :tone="pill.tone">{{ pill.text }}</StatusPill>
        <RouterLink v-if="thesisFound" class="btn btn--sm btn--quiet" data-result-link :to="{ path: '/school/results', query: { view: 'published', thesis: row.thesis_id } }">查看已发布结果</RouterLink>
      </div>
      <div class="title-row">
        <h2 class="wsd-obj__title" :class="{ muted: titleMissing }" data-object-title>{{ title }}</h2>
        <button v-if="titleMissing" type="button" class="btn btn--sm" data-action="retry-title" :disabled="retrying" @click="retryTitle">{{ retrying ? '正在重试…' : '重试' }}</button>
      </div>
      <dl class="wsd-obj__meta">
        <div><dt>学生</dt><dd>{{ row.student_name || '未取得姓名' }}<template v-if="studentNo">（{{ studentNo }}）</template></dd></div>
        <div><dt>登记</dt><dd class="num">{{ beijingDate(row.created_at) }}</dd></div>
      </dl>
    </header>

    <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
    <div v-if="conflict" class="wsd-banner wsd-banner--danger" role="alert">{{ conflict }}</div>

    <section class="wsd-sec" aria-labelledby="obj-h">
      <div class="wsd-sec__head"><h3 id="obj-h">学生的异议</h3><p>原文</p></div>
      <dl class="said">
        <dt>理由</dt><dd class="wsd-plain">{{ row.reason }}</dd>
        <dt>诉求</dt><dd class="wsd-plain" :class="{ muted: !row.request.trim() }">{{ row.request.trim() ? row.request : '学生未填写诉求' }}</dd>
      </dl>
    </section>

    <section v-if="row.status === 'SUBMITTED'" class="wsd-sec" aria-labelledby="do-h">
      <div class="wsd-sec__head"><h3 id="do-h">办理</h3></div>
      <p class="wsd-hint">开始处理后，学生会看到“学校正在处理”。之后在这里记录办理渠道与结论。</p>
      <p v-if="startError" class="field-error" role="alert">{{ startError }}</p>
      <div class="wsd-acts">
        <button type="button" class="btn btn--primary" data-action="start-objection" :disabled="pending" @click="start">{{ pending ? '正在提交…' : '开始处理' }}</button>
      </div>
    </section>

    <section v-else-if="row.status === 'PROCESSING'" class="wsd-sec" aria-labelledby="do-h">
      <div class="wsd-sec__head"><h3 id="do-h">办结</h3><p>结论学生可见</p></div>
      <fieldset class="field fs" :aria-describedby="missing.channel ? 'channel-err' : undefined">
        <legend>办理渠道</legend>
        <div class="wsd-choices">
          <label class="wsd-choice"><input v-model="channel" type="radio" name="objection-channel" value="ONLINE" :disabled="pending" /> 线上答复</label>
          <label class="wsd-choice"><input v-model="channel" type="radio" name="objection-channel" value="OFFLINE" :disabled="pending" /> 线下沟通</label>
        </div>
        <small v-if="missing.channel" id="channel-err" class="field-error">请选择办理渠道。</small>
      </fieldset>
      <label class="field">
        <span>处理结论</span>
        <textarea v-model="conclusion" class="textarea" rows="4" maxlength="2000" data-conclusion :disabled="pending" :aria-invalid="missing.conclusion" placeholder="写明核对了什么、结论是什么、评阅结论是否改变" />
        <small v-if="missing.conclusion" class="field-error">请填写处理结论。</small>
      </label>
      <div class="wsd-acts wsd-acts--end">
        <button type="button" class="btn btn--primary" data-action="resolve-objection" :disabled="pending" @click="requestResolve">办结异议…</button>
      </div>
    </section>

    <section v-else class="wsd-sec" aria-labelledby="done-h">
      <div class="wsd-sec__head"><h3 id="done-h">处理结论</h3></div>
      <dl class="wsd-kv">
        <dt>渠道</dt><dd>{{ row.channel ? channelText[row.channel as 'ONLINE' | 'OFFLINE'] ?? row.channel : '未记录' }}</dd>
        <dt>结论</dt><dd class="wsd-plain">{{ row.conclusion || '未记录' }}</dd>
      </dl>
    </section>
  </div>

  <ConfirmDialog :open="confirmOpen" title="办结这条异议" :busy="pending" @close="pending || (confirmOpen = false)">
    <p>办结后学生会看到渠道“{{ channel && channelText[channel] }}”和下面的结论：</p>
    <p class="quote wsd-plain">{{ conclusion.trim() }}</p>
    <p v-if="resolveError" class="field-error" role="alert">{{ resolveError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="pending" @click="confirmOpen = false">再改改</button>
      <button type="button" class="btn btn--primary" data-action="confirm-resolve" :disabled="pending" @click="resolve">{{ pending ? '正在提交…' : '确认办结' }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.title-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
}
.said {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0;
  line-height: 1.75;
}
.said dt {
  color: var(--ws-muted);
  font-size: 13px;
}
.said dd {
  margin: 0;
}
.fs {
  margin: 0;
  padding: 0;
  border: 0;
}
.fs legend {
  margin-bottom: 6px;
  padding: 0;
  font-size: 13px;
  font-weight: 500;
}
.quote {
  padding: 10px 12px;
  border-left: 3px solid var(--ws-border-strong);
  background: var(--ws-page);
}
</style>
