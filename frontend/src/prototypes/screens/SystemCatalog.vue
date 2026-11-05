<script setup lang="ts">
/**
 * P14b 官方基础目录：学科目录与院校名录的联合更新。
 * 现行接口不需要上传：服务端读取内置的官方来源快照，与库内目录比较，返回计数、来源与预览指纹。
 * 确认导入时带指纹；指纹不符（他人先导入或来源快照已变）时整批不写入，只能重新预览。
 */
import { ref, watch } from 'vue'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import OperationsShell from '../kit/OperationsShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import '../kit/desk.css'
import { systemNav } from '../data/nav'
import { catalogPreview, systemAccount } from '../data/u3'

const states = [
  { value: 'normal', label: '尚未预览' },
  { value: 'loading', label: '正在生成预览' },
  { value: 'error', label: '预览失败' },
  { value: 'preview', label: '预览未写入' },
  { value: 'apply', label: '导入确认' },
  { value: 'expired', label: '预览已过期' },
  { value: 'applied', label: '已导入' },
] as const
const state = useProtoState(states, 'normal')

const preview = ref<typeof catalogPreview | null>(null)
const confirmOpen = ref(false)
const expired = ref(false)
const applied = ref(false)
watch(
  state,
  (s) => {
    preview.value = ['preview', 'apply', 'expired', 'applied'].includes(s) ? catalogPreview : null
    confirmOpen.value = s === 'apply'
    expired.value = s === 'expired'
    applied.value = s === 'applied'
  },
  { immediate: true },
)
function makePreview() {
  preview.value = catalogPreview
  expired.value = false
  applied.value = false
}
function apply() {
  confirmOpen.value = false
  applied.value = true
}
const sum = (g: { added: number; changed: number }) => g.added + g.changed
</script>

<template>
  <ProtoFrame v-model:state="state" name="官方基础目录" :states="states">
    <OperationsShell :nav="systemNav('catalog')" :account="systemAccount" org="系统管理">
      <template #title><h1 class="title">官方基础目录</h1></template>

      <div class="obj page">
        <p class="hint intro">
          学科目录与院校名录是全平台共用的基础数据：学校开放学科、校内专业对照、新增学校都从这里选。更新时先预览差异，确认后整批导入。
        </p>

        <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取官方来源并比较差异…" />
        <StateBlock v-else-if="state === 'error'" kind="error" title="预览没有生成">
          官方来源快照读取失败或校验未通过，库内目录没有变化。
          <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
        </StateBlock>

        <template v-else>
          <div v-if="applied" class="banner banner--ok" role="status">
            <strong>已导入</strong>
            <span>学科新增 {{ catalogPreview.disciplines.added }}、变更 {{ catalogPreview.disciplines.changed }}；院校新增 {{ catalogPreview.institutions.added }}、变更 {{ catalogPreview.institutions.changed }}。</span>
          </div>

          <section v-if="!preview" class="sec">
            <div class="sec__head"><h3>更新目录</h3></div>
            <p class="hint">预览只读取与比较，不写入任何数据。</p>
            <div class="acts"><button type="button" class="btn btn--primary" @click="makePreview">生成预览</button></div>
          </section>

          <section v-else class="sec" :class="{ 'sec--attention': !applied }" aria-labelledby="pv-h">
            <div class="sec__head">
              <h3 id="pv-h">预览</h3>
              <StatusPill :tone="applied ? 'success' : expired ? 'danger' : 'warning'">{{ applied ? '已导入' : expired ? '预览已过期' : '预览未写入' }}</StatusPill>
            </div>
            <div v-if="expired" class="banner banner--danger" role="alert">
              <strong>没有导入：这份预览已失效</strong>
              <span>预览之后目录已被导入过，或官方来源快照已更新。整批没有写入，请重新生成预览后再确认。</span>
            </div>
            <div class="twrap">
              <table class="dtable counts">
                <thead><tr><th scope="col">目录</th><th scope="col" class="n">新增</th><th scope="col" class="n">变更</th><th scope="col" class="n">不变</th></tr></thead>
                <tbody>
                  <tr><th scope="row">学科</th><td class="n num">{{ preview.disciplines.added }}</td><td class="n num">{{ preview.disciplines.changed }}</td><td class="n num muted">{{ preview.disciplines.unchanged }}</td></tr>
                  <tr><th scope="row">院校</th><td class="n num">{{ preview.institutions.added }}</td><td class="n num">{{ preview.institutions.changed }}</td><td class="n num muted">{{ preview.institutions.unchanged }}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <h4 class="h4">来源</h4>
              <ul class="sources">
                <li v-for="src in preview.sources" :key="src.name"><span>{{ src.name }}</span><span class="muted num">版本 {{ src.version }}</span><a :href="src.url" target="_blank" rel="noopener noreferrer">查看来源</a></li>
              </ul>
            </div>
            <div v-if="!applied" class="acts acts--end">
              <button v-if="expired" type="button" class="btn btn--primary" @click="makePreview">重新生成预览</button>
              <template v-else>
                <button type="button" class="btn" @click="preview = null">放弃预览</button>
                <button type="button" class="btn btn--primary" :disabled="!sum(preview.disciplines) && !sum(preview.institutions)" @click="confirmOpen = true">确认导入…</button>
              </template>
            </div>
          </section>
          <ProtoNote contract="catalogs">
            previewCatalogImport() 不带参数，返回 fingerprint / disciplines / institutions / sources；applyCatalogImport(fingerprint)。接口不返回逐条变化，原型只展示计数；如需逐条核对，需另立接口。目录变更对已有学校设置的影响需在接线前核对后端。
          </ProtoNote>
        </template>
      </div>

      <ConfirmDialog :open="confirmOpen && Boolean(preview)" title="导入官方目录" @close="confirmOpen = false">
        <p>将写入学科 {{ preview && sum(preview.disciplines) }} 项、院校 {{ preview && sum(preview.institutions) }} 项变化，全平台立即生效。</p>
        <p class="muted">导入后，学校设置开放学科、对照校内专业和新增学校时的可选项随之更新。</p>
        <template #actions>
          <button type="button" class="btn" @click="confirmOpen = false">取消</button>
          <button type="button" class="btn btn--primary" @click="apply">确认导入</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.page {
  max-width: 880px;
}
.intro {
  max-width: 72ch;
}
.counts th[scope='row'] {
  font-weight: 500;
}
.h4 {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
}
.sources {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.sources li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.sources a {
  color: var(--ws-action);
}
</style>
