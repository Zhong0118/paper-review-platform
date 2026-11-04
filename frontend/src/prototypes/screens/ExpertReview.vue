<script setup lang="ts">
/**
 * P08 专家专注评阅（专注工作空间）：匿名稿阅读器（约 62%）｜评阅区（约 38%），分栏可调。
 * 保存走 draftController：单飞、合并后续输入、失败保留、冲突暂停；“保存并退出”先 flush 再离开。
 * 版本条件按 v2.1 C-SAVE：普通评阅草稿用整数 revision（expected_revision），更正稿用更正申请 version 且手动保存。
 * U2 优先复用修复快照中已验收的保存队列，本原型控制器只用于演示交互。
 * 评分项与汇总区间来自规则快照；专家的“评阅建议”与规则结论是不同字段，不互相改写。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import FocusShell from '../kit/FocusShell.vue'
import MockDocument from '../kit/MockDocument.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import SaveStatus from '../kit/SaveStatus.vue'
import SplitPane from '../kit/SplitPane.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { createDraftController } from '../kit/draftController'
import { useProtoState } from '../kit/useProtoState'
import { correctionDraftTransport, reviewDraftTransport, type FakeMode } from '../data/fakeTransports'
import { accounts, documentPages, reviewRule, type DimensionKey } from '../data/fixtures'

const states = [
  { value: 'normal', label: '正常保存' },
  { value: 'slow', label: '保存较慢（测退出等待）' },
  { value: 'fail', label: '保存失败' },
  { value: 'conflict', label: '另一页签已保存（冲突）' },
  { value: 'submit', label: '提交确认' },
  { value: 'submitted', label: '已提交只读' },
  { value: 'correction', label: '更正已批准：手动保存' },
  { value: 'correction-fail', label: '更正：保存失败' },
  { value: 'correction-conflict', label: '更正：版本冲突' },
  { value: 'cancelled', label: '任务已不在名下' },
] as const
const state = useProtoState(states, 'normal')
const router = useRouter()

interface ReviewForm {
  overallComment: string
  strengths: string
  issues: string
  revisionAdvice: string
  recommendation: '' | '建议通过' | '建议修改' | '不通过'
  scores: Record<DimensionKey, number>
}
const initial: ReviewForm = {
  overallComment:
    '论文针对边缘计算环境中节点失效相关性被忽视的问题，提出按任务关键度分级的副本放置策略，选题具有现实意义。实验覆盖模拟与真实集群两类环境，工作量饱满。',
  strengths: '问题定义清楚；理论界的推导完整；实验设计覆盖面较好。',
  issues: '1. 第三章失效相关性的估计依赖历史日志，未讨论日志稀疏时的偏差。\n2. 第五章对比基线均为静态冗余方法。',
  revisionAdvice: '',
  recommendation: '建议修改',
  scores: { topicValue: 12, literatureTheory: 10, methodology: 14, innovation: 17, writingStandards: 8, resultsWorkload: 13 },
}

const reviewMode = (): FakeMode => (state.value === 'slow' ? 'slow' : state.value === 'fail' ? 'fail' : state.value === 'conflict' ? 'conflict' : 'ok')
// 普通评阅草稿：整数 revision，服务端返回值原样回传
const draft = createDraftController<ReviewForm, number>({
  initial,
  revision: 4,
  debounceMs: 900,
  save: reviewDraftTransport<ReviewForm>(reviewMode, (mine) => ({
    ...mine,
    issues: `${initial.issues}\n3. 定理 4.2 的独立性假设需说明。`,
  })),
})
const conflictFields = computed(() => {
  const server = draft.conflict.value?.server
  if (!server) return []
  return (['overallComment', 'strengths', 'issues', 'revisionAdvice'] as const)
    .filter((k) => server[k] !== form[k])
    .map((k) => ({ key: k, label: fieldLabels[k], mine: form[k], server: server[k] }))
})
const fieldLabels = { overallComment: '总体评价', strengths: '主要优点', issues: '主要问题', revisionAdvice: '修改建议' } as const
const form = reactive<ReviewForm>(structuredClone(initial))
watch(form, (value) => draft.update(value), { deep: true })
onBeforeUnmount(() => draft.dispose())

const submitted = ref(false)
watch(
  state,
  (value) => {
    submitted.value = value === 'submitted' || isCorrection(value)
    if (submitted.value) draft.lock()
    resetCorrection()
    submitOpen.value = value === 'submit'
  },
  { immediate: false },
)

const tab = ref<'comments' | 'scores' | 'check'>('comments')
const total = computed(() => Object.values(form.scores).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0))
const band = computed(() => reviewRule.bands.find((b) => total.value >= b.min && total.value <= b.max))
const scoreErrors = computed(() =>
  reviewRule.dimensions
    .filter((d) => !Number.isInteger(form.scores[d.key]) || form.scores[d.key] < 0 || form.scores[d.key] > d.max_score)
    .map((d) => d.key),
)

const checklist = computed(() => [
  { label: '总体评价', ok: form.overallComment.trim().length >= 30 },
  { label: '主要问题', ok: form.issues.trim().length >= 30 },
  { label: '修改建议', ok: form.revisionAdvice.trim().length >= 20 },
  { label: '6 项评分', ok: scoreErrors.value.length === 0 },
  { label: '评阅建议', ok: Boolean(form.recommendation) },
])
const completeCount = computed(() => checklist.value.filter((i) => i.ok).length)
const complete = computed(() => completeCount.value === checklist.value.length)

// 评语检查：提示与确认，不代写、不改原文。ACK 绑定检查时的内容。
const contentKey = computed(() => JSON.stringify(form))
const ackKey = ref<string | null>(null)
const ackValid = computed(() => ackKey.value === contentKey.value)
const findings = computed(() => {
  const list: { id: string; level: 'warn' | 'info'; field: string; text: string }[] = []
  if (/我校|本校|贵校/.test(form.overallComment + form.issues + form.revisionAdvice))
    list.push({ id: 'id', level: 'warn', field: '评语', text: '出现“我校/本校”等可能暴露评阅人单位的表述，请确认是否需要改写。' })
  list.push({ id: 'sim', level: 'info', field: '总体评价', text: '与你 2026-09-12 提交的另一份评语的总体评价第 1 句相似度较高。这是本人历史比对，不是跨专家查重。' })
  if (form.revisionAdvice.trim().length < 20) list.push({ id: 'adv', level: 'warn', field: '修改建议', text: '修改建议少于 20 字，学生可能无法据此修改。' })
  return list
})

const submitOpen = ref(false)
const submitting = ref(false)
function openSubmit() {
  if (!complete.value || !ackValid.value) {
    tab.value = 'check'
    mobilePane.value = 'form'
    return
  }
  submitOpen.value = true
}
async function doSubmit() {
  submitting.value = true
  const ok = await draft.flush()
  await new Promise((r) => setTimeout(r, 500))
  submitting.value = false
  if (!ok) return
  submitOpen.value = false
  draft.lock()
  submitted.value = true
}

const leaving = ref(false)
const leaveError = ref('')
async function saveAndExit() {
  leaving.value = true
  leaveError.value = ''
  const ok = await draft.flush()
  leaving.value = false
  if (ok) void router.push({ path: '/prototype', query: { left: 'review' } })
  else leaveError.value = draft.state.value === 'conflict' ? '内容冲突，未离开本页。请先处理冲突。' : '没有保存成功，已留在本页，你的输入还在。'
}
async function retry() {
  leaveError.value = ''
  await draft.flush()
}
function copyLocal() {
  void navigator.clipboard?.writeText(
    `总体评价\n${form.overallComment}\n\n主要优点\n${form.strengths}\n\n主要问题\n${form.issues}\n\n修改建议\n${form.revisionAdvice}`,
  )
  copied.value = true
}
const copied = ref(false)
function loadServer() {
  draft.acceptServer()
  Object.assign(form, structuredClone(draft.local.value))
  state.value = 'normal'
}

const correctionOpen = ref(false)
const correctionReason = ref('')
const correctionSent = ref(false)

// 更正稿：平台批准后编辑；手动保存，版本条件为更正申请 version（不是评阅 revision）
const isCorrection = (value: string) => value.startsWith('correction')
const correctionApproved = computed(() => isCorrection(state.value))
const correctionMode = (): FakeMode => (state.value === 'correction-fail' ? 'fail' : state.value === 'correction-conflict' ? 'conflict' : 'ok')
type CorrectionForm = { issues: string; revisionAdvice: string; note: string }
const correctionInitial = (): CorrectionForm => ({ issues: initial.issues, revisionAdvice: '补充日志稀疏场景下的偏差分析，并加入一种动态冗余基线。', note: '' })
const makeCorrection = () =>
  createDraftController<CorrectionForm, number>({
    initial: correctionInitial(),
    revision: 3,
    autosave: false,
    save: correctionDraftTransport<CorrectionForm>(correctionMode, (mine) => ({ ...mine, note: '平台在审批时补充：请同时核对第 2 项问题的表述。' })),
  })
const correction = shallowRef(makeCorrection())
const corrForm = reactive<CorrectionForm>(correctionInitial())
watch(corrForm, (value) => correction.value.update(value), { deep: true })
const corrSaving = ref(false)
const corrSubmitted = ref(false)
function resetCorrection() {
  correction.value.dispose()
  correction.value = makeCorrection()
  Object.assign(corrForm, correctionInitial())
  corrSubmitted.value = false
  corrCopied.value = false
}
async function saveCorrection() {
  corrSaving.value = true
  await correction.value.save()
  corrSaving.value = false
}
async function submitCorrection() {
  corrSaving.value = true
  const ok = await correction.value.save()
  corrSaving.value = false
  if (!ok) return
  correction.value.lock()
  corrSubmitted.value = true
}
function loadCorrectionServer() {
  correction.value.acceptServer()
  Object.assign(corrForm, structuredClone(correction.value.local.value))
}
function copyCorrection() {
  void navigator.clipboard?.writeText(`主要问题\n${corrForm.issues}\n\n修改建议\n${corrForm.revisionAdvice}\n\n更正说明\n${corrForm.note}`)
  corrCopied.value = true
}
const corrCopied = ref(false)

const pages = documentPages('anonymous')
const narrow = ref(false)
const mobilePane = ref<'doc' | 'form'>('form')
let media: MediaQueryList | null = null
const sync = () => (narrow.value = media?.matches ?? false)
onMounted(() => {
  media = window.matchMedia('(max-width: 899px)')
  sync()
  media.addEventListener('change', sync)
  if (state.value === 'submitted' || isCorrection(state.value)) {
    submitted.value = true
    draft.lock()
  }
  if (state.value === 'submit') submitOpen.value = true
})
onBeforeUnmount(() => media?.removeEventListener('change', sync))
const len = (s: string) => s.trim().length
</script>

<template>
  <ProtoFrame v-model:state="state" name="专家专注评阅" :states="states">
    <FocusShell :account="accounts.expert">
      <template #back>
        <button type="button" class="btn btn--quiet back" :disabled="leaving" @click="submitted ? router.push('/prototype') : saveAndExit()">‹ 我的任务</button>
      </template>
      <template #identity>
        <span class="code num">T-2026-0417</span>
        <h1 class="rv-title">面向边缘计算的容错任务调度方法研究</h1>
        <span class="due muted">截止 11 月 20 日，还有 16 天</span>
      </template>
      <template #status>
        <SaveStatus :state="submitted ? 'locked' : draft.state.value" :saved-at="draft.savedAt.value" />
      </template>

      <StateBlock v-if="state === 'cancelled'" kind="forbidden" title="这项任务已不在你的名下">
        任务可能已被平台改派或终止，本页不能再保存或提交。你在本页输入但尚未保存的内容仍可复制留存。
        <template #actions>
          <button type="button" class="btn" @click="copyLocal">{{ copied ? '已复制' : '复制本页内容' }}</button>
          <RouterLink class="btn btn--primary" to="/prototype">返回我的任务</RouterLink>
        </template>
      </StateBlock>

      <div v-else class="review" :class="{ 'review--narrow': narrow }">
        <nav v-if="narrow" class="mtabs" aria-label="评阅视图">
          <button type="button" :aria-pressed="mobilePane === 'doc'" @click="mobilePane = 'doc'">论文</button>
          <button type="button" :aria-pressed="mobilePane === 'form'" @click="mobilePane = 'form'">评阅 {{ completeCount }}/{{ checklist.length }}</button>
        </nav>
        <SplitPane class="review__split" :stacked="narrow" :initial="0.62" :min-start="380" :min-end="400">
          <template #start>
            <div v-show="!narrow || mobilePane === 'doc'" class="pane-doc">
              <MockDocument v-if="!submitted" :pages="pages" label="匿名稿" />
              <StateBlock v-else kind="empty" title="已提交，匿名稿不再提供阅读">按规则，正式提交后不再请求论文材料。你的正式意见在右侧可查看。</StateBlock>
            </div>
          </template>
          <template #end>
            <div v-show="!narrow || mobilePane === 'form'" class="pane-form">
              <div v-if="draft.state.value === 'conflict'" class="banner banner--danger" role="alert">
                <strong>这份草稿在另一个页签或设备上保存过更新的内容。</strong>
                <span>本页内容没有覆盖它，自动保存已暂停。下面列出两边不同的段落；先复制本页内容，再决定是否载入服务器版本。</span>
                <div v-for="c in conflictFields" :key="c.key" class="diff">
                  <p class="diff__label">{{ c.label }}</p>
                  <div class="diff__cols">
                    <div><span class="muted">本页</span><p class="pre">{{ c.mine || '（空）' }}</p></div>
                    <div><span class="muted">服务器</span><p class="pre">{{ c.server || '（空）' }}</p></div>
                  </div>
                </div>
                <span class="banner__actions">
                  <button type="button" class="btn btn--sm" @click="copyLocal">{{ copied ? '已复制' : '复制本页内容' }}</button>
                  <button type="button" class="btn btn--sm" :disabled="!copied" @click="loadServer">载入服务器版本</button>
                </span>
                <ProtoNote contract="C-SAVE">
                  普通评阅草稿按整数 revision 条件保存，冲突返回服务器副本（BUG-02，开发报告已修复，未合入本工作树）。
                  是否提供“以本页内容重新保存”以修复快照的接口为准，原型不自行加这一步。
                </ProtoNote>
              </div>
              <div v-else-if="draft.state.value === 'failed' || leaveError" class="banner banner--danger" role="alert">
                <strong>{{ leaveError || '保存失败，你的输入仍在本页。' }}</strong>
                <span class="banner__actions"><button type="button" class="btn btn--sm" @click="retry">重新保存</button></span>
              </div>

              <template v-if="!submitted">
                <div class="tabs" role="tablist" aria-label="评阅内容">
                  <button type="button" role="tab" :aria-selected="tab === 'comments'" @click="tab = 'comments'">评语</button>
                  <button type="button" role="tab" :aria-selected="tab === 'scores'" @click="tab = 'scores'">评分 <span class="num muted">{{ total }}</span></button>
                  <button type="button" role="tab" :aria-selected="tab === 'check'" @click="tab = 'check'">提交检查 <span class="num muted">{{ completeCount }}/{{ checklist.length }}</span></button>
                </div>

                <div class="form-scroll">
                  <section v-show="tab === 'comments'" class="fields">
                    <p class="hint muted">以下意见经学校发布后，学生与导师可以看到；请勿写入可识别你身份的信息。</p>
                    <label class="field">
                      <span>总体评价 <small class="num">{{ len(form.overallComment) }} 字</small></span>
                      <textarea v-model="form.overallComment" class="textarea t-lg" />
                    </label>
                    <label class="field">
                      <span>主要优点 <small class="num">{{ len(form.strengths) }} 字</small></span>
                      <textarea v-model="form.strengths" class="textarea" />
                      <small>这一项不进入学生和导师看到的正式反馈。</small>
                    </label>
                    <label class="field">
                      <span>主要问题 <small class="num">{{ len(form.issues) }} 字</small></span>
                      <textarea v-model="form.issues" class="textarea t-lg" />
                    </label>
                    <label class="field">
                      <span>修改建议 <small class="num">{{ len(form.revisionAdvice) }} 字</small></span>
                      <textarea v-model="form.revisionAdvice" class="textarea t-lg" placeholder="写给学生的具体修改方向" />
                    </label>
                    <ProtoNote contract="C-RESULT">
                      修复后的发布快照 v2 收录“修改建议”（BUG-04，开发报告已修复，未合入本工作树）；“主要优点”与分项评价不发布给学生和导师。
                    </ProtoNote>
                    <label class="field">
                      <span>评阅建议</span>
                      <select v-model="form.recommendation" class="select">
                        <option value="">请选择</option>
                        <option>建议通过</option>
                        <option>建议修改</option>
                        <option>不通过</option>
                      </select>
                      <small>这是你的建议，与评分按规则算出的结论分开记录，系统不会替你改写。</small>
                    </label>
                  </section>

                  <section v-show="tab === 'scores'" class="fields">
                    <p class="hint muted">评分项与满分来自本任务的规则快照（{{ reviewRule.version }}）。</p>
                    <table class="scores">
                      <tbody>
                        <tr v-for="d in reviewRule.dimensions" :key="d.key">
                          <th scope="row"><label :for="`s-${d.key}`">{{ d.label }}</label></th>
                          <td>
                            <input :id="`s-${d.key}`" v-model.number="form.scores[d.key]" class="input num" type="number" min="0" :max="d.max_score" step="1" :aria-invalid="scoreErrors.includes(d.key)" />
                          </td>
                          <td class="muted num">/ {{ d.max_score }}</td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr><th scope="row">合计</th><td class="num total">{{ total }}</td><td class="muted num">/ 100</td></tr>
                      </tfoot>
                    </table>
                    <div class="bands">
                      <p>按规则，{{ total }} 分对应 <strong>{{ band?.label }}</strong>（{{ band?.min }}–{{ band?.max }} 分）。</p>
                      <p class="muted">你的评阅建议：{{ form.recommendation || '尚未选择' }}。两者不一致时，以各自字段分别记录。</p>
                    </div>
                    <ProtoNote contract="UX-01">分数留空仍未决：原型不提供“暂不评分”，不发送 null；0 是合法分数，不视为缺项。六项均为 0 到满分的整数。</ProtoNote>
                  </section>

                  <section v-show="tab === 'check'" class="fields">
                    <h2 class="sec">完成情况</h2>
                    <ul class="checks">
                      <li v-for="item in checklist" :key="item.label" :class="{ ok: item.ok }">
                        <span aria-hidden="true">{{ item.ok ? '✓' : '○' }}</span>{{ item.label }}<span class="sr-only">{{ item.ok ? '已完成' : '未完成' }}</span>
                      </li>
                    </ul>
                    <h2 class="sec">评语检查</h2>
                    <ul class="findings">
                      <li v-for="f in findings" :key="f.id">
                        <StatusPill :tone="f.level === 'warn' ? 'warning' : 'neutral'">{{ f.field }}</StatusPill>
                        <span>{{ f.text }}</span>
                      </li>
                    </ul>
                    <label class="ack">
                      <input type="checkbox" :checked="ackValid" @change="ackKey = ($event.target as HTMLInputElement).checked ? contentKey : null" />
                      <span>我已查看以上提示，这是我本次独立撰写的意见</span>
                    </label>
                    <p v-if="ackKey && !ackValid" class="field-error">内容在确认后有改动，请重新确认。</p>
                  </section>
                </div>

                <footer class="form-foot">
                  <span class="muted foot-state">{{ complete ? '内容已完整' : `还差 ${checklist.length - completeCount} 项` }}</span>
                  <button type="button" class="btn" :disabled="leaving" @click="saveAndExit">{{ leaving ? '正在保存…' : '保存并退出' }}</button>
                  <button type="button" class="btn btn--primary" @click="openSubmit">检查并提交</button>
                </footer>
              </template>

              <section v-else class="final">
                <div class="final__head">
                  <StatusPill tone="success">已正式提交</StatusPill>
                  <span class="muted">11-04 15:20 提交，内容已锁定</span>
                </div>
                <dl class="final__body">
                  <dt>总分</dt><dd class="num">{{ total }} / 100（规则结论：{{ band?.label }}）</dd>
                  <dt>评阅建议</dt><dd>{{ form.recommendation }}</dd>
                  <dt>总体评价</dt><dd>{{ form.overallComment }}</dd>
                  <dt>主要问题</dt><dd class="pre">{{ form.issues }}</dd>
                  <dt>修改建议</dt><dd class="pre">{{ form.revisionAdvice || '（未填写）' }}</dd>
                </dl>

                <div v-if="correctionApproved" class="final__corr">
                  <div class="corr__head">
                    <h2 class="sec">更正稿</h2>
                    <SaveStatus :state="correction.state.value" :saved-at="correction.savedAt.value" manual />
                  </div>
                  <template v-if="corrSubmitted">
                    <p role="status"><StatusPill tone="action">待学校确认</StatusPill> 更正已提交。学校确认后会生成新的发布版本；确认前学生看到的仍是原发布版本。</p>
                  </template>
                  <template v-else>
                    <p class="muted">平台已批准更正。更正稿不会自动保存，请在离开前点“保存更正稿”。</p>
                    <div v-if="correction.state.value === 'conflict'" class="banner banner--danger" role="alert">
                      <strong>更正申请在你打开后有更新，本次保存没有生效。</strong>
                      <span>你的输入仍在下方。先复制本页内容，再载入最新的更正稿。</span>
                      <span class="banner__actions">
                        <button type="button" class="btn btn--sm" @click="copyCorrection">{{ corrCopied ? '已复制' : '复制本页内容' }}</button>
                        <button type="button" class="btn btn--sm" :disabled="!corrCopied" @click="loadCorrectionServer">载入最新更正稿</button>
                      </span>
                    </div>
                    <div v-else-if="correction.state.value === 'failed'" class="banner banner--danger" role="alert">
                      <strong>更正稿没有保存成功，你的输入仍在本页。</strong>
                      <span>不会自动重试，可以稍后再点“保存更正稿”。</span>
                    </div>
                    <label class="field"><span>主要问题（更正后）</span><textarea v-model="corrForm.issues" class="textarea t-lg" :disabled="correction.state.value === 'conflict'" /></label>
                    <label class="field"><span>修改建议（更正后）</span><textarea v-model="corrForm.revisionAdvice" class="textarea" :disabled="correction.state.value === 'conflict'" /></label>
                    <label class="field"><span>更正说明（平台与学校可见）</span><textarea v-model="corrForm.note" class="textarea" :disabled="correction.state.value === 'conflict'" placeholder="说明改了什么、为什么" /></label>
                    <div class="row-actions">
                      <button type="button" class="btn" :disabled="corrSaving || correction.state.value === 'conflict'" @click="saveCorrection">{{ corrSaving ? '正在保存…' : '保存更正稿' }}</button>
                      <button type="button" class="btn btn--primary" :disabled="corrSaving || correction.state.value === 'conflict' || corrForm.note.trim().length < 6" @click="submitCorrection">提交更正</button>
                    </div>
                    <ProtoNote contract="C-SAVE">
                      更正稿按更正申请 version 条件手动保存，失败保留输入（BUG-09，开发报告已修复，未合入本工作树）。原型不做假自动保存。
                    </ProtoNote>
                  </template>
                </div>

                <div v-else class="final__corr">
                  <h2 class="sec">发现正式意见有误？</h2>
                  <p class="muted">更正需要先申请，平台批准后你再提交更正内容，最后由学校确认。学校确认前，学生看到的仍是当前版本。</p>
                  <template v-if="!correctionOpen && !correctionSent">
                    <button type="button" class="btn" @click="correctionOpen = true">申请更正</button>
                  </template>
                  <template v-else-if="correctionOpen">
                    <label class="field"><span>更正原因（平台可见）</span><textarea v-model="correctionReason" class="textarea" placeholder="说明需要更正哪一项、为什么" /></label>
                    <div class="row-actions">
                      <button type="button" class="btn" @click="correctionOpen = false">取消</button>
                      <button type="button" class="btn btn--primary" :disabled="correctionReason.trim().length < 6" @click="correctionOpen = false; correctionSent = true">提交更正申请</button>
                    </div>
                  </template>
                  <p v-else role="status"><StatusPill tone="action">已申请</StatusPill> 等待平台审批，批准后这里会出现更正编辑区。</p>
                </div>
              </section>
            </div>
          </template>
        </SplitPane>
      </div>
    </FocusShell>

    <ConfirmDialog :open="submitOpen" title="提交正式评阅意见？" wide @close="submitOpen = false; state === 'submit' && (state = 'normal')">
      <p>提交后以下内容会锁定，不能再修改；如需更正需要走更正申请。提交后不再提供匿名稿阅读。</p>
      <dl class="freeze">
        <dt>总分</dt><dd class="num">{{ total }} / 100，规则结论 {{ band?.label }}</dd>
        <dt>评阅建议</dt><dd>{{ form.recommendation || '未选择' }}</dd>
        <dt>评语</dt><dd class="num">总体评价 {{ len(form.overallComment) }} 字，主要问题 {{ len(form.issues) }} 字，修改建议 {{ len(form.revisionAdvice) }} 字</dd>
      </dl>
      <p v-if="!complete" class="field-error">还有未完成的项目，不能提交。</p>
      <template #actions>
        <button type="button" class="btn" @click="submitOpen = false">继续修改</button>
        <button type="button" class="btn btn--primary" :disabled="!complete || submitting" @click="doSubmit">{{ submitting ? '正在保存并提交…' : '确认提交' }}</button>
      </template>
    </ConfirmDialog>
  </ProtoFrame>
</template>

<style scoped>
.back {
  min-height: 32px;
  padding: 0 8px;
  color: var(--ws-action);
}
.code {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--ws-sunken);
  color: var(--ws-muted);
  font-size: 12px;
}
.rv-title {
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.due {
  flex: none;
  font-size: 13px;
}
.review {
  height: 100%;
}
.review--narrow {
  display: flex;
  flex-direction: column;
}
.review__split {
  height: 100%;
  min-height: 0;
}
.review--narrow .review__split {
  flex: 1;
  overflow: hidden;
}
.pane-doc,
.pane-form {
  height: 100%;
}
.pane-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ws-surface);
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ws-border);
}
.tabs button {
  min-height: 44px;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ws-muted);
  cursor: pointer;
}
.tabs button[aria-selected='true'] {
  border-bottom-color: var(--ws-action);
  color: var(--ws-text);
  font-weight: 600;
}
.form-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.fields {
  display: grid;
  gap: 16px;
  padding: 16px;
}
.field > span {
  display: flex;
  justify-content: space-between;
}
.field > span small {
  color: var(--ws-faint);
  font-weight: 400;
}
.t-lg {
  min-height: 132px;
}
.textarea {
  line-height: 1.7;
}
.hint {
  font-size: 12px;
}
.scores {
  width: 100%;
  border-collapse: collapse;
}
.scores th {
  padding: 8px 0;
  font-weight: 400;
  text-align: left;
}
.scores td {
  padding: 6px 0 6px 12px;
  white-space: nowrap;
}
.scores td .input {
  width: 72px;
  text-align: right;
}
.scores tfoot th,
.scores tfoot td {
  padding-top: 10px;
  border-top: 1px solid var(--ws-border);
  font-weight: 600;
}
.total {
  padding-right: 12px !important;
  text-align: right;
}
.bands {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  font-size: 13px;
}
.sec {
  font-size: 14px;
  font-weight: 600;
}
.checks,
.findings {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.checks li {
  display: flex;
  gap: 8px;
  color: var(--ws-muted);
}
.checks li.ok {
  color: var(--ws-text);
}
.checks li.ok span:first-child {
  color: var(--ws-success);
}
.findings li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  align-items: start;
}
.ack {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13px;
}
.ack input {
  margin-top: 3px;
}
.form-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.foot-state {
  flex: 1;
  font-size: 13px;
}
.banner {
  display: grid;
  gap: 6px;
  margin: 12px 12px 0;
  padding: 10px 12px;
  border-left: 3px solid var(--ws-danger);
  border-radius: 0 var(--ws-radius) var(--ws-radius) 0;
  background: var(--ws-danger-soft);
  font-size: 13px;
}
.banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.final {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
}
.final__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.final__body {
  display: grid;
  gap: 4px;
  margin: 0;
}
.final__body dt {
  margin-top: 8px;
  color: var(--ws-muted);
  font-size: 12px;
}
.final__body dd {
  margin: 0;
  line-height: 1.7;
}
.pre {
  white-space: pre-line;
}
.final__corr {
  display: grid;
  gap: 8px;
  justify-items: start;
  padding-top: 16px;
  border-top: 1px solid var(--ws-border);
  font-size: 13px;
}
.corr__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
}
.diff {
  display: grid;
  gap: 4px;
  margin-top: 6px;
}
.diff__label {
  font-weight: 600;
}
.diff__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.diff__cols > div {
  padding: 6px 8px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius);
  background: var(--ws-surface);
  color: var(--ws-text);
  font-size: 13px;
}
.final__corr .field {
  width: 100%;
}
.row-actions {
  display: flex;
  gap: 8px;
}
.freeze {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 6px 12px;
  margin: 0;
  padding: 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  font-size: 13px;
}
.freeze dt {
  color: var(--ws-muted);
}
.freeze dd {
  margin: 0;
}
.mtabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.mtabs button {
  min-height: 44px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ws-muted);
}
.mtabs button[aria-pressed='true'] {
  border-bottom-color: var(--ws-action);
  color: var(--ws-text);
  font-weight: 600;
}
@media (max-width: 899px) {
  .rv-title,
  .due {
    display: none;
  }
  .form-foot {
    flex-wrap: wrap;
  }
  .foot-state {
    flex-basis: 100%;
  }
  .form-foot .btn {
    flex: 1;
  }
}
@media (max-width: 640px) {
  .diff__cols {
    grid-template-columns: 1fr;
  }
}
</style>
