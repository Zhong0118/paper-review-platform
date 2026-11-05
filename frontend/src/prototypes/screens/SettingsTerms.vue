<script setup lang="ts">
/**
 * P12d 检测词表（学校设置）：一张可编辑表，整表保存带 expected_version。
 * 保存状态常驻；版本冲突时保留本地修改，列出对方已保存的差异，再由用户决定合并或放弃。
 * 已有报告是否随词表重算以后端为准，原型不作承诺。
 */
import { computed, ref, watch } from 'vue'

import OperationsShell from '../kit/OperationsShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import { useProtoState } from '../kit/useProtoState'
import '../kit/desk.css'
import { accounts } from '../data/fixtures'
import { schoolNav } from '../data/nav'
import { terms as baseTerms, termsTheirs, type Term } from '../data/u3'

const states = [
  { value: 'normal', label: '已有词表' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '词表为空' },
  { value: 'error', label: '加载失败' },
  { value: 'dirty', label: '有未保存的修改' },
  { value: 'conflict', label: '保存时版本冲突' },
] as const
const state = useProtoState(states, 'normal')

const saved = ref<Term[]>([])
const rows = ref<Term[]>([])
const version = ref(9)
const flash = ref('')
const conflict = ref(false)
const tried = ref(false)
let seq = 100
/** 响应式代理不能 structuredClone，用 JSON 复制纯数据 */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

watch(
  state,
  (s) => {
    saved.value = s === 'empty' ? [] : structuredClone(baseTerms)
    rows.value = clone(saved.value)
    version.value = 9
    flash.value = ''
    tried.value = false
    conflict.value = s === 'conflict'
    if (s === 'dirty' || s === 'conflict') {
      rows.value = rows.value.filter((r) => r.id !== 'k4')
      rows.value.push({ id: 'n1', text: '示例大学出版社', severity: 'WARN', description: '本校出版社' })
    }
  },
  { immediate: true },
)

const key = (r: Term) => `${r.text}|${r.severity}|${r.description}`
const changes = computed(() => {
  const before = new Map(saved.value.map((r) => [r.id, r]))
  const after = new Map(rows.value.map((r) => [r.id, r]))
  let n = 0
  for (const [id, r] of after) if (!before.has(id) || key(before.get(id)!) !== key(r)) n++
  for (const id of before.keys()) if (!after.has(id)) n++
  return n
})
const blankRow = computed(() => rows.value.some((r) => !r.text.trim()))
const dupes = computed(() => {
  const seen = new Set<string>()
  const d = new Set<string>()
  for (const r of rows.value) {
    const t = r.text.trim()
    if (t && seen.has(t)) d.add(t)
    seen.add(t)
  }
  return d
})
const rowError = (r: Term) => (!r.text.trim() ? '请填写词语，或删除这一行' : dupes.value.has(r.text.trim()) ? '与其他行重复' : '')

function revert() {
  rows.value = clone(saved.value)
  conflict.value = false
  tried.value = false
}
function addRow() {
  rows.value.push({ id: `n${seq++}`, text: '', severity: 'WARN', description: '' })
}
function removeRow(id: string) {
  rows.value = rows.value.filter((r) => r.id !== id)
}
function save() {
  tried.value = true
  if (blankRow.value || dupes.value.size || conflict.value) return
  saved.value = clone(rows.value)
  version.value += 1
  tried.value = false
  flash.value = `已保存为第 ${version.value} 版。之后新发起的匿名检测按新词表执行。`
}
function merge() {
  // 对方：新增 k6、k2 改为阻断；我的：删除 k4、新增“示例大学出版社”
  conflict.value = false
  const theirs = structuredClone(baseTerms).map((r) => (r.id === 'k2' ? { ...r, severity: 'BLOCK' as const } : r))
  theirs.push(...structuredClone(termsTheirs.added))
  saved.value = clone(theirs)
  version.value = 10
  rows.value = theirs.filter((r) => r.id !== 'k4')
  rows.value.push({ id: 'n1', text: '示例大学出版社', severity: 'WARN', description: '本校出版社' })
  flash.value = '已读回第 10 版并重新套用你的 2 处修改。核对后再保存。'
}
function dropMine() {
  conflict.value = false
  const theirs = structuredClone(baseTerms).map((r) => (r.id === 'k2' ? { ...r, severity: 'BLOCK' as const } : r))
  theirs.push(...structuredClone(termsTheirs.added))
  saved.value = theirs
  rows.value = clone(theirs)
  version.value = 10
  flash.value = '已放弃你的修改，显示的是第 10 版。'
}
</script>

<template>
  <ProtoFrame v-model:state="state" name="检测词表" :states="states">
    <OperationsShell :nav="schoolNav('terms')" :account="accounts.school" org="示例大学">
      <template #title><h1 class="title">检测词表</h1></template>
      <template #context><span v-if="!['loading', 'error'].includes(state)" class="ctx num">第 {{ version }} 版</span></template>

      <div class="obj page">
        <p class="hint intro">匿名检测会在匿名稿中查找这些词。“阻断”出现即判不通过，“警告”需要人工复核。保存后新发起的检测按新词表执行。</p>

        <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取词表…" />
        <StateBlock v-else-if="state === 'error'" kind="error" title="词表没有加载出来">
          网络或服务暂时不可用。
          <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
        </StateBlock>

        <template v-else>
          <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>
          <div v-if="conflict" class="banner banner--danger" role="alert">
            <strong>没有保存：{{ termsTheirs.by }}刚刚保存了第 10 版</strong>
            <span>你的 {{ changes }} 处修改还在表里。对方的改动：</span>
            <ul class="theirs">
              <li v-for="a in termsTheirs.added" :key="a.id">新增“{{ a.text }}”（{{ a.severity === 'BLOCK' ? '阻断' : '警告' }}）</li>
              <li v-for="c in termsTheirs.changed" :key="c.id">“示大”的{{ c.field }}：{{ c.before }} → {{ c.after }}</li>
            </ul>
            <div class="acts">
              <button type="button" class="btn btn--sm btn--primary" @click="merge">在第 10 版上保留我的修改</button>
              <button type="button" class="btn btn--sm" @click="dropMine">放弃我的修改</button>
            </div>
          </div>

          <section class="sec">
            <StateBlock v-if="!rows.length" kind="empty" title="词表为空" compact>
              目前只按平台内置规则检测。加入本校全称、简称、院系与实验室名称，可以减少匿名稿漏检。
              <template #actions><button type="button" class="btn btn--primary" @click="addRow">添加第一个词</button></template>
            </StateBlock>
            <div v-else class="twrap">
              <table class="dtable terms">
                <thead>
                  <tr>
                    <th scope="col">词语</th>
                    <th scope="col" class="shrink">严重程度</th>
                    <th scope="col">说明</th>
                    <th scope="col" class="shrink"><span class="sr-only">删除</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r, i) in rows" :key="r.id" :class="{ fresh: !saved.some((s) => s.id === r.id) }">
                    <td>
                      <label :for="`t-${r.id}`" class="sr-only">第 {{ i + 1 }} 行词语</label>
                      <input :id="`t-${r.id}`" v-model="r.text" class="input" :aria-invalid="tried && Boolean(rowError(r))" />
                      <small v-if="tried && rowError(r)" class="field-error">{{ rowError(r) }}</small>
                    </td>
                    <td class="shrink">
                      <label :for="`s-${r.id}`" class="sr-only">第 {{ i + 1 }} 行严重程度</label>
                      <select :id="`s-${r.id}`" v-model="r.severity" class="select sev">
                        <option value="WARN">警告</option>
                        <option value="BLOCK">阻断</option>
                      </select>
                    </td>
                    <td>
                      <label :for="`d-${r.id}`" class="sr-only">第 {{ i + 1 }} 行说明</label>
                      <input :id="`d-${r.id}`" v-model="r.description" class="input" placeholder="可选" />
                    </td>
                    <td class="shrink"><button type="button" class="btn btn--sm btn--quiet" :aria-label="`删除“${r.text || '空行'}”`" @click="removeRow(r.id)">删除</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="rows.length" class="acts"><button type="button" class="btn btn--sm" @click="addRow">添加一行</button></div>
          </section>
          <ProtoNote contract="sensitiveChecks">
            getSensitiveTerms 返回 version 与 terms；saveSensitiveTerms 整表提交并带 expected_version。原型的合并在前端完成，真实接线时仍以读回结果为准。
          </ProtoNote>
        </template>
      </div>

      <footer v-if="!['loading', 'error'].includes(state)" class="commit">
        <p class="commit__text" role="status">{{ changes ? `未保存的修改 ${changes} 处` : '没有未保存的修改' }}</p>
        <button type="button" class="btn" :disabled="!changes" @click="revert">撤销修改</button>
        <button type="button" class="btn btn--primary" :disabled="!changes || conflict" @click="save">保存词表</button>
      </footer>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.page {
  max-width: 1080px;
  min-height: calc(100vh - var(--ws-bar) - 56px);
}
.intro {
  max-width: 72ch;
}
.terms td {
  vertical-align: top;
}
.terms .input {
  min-width: 160px;
}
.sev {
  width: 96px;
}
.fresh td:first-child {
  box-shadow: inset 3px 0 0 var(--ws-action);
}
.theirs {
  margin: 0;
  padding-left: 1.1em;
}
@media (max-width: 720px) {
  .terms thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .terms tr {
    display: grid;
    grid-template-areas: 'text text' 'sev del' 'desc desc';
    grid-template-columns: 1fr auto;
    gap: 6px 8px;
    padding: 10px 0;
    border-bottom: 1px solid var(--ws-border);
  }
  .terms td {
    padding: 0;
    border: 0;
  }
  .terms td:nth-child(1) {
    grid-area: text;
  }
  .terms td:nth-child(2) {
    grid-area: sev;
  }
  .terms td:nth-child(3) {
    grid-area: desc;
  }
  .terms td:nth-child(4) {
    grid-area: del;
  }
  .terms .input {
    width: 100%;
    min-width: 0;
  }
}
</style>
