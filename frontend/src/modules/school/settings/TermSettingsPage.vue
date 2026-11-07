<script setup lang="ts">
/**
 * U4-5 检测词表（真实模式，P12）：一张可编辑表，整表保存带 expected_version。
 * 409 时重读，保留表格，列出对方的改动；可按词语把我的改动套到对方版本上（不自动保存）。
 * 两种模式共用本页（U4-9 删除了旧页）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { apiFailure } from '@/api/failure'
import { getSensitiveTerms, saveSensitiveTerms } from '@/api/sensitiveChecks'
import AppShell from '@/components/app/shell/AppShell.vue'
import { schoolOrg } from '@/components/app/shell/schoolOrg'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import { changeCount, cloneRows, MAX_TERMS, mergeTerms, newRow, rowErrors, termDiff, toRows, toTerms, type TermChange, type TermRow } from './termsView'

const auth = useAuthStore()
let alive = true
onBeforeUnmount(() => (alive = false))

const version = ref(0)
const base = ref<TermRow[]>([])
const rows = ref<TermRow[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const tried = ref(false)
const flash = ref('')
const saveError = ref('')
const conflict = ref<null | { version: number; terms: ReturnType<typeof toTerms>; changes: TermChange[] }>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await getSensitiveTerms({ quiet: true })
    if (!alive) return
    version.value = result.version
    base.value = toRows(result.terms)
    rows.value = cloneRows(base.value)
    conflict.value = null
    tried.value = false
  } catch (reason) {
    if (alive) error.value = apiFailure(reason).message
  } finally {
    if (alive) loading.value = false
  }
}
void load()

const changes = computed(() => changeCount(base.value, rows.value))
const errors = computed(() => rowErrors(rows.value))
const errorCount = computed(() => Object.keys(errors.value).length)
const savedIds = computed(() => new Set(base.value.map((row) => row.id)))
const full = computed(() => rows.value.length >= MAX_TERMS)

function addRow() {
  if (full.value) return
  rows.value.push(newRow())
  flash.value = ''
}
function removeRow(id: string) {
  rows.value = rows.value.filter((row) => row.id !== id)
}
function revert() {
  rows.value = cloneRows(base.value)
  tried.value = false
  saveError.value = ''
}
async function save() {
  tried.value = true
  flash.value = ''
  saveError.value = ''
  if (saving.value || conflict.value || !changes.value || errorCount.value || rows.value.length > MAX_TERMS) return
  saving.value = true
  try {
    const result = await saveSensitiveTerms({ expected_version: version.value, terms: toTerms(rows.value) }, { quiet: true })
    if (!alive) return
    version.value = result.version
    base.value = toRows(result.terms)
    rows.value = cloneRows(base.value)
    tried.value = false
    flash.value = `已保存为第 ${result.version} 版。之后的匿名检测按新词表执行；已有的检测报告随之过期，待核验论文需要重新检测。`
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status !== 409) {
      saveError.value = `没有保存：${failure.message}。表格里的修改还在。`
      return
    }
    try {
      const fresh = await getSensitiveTerms({ quiet: true })
      if (!alive) return
      conflict.value = { version: fresh.version, terms: fresh.terms, changes: termDiff(toTerms(base.value), fresh.terms) }
    } catch (again) {
      if (alive) saveError.value = `没有保存：词表已被修改，最新版本也没有读到（${apiFailure(again).message}）。表格里的修改还在，请重试。`
    }
  } finally {
    if (alive) saving.value = false
  }
}
function adopt(keepMine: boolean) {
  const next = conflict.value
  if (!next) return
  if (keepMine) {
    const merged = mergeTerms(base.value, rows.value, next.terms)
    base.value = merged.base
    rows.value = merged.rows
  } else {
    base.value = toRows(next.terms)
    rows.value = cloneRows(base.value)
  }
  version.value = next.version
  conflict.value = null
  tried.value = false
  flash.value = keepMine ? `已读回第 ${next.version} 版，并重新套用了你的修改。核对后再保存。` : `已放弃你的修改，显示的是第 ${next.version} 版。`
}
const changeText = (change: TermChange) =>
  change.kind === 'added' ? `新增“${change.text}”（${change.detail}）` : change.kind === 'removed' ? `删除“${change.text}”` : `“${change.text}”：${change.detail}`

const signOut = useSignOut()
const nav = computed(() => workspaceNav('school_reviewer', '/school/sensitive-terms'))
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '学校审核',
  org: schoolOrg(auth.user),
}))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="bare" title="检测词表" @sign-out="signOut">
      <template v-if="!loading && !error" #context><span class="tabular">第 {{ version }} 版　{{ rows.length }} / {{ MAX_TERMS }}</span></template>
      <div class="page">
        <div class="wsd-obj terms-page">
          <p class="wsd-hint">匿名检测会在匿名稿中按字面查找这些词，不支持正则。“阻断”出现即不通过，需要修改材料后重新检测；“警告”由学校填写理由后确认。姓名与学号检测始终保留，不受词表影响。</p>
          <StatePanel v-if="loading" kind="loading" title="正在读取词表…" />
          <StatePanel v-else-if="error" kind="error" title="词表没有加载出来">
            {{ error }}
            <template #actions><Button type="button" variant="outline" @click="load">重试</Button></template>
          </StatePanel>
          <template v-else>
            <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
            <div v-if="conflict" class="wsd-banner wsd-banner--danger" role="alert" data-conflict>
              <strong>没有保存：另一位学校审核刚刚保存了第 {{ conflict.version }} 版</strong>
              <span>你的 {{ changes }} 处修改还在表里。对方的改动：</span>
              <ul class="theirs">
                <li v-for="change in conflict.changes" :key="`${change.kind}:${change.text}`">{{ changeText(change) }}</li>
                <li v-if="!conflict.changes.length">词语没有变化（可能只是重新保存）</li>
              </ul>
              <div class="wsd-acts">
                <Button type="button" size="sm" data-action="merge-mine" @click="adopt(true)">在第 {{ conflict.version }} 版上保留我的修改</Button>
                <Button type="button" variant="outline" size="sm" data-action="take-theirs" @click="adopt(false)">放弃我的修改</Button>
              </div>
            </div>

            <section class="wsd-sec">
              <StatePanel v-if="!rows.length" kind="empty" title="词表为空" compact>
                目前只按平台内置的姓名与学号规则检测。加入本校全称、简称、院系与实验室名称，可以减少匿名稿漏检。
                <template #actions><Button type="button" data-action="add-term" @click="addRow">添加第一个词</Button></template>
              </StatePanel>
              <div v-else class="wsd-twrap">
                <table class="wsd-dtable">
                  <thead>
                    <tr>
                      <th scope="col">词语</th>
                      <th scope="col" class="wsd-shrink">严重程度</th>
                      <th scope="col">说明</th>
                      <th scope="col" class="wsd-shrink"><span class="sr-only">删除</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, index) in rows" :key="row.id" :class="{ fresh: !savedIds.has(row.id) }" :data-term-row="index">
                      <td>
                        <label :for="`t-${row.id}`" class="sr-only">第 {{ index + 1 }} 行词语</label>
                        <input :id="`t-${row.id}`" v-model="row.text" class="input" data-field="term-text" :disabled="saving" :aria-invalid="tried && Boolean(errors[row.id]?.text)" />
                        <small v-if="tried && errors[row.id]?.text" class="field-error">{{ errors[row.id]!.text }}</small>
                      </td>
                      <td class="wsd-shrink">
                        <label :for="`s-${row.id}`" class="sr-only">第 {{ index + 1 }} 行严重程度</label>
                        <select :id="`s-${row.id}`" v-model="row.severity" class="select" data-field="term-severity" :disabled="saving">
                          <option value="WARN">警告</option>
                          <option value="BLOCK">阻断</option>
                        </select>
                      </td>
                      <td>
                        <label :for="`d-${row.id}`" class="sr-only">第 {{ index + 1 }} 行说明</label>
                        <input :id="`d-${row.id}`" v-model="row.description" class="input" placeholder="可选" data-field="term-description" :disabled="saving" :aria-invalid="tried && Boolean(errors[row.id]?.description)" />
                        <small v-if="tried && errors[row.id]?.description" class="field-error">{{ errors[row.id]!.description }}</small>
                      </td>
                      <td class="wsd-shrink">
                        <Button type="button" variant="ghost" size="sm" data-action="remove-term" :disabled="saving" :aria-label="`删除“${row.text.trim() || '空行'}”`" @click="removeRow(row.id)">删除</Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="rows.length" class="wsd-acts">
                <Button type="button" variant="outline" size="sm" data-action="add-term" :disabled="saving || full" @click="addRow">添加一行</Button>
                <span v-if="full" class="wsd-hint">已到 {{ MAX_TERMS }} 条上限</span>
              </div>
            </section>
            <p v-if="tried && errorCount" class="field-error" role="alert">有 {{ errorCount }} 行需要修改，改好后再保存。</p>
            <p v-if="saveError" class="field-error" role="alert">{{ saveError }}</p>
          </template>
        </div>

        <footer v-if="!loading && !error" class="wsd-commit">
          <p class="wsd-commit__text" role="status">{{ changes ? `未保存的修改 ${changes} 处` : '没有未保存的修改' }}</p>
          <Button type="button" variant="outline" :disabled="!changes || saving" @click="revert">撤销修改</Button>
          <Button type="button" data-action="save-terms" :disabled="!changes || saving || Boolean(conflict)" @click="save">{{ saving ? '正在保存…' : '保存词表' }}</Button>
        </footer>
      </div>
    </AppShell>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: calc(100svh - var(--bar-h));
}
.terms-page {
  margin-inline: auto;
}
.theirs {
  margin: 0;
  padding-left: 1.1em;
}
.fresh td:first-child {
  box-shadow: inset 3px 0 0 var(--ws-action);
}
</style>
