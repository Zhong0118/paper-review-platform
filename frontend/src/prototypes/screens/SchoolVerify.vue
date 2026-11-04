<script setup lang="ts">
/**
 * P05 学校核验台（专注工作空间）。材料 / 发现目录｜PDF 主区｜判断区，底部判断栏。
 * 检测维度分开（v2.1 C-CHECK）：auto_conclusion PASS | REVIEW_REQUIRED | FAIL | null、单项严重程度 WARN / BLOCK、
 * 报告时效 stale、人工结论各自独立；无法提取文字的页来自 source_metadata.uncertain_pages。
 * 规则：自动 PASS 仍需人工确认；有 WARN 项或需人工复核时通过必须写说明；有 BLOCK 项、自动不通过或报告过期时不可放行。
 * 通过核验 ≠ 确认送出；只有“服务器确认”后才出现“下一篇”。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import FocusShell from '../kit/FocusShell.vue'
import MockDocument from '../kit/MockDocument.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import { accounts, documentPages, schoolRows, verifyFindings, type Finding } from '../data/fixtures'

const states = [
  { value: 'warn', label: '自动：需人工复核（含警告项）' },
  { value: 'pass', label: '自动：未发现线索' },
  { value: 'fail', label: '自动：不通过（含阻断项）' },
  { value: 'stale', label: '上次自动通过，报告已过期' },
  { value: 'taken', label: '已被他人处理' },
  { value: 'conflict', label: '提交时版本冲突' },
  { value: 'terminate', label: '永久终止确认' },
] as const
const state = useProtoState(states, 'warn')
const route = useRoute()
const router = useRouter()

const queue = schoolRows.filter((row) => row.view === 'verify')
const done = ref<Set<string>>(new Set())
const thesis = computed(() => queue.find((row) => row.id === route.query.thesis) ?? queue[0]!)
const position = computed(() => queue.findIndex((row) => row.id === thesis.value.id) + 1)
const nextRow = computed(() => queue.slice(position.value).find((row) => !done.value.has(row.id)) ?? null)
const prevRow = computed(() => [...queue.slice(0, position.value - 1)].reverse().find((row) => !done.value.has(row.id)) ?? null)

const findings = computed<Finding[]>(() => {
  if (state.value === 'pass' || state.value === 'stale') return []
  if (state.value === 'fail') return verifyFindings.fail!
  return verifyFindings.warn!
})
type AutoConclusion = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL' | null
/** 服务端 auto_conclusion 原样展示；过期报告保留“上次自动结论”，不改写成别的枚举 */
const autoConclusion = computed<AutoConclusion>(() =>
  state.value === 'fail' ? 'FAIL' : state.value === 'pass' || state.value === 'stale' ? 'PASS' : 'REVIEW_REQUIRED',
)
const stale = computed(() => state.value === 'stale')
/** source_metadata.uncertain_pages：扫描页无法提取文字，需人工查看；不是一种严重程度 */
const uncertainPages = computed(() => (state.value === 'pass' || state.value === 'stale' ? [] : [9]))
const blockCount = computed(() => findings.value.filter((f) => f.severity === 'BLOCK').length)
const warnCount = computed(() => findings.value.filter((f) => f.severity === 'WARN').length)
const taken = computed(() => state.value === 'taken')
const groups = computed(() =>
  (
    [
      { key: 'BLOCK', label: '阻断', tone: 'danger' },
      { key: 'WARN', label: '警告', tone: 'warning' },
    ] as const
  )
    .map((group) => ({ ...group, items: findings.value.filter((f) => f.severity === group.key) }))
    .filter((group) => group.items.length),
)

const material = ref<'anonymous' | 'original'>('anonymous')
const compare = ref(false)
const focusPage = ref<number | null>(null)
const viewed = ref<Set<string>>(new Set())
const openFinding = ref<string | null>(null)
function locate(finding: Finding) {
  material.value = 'anonymous'
  focusPage.value = null
  requestAnimationFrame(() => (focusPage.value = finding.page))
  viewed.value = new Set([...viewed.value, finding.id])
  openFinding.value = openFinding.value === finding.id ? null : finding.id
  mobileTab.value = 'doc'
  if (mid.value) showFindingsCol.value = false
}
const anonymousPages = documentPages('anonymous')
const originalPages = documentPages('original')

const decision = ref<'pass' | 'return'>('pass')
const passNote = ref('')
const passAck = ref(false)
const returnReason = ref('')
const touched = ref(false)
const submitting = ref(false)
const outcome = ref<null | 'passed' | 'returned'>(null)
const serverError = ref<null | 'conflict'>(null)

const passBlocked = computed(() => {
  if (taken.value) return '这篇论文已由他人处理'
  if (stale.value) return '检测报告已过期，不能依据它通过核验'
  if (autoConclusion.value === 'FAIL' || blockCount.value) return '存在阻断项，不能通过核验'
  return ''
})
watch(passBlocked, (reason) => {
  if (reason && decision.value === 'pass' && !taken.value) decision.value = 'return'
}, { immediate: true })

const passNeedsNote = computed(() => autoConclusion.value === 'REVIEW_REQUIRED' || warnCount.value > 0 || uncertainPages.value.length > 0)
const passError = computed(() => {
  if (passNeedsNote.value && passNote.value.trim().length < 8) return '请说明你核对了哪些发现项、为何不构成身份泄露（至少 8 个字）'
  if (!passNeedsNote.value && !passAck.value) return '请确认你已人工查看匿名稿'
  return ''
})
const returnError = computed(() => (returnReason.value.trim().length < 6 ? '请写明需要学生修改的内容（至少 6 个字）' : ''))
const currentError = computed(() => (decision.value === 'pass' ? passError.value : returnError.value))

function quote(finding: Finding) {
  const line = `第 ${finding.page} 页${finding.source}出现“${finding.matched}”`
  returnReason.value = returnReason.value ? `${returnReason.value}；${line}` : line
}

async function submit() {
  touched.value = true
  if (currentError.value || submitting.value || taken.value) return
  if (decision.value === 'pass' && passBlocked.value) return
  submitting.value = true
  serverError.value = null
  await new Promise((resolve) => setTimeout(resolve, 700))
  submitting.value = false
  if (state.value === 'conflict') {
    serverError.value = 'conflict'
    return
  }
  outcome.value = decision.value === 'pass' ? 'passed' : 'returned'
  done.value = new Set([...done.value, thesis.value.id])
}
function reloadLatest() {
  serverError.value = null
  state.value = 'warn'
}
function goTo(id: string) {
  outcome.value = null
  touched.value = false
  passNote.value = ''
  passAck.value = false
  returnReason.value = ''
  viewed.value = new Set()
  void router.replace({ query: { ...route.query, thesis: id } })
}

const terminateOpen = ref(false)
const terminateReason = ref('')
const terminateAck = ref(false)
const moreOpen = ref(false)
watch(state, (value) => {
  terminateOpen.value = value === 'terminate'
  // 原型切换状态时清掉上一次的结果，不把旧结果带到新场景
  outcome.value = null
  serverError.value = null
  touched.value = false
}, { immediate: true })

const mobileTab = ref<'findings' | 'doc' | 'decide'>('doc')
const narrow = ref(false)
const mid = ref(false)
const showFindingsCol = ref(true)
let media: MediaQueryList | null = null
let midMedia: MediaQueryList | null = null
const sync = () => {
  narrow.value = media?.matches ?? false
  const wasMid = mid.value
  mid.value = !narrow.value && (midMedia?.matches ?? false)
  // 中屏默认收起发现目录，保证 PDF 与判断区可读；需要时以浮层打开
  if (mid.value !== wasMid) showFindingsCol.value = !mid.value
}
onMounted(() => {
  media = window.matchMedia('(max-width: 859px)')
  midMedia = window.matchMedia('(max-width: 1279px)')
  sync()
  media.addEventListener('change', sync)
  midMedia.addEventListener('change', sync)
})
onBeforeUnmount(() => {
  media?.removeEventListener('change', sync)
  midMedia?.removeEventListener('change', sync)
})
</script>

<template>
  <ProtoFrame v-model:state="state" name="学校核验台" :states="states">
    <FocusShell :account="accounts.school">
      <template #back>
        <RouterLink class="btn btn--quiet back" :to="{ path: '/prototype/school', query: { view: 'verify' } }">‹ 返回队列</RouterLink>
      </template>
      <template #identity>
        <h1 class="vt-title" :title="thesis.title">{{ thesis.title }}</h1>
        <span class="vt-meta muted">{{ thesis.student }}　{{ thesis.program }}</span>
      </template>
      <template #status>
        <span class="vt-pos muted num">待核验 {{ position }} / {{ queue.length }}</span>
        <button type="button" class="btn btn--sm vt-prev" :disabled="!prevRow" @click="prevRow && goTo(prevRow.id)">上一篇</button>
        <button type="button" class="btn btn--sm" :disabled="!nextRow" @click="nextRow && goTo(nextRow.id)">下一篇</button>
      </template>

      <div class="verify">
        <nav v-if="narrow" class="mtabs" aria-label="核验视图">
          <button type="button" :aria-pressed="mobileTab === 'findings'" @click="mobileTab = 'findings'">发现 {{ findings.length }}</button>
          <button type="button" :aria-pressed="mobileTab === 'doc'" @click="mobileTab = 'doc'">材料</button>
          <button type="button" :aria-pressed="mobileTab === 'decide'" @click="mobileTab = 'decide'">判断</button>
        </nav>

        <div class="verify__grid" :class="{ 'verify__grid--nofind': !showFindingsCol || compare || mid, 'verify__grid--narrow': narrow, 'verify__grid--mid': mid }">
          <!-- 发现目录 -->
          <aside v-show="narrow ? mobileTab === 'findings' : showFindingsCol && !compare" class="col col--find" :class="{ 'col--overlay': mid }" aria-label="检测发现">
            <div class="find__head">
              <h2>检测发现 <span class="num muted">{{ findings.length }}</span></h2>
              <button v-if="!narrow" type="button" class="btn btn--sm btn--quiet" @click="showFindingsCol = false">收起</button>
            </div>
            <p v-if="!findings.length" class="find__empty">
              检测器没有发现身份线索。这不代表匿名化一定完整，请在右侧材料中人工通读封面、致谢、附录和页眉页脚。
            </p>
            <section v-for="group in groups" :key="group.key" class="find__group">
              <h3><StatusPill :tone="group.tone">{{ group.label }} {{ group.items.length }}</StatusPill></h3>
              <ul>
                <li v-for="f in group.items" :key="f.id">
                  <button type="button" class="finding" :class="{ 'finding--open': openFinding === f.id }" :aria-expanded="openFinding === f.id" @click="locate(f)">
                    <span class="finding__top">
                      <span class="num">第 {{ f.page }} 页</span>
                      <span class="muted">{{ f.kind }}</span>
                      <span v-if="viewed.has(f.id)" class="finding__seen">已查看</span>
                    </span>
                    <span class="finding__match">“{{ f.matched }}”</span>
                  </button>
                  <div v-if="openFinding === f.id" class="finding__detail">
                    <p>{{ f.context }}</p>
                    <p class="muted">来源：{{ f.source }}</p>
                    <button type="button" class="btn btn--sm" :disabled="taken" @click="decision = 'return'; quote(f)">写入退回原因</button>
                  </div>
                </li>
              </ul>
            </section>
          </aside>

          <!-- 材料 -->
          <section v-show="!narrow || mobileTab === 'doc'" class="col col--doc" aria-label="论文材料">
            <div class="doc-switch">
              <button v-if="!showFindingsCol && !compare && !narrow" type="button" class="btn btn--sm" @click="showFindingsCol = true">发现 {{ findings.length }}</button>
              <div class="seg" role="group" aria-label="材料">
                <button type="button" :aria-pressed="material === 'anonymous' && !compare" @click="material = 'anonymous'; compare = false">匿名稿</button>
                <button type="button" :aria-pressed="material === 'original' && !compare" @click="material = 'original'; compare = false">原稿</button>
                <button v-if="!narrow" type="button" :aria-pressed="compare" @click="compare = !compare">并排对照</button>
              </div>
              <p class="visibility">
                <template v-if="compare">左：原稿（仅本校可见）｜右：匿名稿（将交给专家）</template>
                <template v-else-if="material === 'anonymous'">你正在看匿名稿，这份材料将交给评阅专家</template>
                <template v-else>你正在看原稿，仅本校可见，不会交给专家</template>
              </p>
            </div>
            <div class="doc-area" :class="{ 'doc-area--compare': compare }">
              <MockDocument v-if="compare || material === 'original'" :pages="originalPages" label="原稿" />
              <MockDocument
                v-if="compare || material === 'anonymous'"
                :pages="anonymousPages"
                label="匿名稿"
                :highlight-pages="findings.map((f) => f.page)"
                :focus-page="focusPage"
              />
            </div>
          </section>

          <!-- 判断 -->
          <aside v-show="!narrow || mobileTab === 'decide'" class="col col--decide" aria-label="核验判断">
            <div class="decide">
              <div v-if="taken" class="banner banner--info" role="status">
                <strong>这篇论文已由刘思远于 10:41 处理为“可送出”。</strong>
                <span>你没有提交任何操作。下方输入保留在本页，可以复制后离开。</span>
              </div>
              <div v-if="serverError === 'conflict'" class="banner banner--danger" role="alert">
                <strong>提交没有生效：论文在你打开后已更新。</strong>
                <span>学生撤回后重新提交了新的材料。你的说明仍在下方，请载入最新材料重新核对。</span>
                <button type="button" class="btn btn--sm" @click="reloadLatest">载入最新材料（保留说明）</button>
              </div>

              <section class="basis" aria-label="当前报告依据">
                <h2>当前报告依据</h2>
                <dl>
                  <dt>{{ stale ? '上次自动结论' : '自动结论' }}</dt>
                  <dd>
                    <StatusPill v-if="autoConclusion === 'FAIL'" :tone="stale ? 'neutral' : 'danger'">不通过</StatusPill>
                    <StatusPill v-else-if="autoConclusion === 'REVIEW_REQUIRED'" :tone="stale ? 'neutral' : 'warning'">需人工复核</StatusPill>
                    <StatusPill v-else-if="autoConclusion === 'PASS'" tone="neutral">未发现线索</StatusPill>
                    <span v-else class="muted">尚未检测</span>
                  </dd>
                  <dt>报告时效</dt>
                  <dd>
                    <StatusPill v-if="stale" tone="warning">已过期</StatusPill>
                    <span v-else>对应当前匿名稿</span>
                  </dd>
                  <dt>单项发现</dt>
                  <dd>
                    <template v-if="stale">以过期报告为准，不展示</template>
                    <template v-else-if="findings.length">阻断 {{ blockCount }}，警告 {{ warnCount }}</template>
                    <template v-else>无</template>
                  </dd>
                  <dt>人工结论</dt><dd>尚未作出</dd>
                  <dt>检测对象</dt><dd>当前匿名稿，共 12 页</dd>
                  <dt>检测时间</dt><dd class="num">11-04 09:10</dd>
                  <dt>依据</dt><dd>本校检测词表第 12 版</dd>
                </dl>
                <div v-if="stale" class="basis__stale">
                  <p>上次自动检测未发现线索，但学生在检测之后更新了匿名稿，这份报告不再对应当前材料，不能作为通过依据。</p>
                  <p class="muted">可以退回修改；是否在此重新检测，以服务端给出的可用操作为准。</p>
                </div>
                <p v-if="uncertainPages.length" class="basis__note">
                  第 {{ uncertainPages.join('、') }} 页是扫描图片，检测器无法提取文字，请人工查看该页。
                </p>
              </section>

              <fieldset class="choice" :disabled="taken">
                <legend>你的判断</legend>
                <label class="choice__opt" :class="{ 'choice__opt--off': passBlocked }">
                  <input v-model="decision" type="radio" value="pass" :disabled="Boolean(passBlocked)" />
                  <span>
                    <strong>通过核验</strong>
                    <small v-if="passBlocked">{{ passBlocked }}</small>
                    <small v-else>匿名稿可以交给专家；之后仍需在队列中确认送出</small>
                  </span>
                </label>
                <label class="choice__opt">
                  <input v-model="decision" type="radio" value="return" />
                  <span>
                    <strong>退回修改</strong>
                    <small>学生收到原因后修改，论文回到草稿</small>
                  </span>
                </label>
              </fieldset>

              <label v-if="decision === 'pass' && passNeedsNote" class="field">
                <span>通过说明（校内留存，学生不可见）</span>
                <textarea v-model="passNote" class="textarea" :disabled="taken" :aria-invalid="touched && Boolean(passError)" aria-describedby="pass-err" placeholder="例如：第 3 页“周老师”为致谢中的泛称，未出现全名；第 7 页校区名称已与学生确认替换。" />
                <span v-if="touched && passError" id="pass-err" class="field-error">{{ passError }}</span>
              </label>
              <label v-else-if="decision === 'pass'" class="ack">
                <input v-model="passAck" type="checkbox" :disabled="taken" />
                <span>我已人工查看匿名稿的封面、致谢、附录和页眉页脚，未发现身份线索</span>
              </label>
              <span v-if="decision === 'pass' && !passNeedsNote && touched && passError" class="field-error">{{ passError }}</span>

              <label v-if="decision === 'return'" class="field">
                <span>退回原因（学生会看到）</span>
                <textarea v-model="returnReason" class="textarea" :disabled="taken" :aria-invalid="touched && Boolean(returnError)" aria-describedby="ret-err" placeholder="写明需要学生修改的位置与内容" />
                <small>可在左侧发现项中点“写入退回原因”引用页码。</small>
                <span v-if="touched && returnError" id="ret-err" class="field-error">{{ returnError }}</span>
              </label>
              <ProtoNote contract="C-CHECK">
                自动结论、单项严重程度、报告时效、人工结论按修复后合同分字段展示（开发报告已修复，未合入本工作树，U2 联调核对）。
                过期报告的冻结点属 RISK-01，仍未决：原型不加前端门禁、不做假重检或强制通过。
              </ProtoNote>
            </div>
          </aside>
        </div>

        <!-- 底部判断栏 -->
        <footer class="decide-bar">
          <div v-if="outcome" class="decide-bar__done" role="status">
            <StatusPill tone="success">{{ outcome === 'passed' ? '已通过核验' : '已退回修改' }}</StatusPill>
            <span>{{ outcome === 'passed' ? '论文进入“可送出”，确认送出需在队列中单独操作。' : '学生会看到退回原因。' }}</span>
          </div>
          <p v-else class="decide-bar__state muted">
            待核验<template v-if="findings.length">，已查看 {{ viewed.size }} / {{ findings.length }} 个发现项</template>
          </p>
          <div class="decide-bar__actions">
            <template v-if="outcome">
              <RouterLink class="btn" :to="{ path: '/prototype/school', query: { view: 'verify' } }">返回队列</RouterLink>
              <button v-if="nextRow" type="button" class="btn btn--primary" @click="goTo(nextRow.id)">下一篇</button>
            </template>
            <template v-else>
              <div class="more">
                <button type="button" class="btn" :aria-expanded="moreOpen" aria-haspopup="menu" :disabled="taken" @click="moreOpen = !moreOpen">更多操作</button>
                <div v-if="moreOpen" class="more__menu" role="menu">
                  <button type="button" role="menuitem" @click="moreOpen = false; terminateOpen = true">永久终止这篇论文…</button>
                </div>
              </div>
              <button type="button" class="btn btn--primary" :disabled="submitting || taken || (decision === 'pass' && Boolean(passBlocked))" @click="submit">
                {{ submitting ? '正在提交…' : decision === 'pass' ? '通过核验' : '退回修改' }}
              </button>
            </template>
          </div>
        </footer>
      </div>
    </FocusShell>

    <ConfirmDialog :open="terminateOpen" title="永久终止这篇论文？" @close="terminateOpen = false; state === 'terminate' && (state = 'warn')">
      <p>终止后这篇论文不再进入送审，学生也不能在这条记录上继续修改或重新提交。已有材料与处理记录会保留，不会删除。</p>
      <p><strong>终止不能在界面中撤销。</strong>如果只是材料需要修改，请改用“退回修改”。</p>
      <label class="field">
        <span>终止原因（必填，学生会看到）</span>
        <textarea v-model="terminateReason" class="textarea" />
      </label>
      <label class="ack"><input v-model="terminateAck" type="checkbox" /> <span>我了解终止后无法恢复</span></label>
      <template #actions>
        <button type="button" class="btn" @click="terminateOpen = false">取消</button>
        <button type="button" class="btn btn--danger" :disabled="terminateReason.trim().length < 4 || !terminateAck">永久终止</button>
      </template>
    </ConfirmDialog>
  </ProtoFrame>
</template>

<style scoped>
.back {
  min-height: 32px;
  padding: 0 8px;
  color: var(--ws-action);
  text-decoration: none;
}
.vt-title {
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vt-meta {
  flex: none;
  font-size: 13px;
}
.vt-pos {
  font-size: 13px;
}
.verify {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.verify__grid {
  display: grid;
  flex: 1;
  grid-template-columns: 264px minmax(0, 1fr) 360px;
  min-height: 0;
}
.verify__grid--nofind {
  grid-template-columns: minmax(0, 1fr) 360px;
}
.verify__grid--narrow {
  grid-template-columns: minmax(0, 1fr);
}
.col {
  min-height: 0;
  overflow-y: auto;
  background: var(--ws-surface);
}
.col--find {
  border-right: 1px solid var(--ws-border);
}
.col--doc {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}
.col--decide {
  border-left: 1px solid var(--ws-border);
}
.find__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 4px 16px;
}
.find__head h2 {
  font-size: 14px;
  font-weight: 600;
}
.find__empty {
  margin: 8px 16px;
  color: var(--ws-muted);
  font-size: 13px;
}
.find__group {
  padding: 8px 8px 4px;
}
.find__group h3 {
  margin: 4px 8px 6px;
}
.find__group ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.finding {
  display: grid;
  width: 100%;
  gap: 2px;
  padding: 8px;
  border: 0;
  border-radius: var(--ws-radius);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.finding:hover,
.finding--open {
  background: var(--ws-sunken);
}
.finding__top {
  display: flex;
  gap: 8px;
  font-size: 12px;
}
.finding__seen {
  margin-left: auto;
  color: var(--ws-success);
}
.finding__match {
  font-weight: 500;
}
.finding__detail {
  display: grid;
  gap: 6px;
  justify-items: start;
  margin: 2px 8px 8px;
  padding: 8px 10px;
  border-left: 2px solid var(--ws-border-strong);
  font-size: 13px;
}
.doc-switch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ws-border);
}
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--ws-radius);
  background: var(--ws-sunken);
}
.seg button {
  min-height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ws-muted);
  font-size: 13px;
  cursor: pointer;
}
.seg button[aria-pressed='true'] {
  background: var(--ws-surface);
  box-shadow: 0 1px 2px rgb(23 32 42 / 0.12);
  color: var(--ws-text);
  font-weight: 600;
}
.visibility {
  color: var(--ws-muted);
  font-size: 12px;
}
.doc-area {
  min-height: 0;
}
.doc-area--compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--ws-border);
}
.decide {
  display: grid;
  gap: 16px;
  padding: 16px;
}
.banner {
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 10px 12px;
  border-left: 3px solid var(--ws-action);
  border-radius: 0 var(--ws-radius) var(--ws-radius) 0;
  background: var(--ws-action-soft);
  font-size: 13px;
}
.banner--danger {
  border-left-color: var(--ws-danger);
  background: var(--ws-danger-soft);
}
.basis h2,
.choice legend {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}
.basis dl {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 6px 10px;
  margin: 0;
  font-size: 13px;
}
.basis dt {
  color: var(--ws-muted);
}
.basis dd {
  margin: 0;
}
.basis__stale {
  display: grid;
  gap: 8px;
  justify-items: start;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-warning-soft);
  font-size: 13px;
}
.basis__note {
  margin-top: 10px;
  color: var(--ws-muted);
  font-size: 13px;
}
.choice {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}
.choice__opt {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  cursor: pointer;
}
.choice__opt:has(input:checked) {
  border-color: var(--ws-action);
  background: var(--ws-action-soft);
}
.choice__opt--off {
  cursor: not-allowed;
  opacity: 0.7;
}
.choice__opt input {
  margin-top: 3px;
}
.choice__opt span {
  display: grid;
  gap: 2px;
}
.choice__opt small {
  color: var(--ws-muted);
  font-size: 12px;
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
.decide-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  min-height: 56px;
  padding: 8px 16px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.decide-bar__state {
  font-size: 13px;
}
.decide-bar__done {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.decide-bar__actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.more {
  position: relative;
}
.more__menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  min-width: 200px;
  padding: 4px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
  box-shadow: var(--ws-shadow-float);
}
.more__menu button {
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ws-danger);
  text-align: left;
  cursor: pointer;
}
.more__menu button:hover {
  background: var(--ws-danger-soft);
}
.mtabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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
.verify__grid--mid {
  position: relative;
  grid-template-columns: minmax(0, 1fr) 340px;
}
.col--overlay {
  position: absolute;
  z-index: 20;
  top: 0;
  bottom: 0;
  left: 0;
  width: 300px;
  box-shadow: var(--ws-shadow-float);
}
@media (max-width: 859px) {
  .vt-meta,
  .vt-pos {
    display: none;
  }
  .decide-bar__actions {
    width: 100%;
  }
  .decide-bar__actions .btn--primary {
    flex: 1;
  }
}
@media (max-width: 640px) {
  .vt-prev {
    display: none;
  }
}
</style>
