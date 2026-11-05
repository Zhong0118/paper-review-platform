<script setup lang="ts">
/**
 * U4-5 开放学科：按门类勾选，整份保存带版本。
 * 未设置时学生可选全部启用学科，勾选初始为全部；409 时重读，保留勾选并可套到对方结果上。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { getDisciplines, getDisciplineSettings, saveDisciplineSettings, type CatalogOption } from '@/api/catalogs'
import { apiFailure } from '@/api/failure'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'

import { codeDiff, effectiveCodes, groupDisciplines, mergeCodes, sameCodes } from './disciplineView'

let alive = true
onBeforeUnmount(() => (alive = false))
const options = ref<CatalogOption[]>([])
const configured = ref(false)
const version = ref(0)
const base = ref<string[]>([])
const picked = ref<string[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const flash = ref('')
const saveError = ref('')
const conflict = ref<null | { theirs: string[]; configured: boolean; version: number }>(null)
const emptyOpen = ref(false)
const query = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [items, settings] = await Promise.all([getDisciplines({ quiet: true }), getDisciplineSettings({ quiet: true })])
    if (!alive) return
    options.value = items
    configured.value = settings.configured
    version.value = settings.version
    base.value = effectiveCodes(settings, items)
    picked.value = [...base.value]
  } catch (reason) {
    if (alive) error.value = apiFailure(reason).message
  } finally {
    if (alive) loading.value = false
  }
}
void load()

const label = (codes: string[]) => codes.map((code) => {
  const item = options.value.find((option) => option.code === code)
  return item ? `${code} ${item.name}` : `${code}（已停用）`
}).join('、')
const groups = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return groupDisciplines(options.value)
    .map((group) => ({ ...group, total: group.items.length, chosen: group.items.filter((item) => picked.value.includes(item.code)).length,
      shown: group.items.filter((item) => !needle || `${item.code} ${item.name}`.toLowerCase().includes(needle)) }))
    .filter((group) => group.shown.length)
})
const historical = computed(() => picked.value.filter((code) => !options.value.some((item) => item.code === code)))
const diff = computed(() => codeDiff(base.value, picked.value))
const dirty = computed(() => !sameCodes(base.value, picked.value))
const canSave = computed(() => !saving.value && !conflict.value && (dirty.value || !configured.value))
const theirsDiff = computed(() => (conflict.value ? codeDiff(base.value, conflict.value.theirs) : null))

function toggle(code: string, on: boolean) {
  picked.value = on ? [...new Set([...picked.value, code])] : picked.value.filter((item) => item !== code)
}
function requestSave() {
  if (!canSave.value) return
  if (!picked.value.length) emptyOpen.value = true
  else void save()
}
async function save() {
  if (saving.value) return
  saving.value = true
  flash.value = ''
  saveError.value = ''
  try {
    const result = await saveDisciplineSettings([...picked.value].sort(), version.value, { quiet: true })
    if (!alive) return
    configured.value = result.configured
    version.value = result.version
    base.value = [...result.codes].sort()
    picked.value = [...base.value]
    emptyOpen.value = false
    flash.value = result.codes.length
      ? `已保存。本校开放 ${result.codes.length} 个学科；学生新建论文时只能选择这些学科，已建论文保留原学科。`
      : '已保存。本校暂不开放学科，学生新建论文时没有可选学科。'
  } catch (reason) {
    if (!alive) return
    emptyOpen.value = false
    const failure = apiFailure(reason)
    if (failure.status !== 409) {
      saveError.value = failure.message
      return
    }
    try {
      const settings = await getDisciplineSettings({ quiet: true })
      if (!alive) return
      conflict.value = { theirs: effectiveCodes(settings, options.value), configured: settings.configured, version: settings.version }
    } catch (again) {
      if (alive) saveError.value = `没有保存：开放学科已被修改，最新设置也没有读到（${apiFailure(again).message}）。请重试。`
    }
  } finally {
    if (alive) saving.value = false
  }
}
function adopt(keepMine: boolean) {
  const next = conflict.value
  if (!next) return
  const merged = keepMine ? mergeCodes(base.value, picked.value, next.theirs) : [...next.theirs]
  base.value = [...next.theirs]
  picked.value = merged
  configured.value = next.configured
  version.value = next.version
  conflict.value = null
  flash.value = keepMine ? '已读回对方保存的结果，并保留了你的勾选。核对后再保存。' : '已放弃你的修改，显示的是对方保存的结果。'
}
</script>

<template>
  <StateBlock v-if="loading" kind="loading" title="正在读取学科设置…" />
  <StateBlock v-else-if="error" kind="error" title="学科设置没有加载出来">
    {{ error }}
    <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
  </StateBlock>
  <StateBlock v-else-if="!options.length" kind="empty" title="官方学科目录为空">请联系系统管理员导入官方基础目录。</StateBlock>
  <template v-else>
    <div class="wsd-obj open">
      <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
      <StateBlock v-if="!configured" kind="unconfigured" :title="`尚未设置开放学科：现在开放全部 ${options.length} 个学科`" compact>
        学生新建论文时可以选择全部启用的官方学科。保存后只开放勾选的学科；历史论文保持原值。
      </StateBlock>
      <div v-if="conflict && theirsDiff" class="wsd-banner wsd-banner--danger" role="alert" data-conflict>
        <strong>没有保存：另一位学校审核刚刚保存了开放学科</strong>
        <span>对方新增：{{ label(theirsDiff.added) || '无' }}；对方取消：{{ label(theirsDiff.removed) || '无' }}。你的勾选还在。</span>
        <div class="wsd-acts">
          <button type="button" class="btn btn--sm btn--primary" data-action="merge-mine" @click="adopt(true)">在对方的结果上保留我的勾选</button>
          <button type="button" class="btn btn--sm" data-action="take-theirs" @click="adopt(false)">放弃我的修改</button>
        </div>
      </div>

      <section class="wsd-sec" aria-labelledby="open-h">
        <div class="wsd-sec__head">
          <h3 id="open-h">官方学科</h3>
          <p class="num">已勾选 {{ picked.length }} / {{ options.length }}</p>
        </div>
        <div class="tools">
          <label class="search">
            <span class="sr-only">搜索学科</span>
            <input v-model="query" class="input" type="search" placeholder="代码或名称" data-field="discipline-search" />
          </label>
          <button type="button" class="btn btn--sm" data-action="pick-all" :disabled="saving" @click="picked = [...new Set([...options.map((item) => item.code), ...historical])]">全选</button>
          <button type="button" class="btn btn--sm" data-action="pick-none" :disabled="saving" @click="picked = []">清空</button>
        </div>
        <p v-if="!groups.length" class="wsd-hint">没有匹配“{{ query.trim() }}”的学科。</p>
        <div class="groups">
          <fieldset v-for="group in groups" :key="group.code" class="group" :disabled="saving" :data-group="group.code">
            <legend>{{ group.name }}<span class="muted num">　{{ group.chosen }}/{{ group.total }}</span></legend>
            <label v-for="item in group.shown" :key="item.code" class="wsd-choice">
              <input type="checkbox" :value="item.code" :checked="picked.includes(item.code)" :data-code="item.code" @change="toggle(item.code, ($event.target as HTMLInputElement).checked)" />
              <span><span class="num">{{ item.code }}</span> {{ item.name }}</span>
            </label>
          </fieldset>
        </div>
        <div v-if="historical.length" class="wsd-hint" data-historical>
          <p>以下学科已不在启用目录中，保存时会被拒绝，请移除：</p>
          <ul><li v-for="code in historical" :key="code"><span class="num">{{ code }}</span>　<button type="button" class="btn btn--quiet btn--sm" @click="toggle(code, false)">移除</button></li></ul>
        </div>
      </section>
      <p v-if="saveError" class="field-error" role="alert">{{ saveError }}</p>
    </div>

    <footer class="wsd-commit">
      <p class="wsd-commit__text" role="status">
        <template v-if="dirty">未保存：新增 {{ label(diff.added) || '无' }}；取消 {{ label(diff.removed) || '无' }}</template>
        <template v-else-if="!configured">保存后开始按勾选开放</template>
        <template v-else>没有未保存的修改</template>
      </p>
      <button type="button" class="btn" :disabled="!dirty || saving" @click="picked = [...base]">撤销修改</button>
      <button type="button" class="btn btn--primary" data-action="save-disciplines" :disabled="!canSave" @click="requestSave">{{ saving ? '正在保存…' : '保存开放学科' }}</button>
    </footer>
  </template>

  <ConfirmDialog :open="emptyOpen" title="不开放任何学科" :busy="saving" @close="saving || (emptyOpen = false)">
    <p>保存后，学生新建论文时没有可选学科，已建论文保留原学科。之后可以重新勾选。</p>
    <template #actions>
      <button type="button" class="btn" :disabled="saving" @click="emptyOpen = false">取消</button>
      <button type="button" class="btn btn--danger" data-action="confirm-empty" :disabled="saving" @click="save">仍然保存</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.open {
  max-width: 1080px;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.search {
  flex: 1 1 220px;
  max-width: 320px;
}
.groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px 24px;
}
.group {
  display: grid;
  align-content: start;
  gap: 4px;
  min-width: 0;
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
[data-historical] ul {
  margin: 4px 0 0;
  padding-left: 1.1em;
}
</style>
