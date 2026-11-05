<script setup lang="ts">
/**
 * P12c 学科与专业（学校设置）：开放学科｜校内专业对照 两个分区。
 * 开放学科未设置时，学生可以选择全部启用的官方学科；保存带版本。
 * 校内专业 CSV：生成预览 ≠ 写入；有错误时不能发布；发布前确认。
 */
import { computed, ref, watch } from 'vue'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import OperationsShell from '../kit/OperationsShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import '../kit/desk.css'
import { accounts } from '../data/fixtures'
import { schoolNav } from '../data/nav'
import { disciplineGroups, openDisciplines, programPreview, programVersions } from '../data/u3'

const states = [
  { value: 'normal', label: '开放学科（已设置）' },
  { value: 'loading', label: '首次加载' },
  { value: 'unconfigured', label: '未设置开放学科' },
  { value: 'error', label: '加载失败' },
  { value: 'conflict', label: '保存时版本冲突' },
  { value: 'programs', label: '校内专业：已发布版本' },
  { value: 'preview', label: '校内专业：预览未写入' },
  { value: 'preview-errors', label: '校内专业：预览有错误' },
  { value: 'publish', label: '校内专业：发布确认' },
] as const
const state = useProtoState(states, 'normal')

const tab = ref<'open' | 'programs'>('open')
const saved = ref<string[]>([])
const picked = ref<string[]>([])
const configured = ref(true)
const flash = ref('')
const conflict = ref(false)
const csv = ref({ year: '2026', source: '研究生院专业目录', sourceVersion: '2026-11', file: '' })
const preview = ref<null | typeof programPreview>(null)
const publishOpen = ref(false)
const versions = ref(structuredClone(programVersions))

watch(
  state,
  (s) => {
    tab.value = ['programs', 'preview', 'preview-errors', 'publish'].includes(s) ? 'programs' : 'open'
    configured.value = s !== 'unconfigured'
    saved.value = s === 'unconfigured' ? [] : [...openDisciplines]
    picked.value = [...saved.value]
    flash.value = ''
    conflict.value = s === 'conflict'
    if (s === 'conflict') picked.value = [...openDisciplines, '1201']
    csv.value.file = ['preview', 'preview-errors', 'publish'].includes(s) ? '专业目录-2026-11.csv' : ''
    preview.value = s === 'preview-errors' ? structuredClone(programPreview) : ['preview', 'publish'].includes(s) ? { ...structuredClone(programPreview), errors: [] } : null
    publishOpen.value = s === 'publish'
    versions.value = structuredClone(programVersions)
  },
  { immediate: true },
)
const failed = computed(() => state.value === 'error')
const loading = computed(() => state.value === 'loading')
const dirty = computed(() => [...picked.value].sort().join() !== [...saved.value].sort().join())
const added = computed(() => picked.value.filter((c) => !saved.value.includes(c)))
const removed = computed(() => saved.value.filter((c) => !picked.value.includes(c)))
const nameOf = (code: string) => disciplineGroups.flatMap((g) => g.items).find((i) => i.code === code)?.name ?? code
const groupPicked = (codes: string[]) => codes.filter((c) => picked.value.includes(c)).length

function saveOpen() {
  if (conflict.value) return
  saved.value = [...picked.value]
  configured.value = true
  flash.value = `已保存。本校开放 ${saved.value.length} 个学科；学生新建论文时只能选择这些学科。`
}
function mergeTheirs() {
  // 对方新增了 0603；在对方保存的结果上重新套用“我新增的 1201”
  conflict.value = false
  saved.value = [...openDisciplines, '0603']
  picked.value = [...saved.value, '1201']
  flash.value = '已读回对方保存的结果（新增 0603 世界史），并保留你新勾选的 1201 管理科学与工程。确认后再保存。'
}
function dropMine() {
  conflict.value = false
  saved.value = [...openDisciplines, '0603']
  picked.value = [...saved.value]
  flash.value = '已放弃你的修改，显示的是对方保存的结果。'
}
function pickFile() {
  csv.value.file = '专业目录-2026-11.csv'
}
function makePreview() {
  preview.value = structuredClone(programPreview)
}
function publish() {
  publishOpen.value = false
  versions.value.unshift({ id: 'pv4', label: '2026 年第 3 版（47 个专业）', published: '11-05' })
  preview.value = null
  csv.value.file = ''
  flash.value = '已发布 2026 年第 3 版。之后新建论文的学生会看到新目录；已固定旧版本的批次需要在批次里改选。'
}
const total = computed(() => (preview.value ? preview.value.retained + preview.value.added.length + preview.value.changed.length : 0))
</script>

<template>
  <ProtoFrame v-model:state="state" name="学科与专业" :states="states">
    <OperationsShell :nav="schoolNav('disciplines')" :account="accounts.school" org="示例大学">
      <template #title><h1 class="title">学科与专业</h1></template>
      <template #context><span class="ctx">决定学生新建论文时能选的学科与专业</span></template>

      <div class="page" :class="{ 'page--commit': tab === 'open' }">
        <div class="views tabs" role="tablist" aria-label="分区">
          <button type="button" role="tab" class="views__tab" :aria-selected="tab === 'open'" @click="tab = 'open'; flash = ''">开放学科</button>
          <button type="button" role="tab" class="views__tab" :aria-selected="tab === 'programs'" @click="tab = 'programs'; flash = ''">校内专业对照</button>
        </div>

        <StateBlock v-if="loading" kind="loading" title="正在读取学科设置…" />
        <StateBlock v-else-if="failed" kind="error" title="学科设置没有加载出来">
          网络或服务暂时不可用。
          <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
        </StateBlock>

        <!-- 开放学科 -->
        <div v-else-if="tab === 'open'" class="obj wide">
          <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>
          <StateBlock v-if="!configured" kind="unconfigured" title="尚未设置开放学科" compact>
            现在学生新建论文时可以选择全部启用的官方学科。勾选并保存后，只开放勾选的学科。
          </StateBlock>
          <div v-if="conflict" class="banner banner--danger" role="alert">
            <strong>没有保存：另一位学校审核刚刚保存了开放学科</strong>
            <span>对方新增了 0603 世界史。你新勾选的 1201 管理科学与工程还在。</span>
            <div class="acts">
              <button type="button" class="btn btn--sm btn--primary" @click="mergeTheirs">在对方的结果上保留我的勾选</button>
              <button type="button" class="btn btn--sm" @click="dropMine">放弃我的修改</button>
            </div>
          </div>

          <section class="sec" aria-labelledby="open-h">
            <div class="sec__head">
              <h3 id="open-h">官方学科（一级学科）</h3>
              <p>已勾选 {{ picked.length }} 个</p>
            </div>
            <div class="groups">
              <fieldset v-for="g in disciplineGroups" :key="g.group" class="group">
                <legend>{{ g.group }}<span class="muted num">　{{ groupPicked(g.items.map((i) => i.code)) }}/{{ g.items.length }}</span></legend>
                <label v-for="i in g.items" :key="i.code" class="choice">
                  <input v-model="picked" type="checkbox" :value="i.code" />
                  <span><span class="num">{{ i.code }}</span> {{ i.name }}</span>
                </label>
              </fieldset>
            </div>
          </section>
          <ProtoNote contract="catalogs">
            getDisciplineSettings 返回 configured / codes / version；saveDisciplineSettings 带 version，冲突为 409 VERSION_CONFLICT。学科只能来自启用的官方目录。
          </ProtoNote>
        </div>

        <!-- 校内专业对照 -->
        <div v-else class="obj wide">
          <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>

          <section class="sec" aria-labelledby="ver-h">
            <div class="sec__head"><h3 id="ver-h">已发布版本</h3><p>批次可以固定其中一个版本</p></div>
            <div class="twrap">
              <table class="dtable">
                <thead><tr><th scope="col">版本</th><th scope="col">发布日期</th><th scope="col" class="shrink"><span class="sr-only">状态</span></th></tr></thead>
                <tbody>
                  <tr v-for="(v, i) in versions" :key="v.id">
                    <td>{{ v.label }}</td>
                    <td class="num">{{ v.published }}</td>
                    <td class="shrink"><StatusPill v-if="i === 0" tone="success">最新</StatusPill></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="sec" aria-labelledby="imp-h">
            <div class="sec__head"><h3 id="imp-h">导入新版本</h3><p>每行一个校内专业，对照到官方学科</p></div>
            <div class="grid2">
              <label class="field"><span>目录年份</span><input v-model="csv.year" class="input num" inputmode="numeric" /></label>
              <label class="field"><span>来源版本</span><input v-model="csv.sourceVersion" class="input" /></label>
              <label class="field wide"><span>来源说明</span><input v-model="csv.source" class="input" /></label>
            </div>
            <div class="acts">
              <button type="button" class="btn" @click="pickFile">选择 CSV 文件</button>
              <span class="hint">{{ csv.file || '尚未选择文件' }}</span>
              <button type="button" class="btn btn--outline" :disabled="!csv.file" @click="makePreview">生成预览</button>
              <button type="button" class="btn btn--quiet btn--sm">下载模板</button>
            </div>
          </section>

          <section v-if="preview" class="sec sec--attention" aria-labelledby="pre-h">
            <div class="sec__head">
              <h3 id="pre-h">预览：2026 年第 {{ preview.revision }} 版</h3>
              <StatusPill tone="warning">预览未写入</StatusPill>
            </div>
            <p class="hint">这只是对比结果，目录没有任何变化。确认发布后才会生成新版本。</p>
            <ul class="stats">
              <li><span class="num">{{ preview.added.length }}</span> 新增</li>
              <li><span class="num">{{ preview.changed.length }}</span> 变更</li>
              <li><span class="num">{{ preview.removed.length }}</span> 停用</li>
              <li><span class="num">{{ preview.retained }}</span> 不变</li>
              <li :class="{ bad: preview.errors.length }"><span class="num">{{ preview.errors.length }}</span> 错误</li>
            </ul>
            <div v-if="preview.errors.length" class="banner banner--danger" role="alert">
              <strong>有 {{ preview.errors.length }} 行需要修正，修正 CSV 后重新生成预览</strong>
              <ul class="errs"><li v-for="e in preview.errors" :key="e">{{ e }}</li></ul>
            </div>
            <div class="twrap">
              <table class="dtable">
                <thead><tr><th scope="col">变化</th><th scope="col">校内代码</th><th scope="col">校内名称</th><th scope="col">对照官方学科</th></tr></thead>
                <tbody>
                  <tr v-for="r in preview.added" :key="r.code"><td><span class="tag tag--add">新增</span></td><td class="num">{{ r.code }}</td><td>{{ r.name }}</td><td>{{ r.official }}</td></tr>
                  <tr v-for="r in preview.changed" :key="r.code"><td><span class="tag">变更</span></td><td class="num">{{ r.code }}</td><td>{{ r.name }}<span class="muted">（原：{{ r.before }}）</span></td><td>{{ r.official }}</td></tr>
                  <tr v-for="r in preview.removed" :key="r.code"><td><span class="tag tag--rm">停用</span></td><td class="num">{{ r.code }}</td><td>{{ r.name }}</td><td>{{ r.official }}</td></tr>
                </tbody>
              </table>
            </div>
            <div class="acts acts--end">
              <button type="button" class="btn" @click="preview = null">放弃预览</button>
              <button type="button" class="btn btn--primary" :disabled="preview.errors.length > 0" @click="publishOpen = true">发布第 {{ preview.revision }} 版…</button>
            </div>
          </section>
          <ProtoNote contract="schoolPrograms">
            previewPrograms 返回 revision / retained / fingerprint / errors / changes；publishPrograms 需带预览指纹。指纹不匹配时只能重新预览。
          </ProtoNote>
        </div>
      </div>

      <footer v-if="tab === 'open' && !loading && !failed" class="commit">
        <p class="commit__text">
          <template v-if="dirty">未保存：新增 {{ added.map(nameOf).join('、') || '无' }}；取消 {{ removed.map(nameOf).join('、') || '无' }}</template>
          <template v-else>没有未保存的修改</template>
        </p>
        <button type="button" class="btn" :disabled="!dirty" @click="picked = [...saved]; conflict = false">撤销修改</button>
        <button type="button" class="btn btn--primary" :disabled="!dirty || conflict" @click="saveOpen">保存开放学科</button>
      </footer>

      <ConfirmDialog :open="publishOpen && Boolean(preview)" title="发布校内专业目录" @close="publishOpen = false">
        <p>发布 2026 年第 {{ preview?.revision }} 版，共 {{ total }} 个专业。</p>
        <p class="muted">之后新建论文的学生会看到新目录；停用的专业不再可选，已建论文保留原专业。已固定旧版本的批次需要在批次里改选。</p>
        <template #actions>
          <button type="button" class="btn" @click="publishOpen = false">取消</button>
          <button type="button" class="btn btn--primary" @click="publish">发布</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.page {
  display: grid;
  align-content: start;
}
/* 让底部保存条在内容较短时也贴在视口底部 */
.page--commit {
  min-height: calc(100vh - var(--ws-bar) - 57px);
}
.tabs {
  padding: 10px 24px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.wide {
  max-width: 1080px;
}
.groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px 24px;
}
.group {
  display: grid;
  align-content: start;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
}
.group legend {
  margin-bottom: 4px;
  padding: 0;
  font-size: 13px;
  font-weight: 600;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ws-muted);
  font-size: 13px;
}
.stats .num {
  margin-right: 2px;
  color: var(--ws-text);
  font-size: 18px;
  font-weight: 600;
}
.stats .bad,
.stats .bad .num {
  color: var(--ws-danger);
}
.errs {
  margin: 0;
  padding-left: 1.1em;
}
.tag--add {
  background: var(--ws-success-soft);
  color: var(--ws-success);
}
.tag--rm {
  background: var(--ws-danger-soft);
  color: var(--ws-danger);
}
@media (max-width: 899px) {
  .tabs {
    padding: 8px 14px;
  }
}
</style>
