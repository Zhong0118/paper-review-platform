<script setup lang="ts">
/**
 * U4-8 官方基础目录（真实模式，P14b，E10）：/system/catalog。
 * 预览只读：服务端读取内置官方来源快照与库内目录比较，返回计数、来源与指纹；确认导入时带指纹。
 * 导入只新增与更新、不停用任何条目；指纹不符 409 时整批不写入，预览作废，只能重新预览。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { applyCatalogImport, previewCatalogImport, type ImportPreview } from '@/api/catalogs'
import { apiFailure } from '@/api/failure'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

const auth = useAuthStore()
let alive = true
onBeforeUnmount(() => (alive = false))

const preview = ref<ImportPreview | null>(null)
const previewing = ref(false)
const previewError = ref('')
const applying = ref(false)
const confirming = ref(false)
const expired = ref(false)
const applyError = ref('')
const applied = ref<ImportPreview | null>(null)

async function makePreview() {
  if (previewing.value || applying.value) return
  previewing.value = true
  previewError.value = ''
  applyError.value = ''
  try {
    const result = await previewCatalogImport({ quiet: true })
    if (!alive) return
    preview.value = result
    expired.value = false
    applied.value = null
  } catch (reason) {
    if (!alive) return
    previewError.value = apiFailure(reason).message
  } finally {
    if (alive) previewing.value = false
  }
}

function discard() {
  preview.value = null
  expired.value = false
  applyError.value = ''
}

const changes = (group: { added: number; changed: number }) => group.added + group.changed
const hasChanges = computed(() => Boolean(preview.value && (changes(preview.value.disciplines) || changes(preview.value.institutions))))

async function apply() {
  const current = preview.value
  if (!current || applying.value || expired.value) return
  applying.value = true
  applyError.value = ''
  try {
    await applyCatalogImport(current.fingerprint, { quiet: true })
    if (!alive) return
    confirming.value = false
    applied.value = current
    preview.value = null
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status === 409) {
      confirming.value = false
      expired.value = true
    } else applyError.value = failure.message
  } finally {
    if (alive) applying.value = false
  }
}

const rows = (p: ImportPreview) => [
  { key: 'disciplines', label: '学科', ...p.disciplines },
  { key: 'institutions', label: '院校', ...p.institutions },
]

const signOut = useSignOut()
const nav = computed(() => workspaceNav('system_admin', '/system/catalog'))
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '系统管理员', org: '系统管理' }))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="bare" title="官方基础目录" @sign-out="signOut">
      <template #context>学科目录与院校名录</template>

      <div class="page">
        <div class="wsd-obj catalog">
          <p class="wsd-hint intro">学科目录与院校名录是全平台共用的基础数据：学校开放学科、校内专业对照、新增学校都从这里选。更新时先预览差异，确认后整批导入。</p>

          <div v-if="applied" class="wsd-banner wsd-banner--ok" role="status" data-applied>
            <strong>已导入</strong>
            <span>学科新增 {{ applied.disciplines.added }}、变更 {{ applied.disciplines.changed }}；院校新增 {{ applied.institutions.added }}、变更 {{ applied.institutions.changed }}。</span>
          </div>

          <StatePanel v-if="previewing" kind="loading" title="正在读取官方来源并比较差异…" />
          <StatePanel v-else-if="previewError && !preview" kind="error" title="预览没有生成">
            {{ previewError }}。库内目录没有变化。
            <template #actions><Button type="button" data-action="preview-catalog" @click="makePreview">重试</Button></template>
          </StatePanel>

          <section v-else-if="!preview" class="wsd-sec">
            <div class="wsd-sec__head"><h3>更新目录</h3></div>
            <p class="wsd-hint">预览只读取与比较，不写入任何数据。</p>
            <div class="wsd-acts"><Button type="button" data-action="preview-catalog" @click="makePreview">生成预览</Button></div>
          </section>

          <section v-else class="wsd-sec wsd-sec--attention" aria-labelledby="pv-h" data-preview>
            <div class="wsd-sec__head">
              <h3 id="pv-h">预览</h3>
              <StatusPill :tone="expired ? 'danger' : 'warning'">{{ expired ? '预览已失效' : '预览未写入' }}</StatusPill>
            </div>
            <div v-if="expired" class="wsd-banner wsd-banner--danger" role="alert" data-expired>
              <strong>没有导入：这份预览已失效</strong>
              <span>预览之后目录已被导入过，或官方来源快照已更新。整批没有写入，请重新生成预览后再确认。</span>
            </div>
            <div class="wsd-twrap">
              <table class="wsd-dtable counts">
                <thead><tr><th scope="col">目录</th><th scope="col" class="wsd-n">新增</th><th scope="col" class="wsd-n">变更</th><th scope="col" class="wsd-n">不变</th></tr></thead>
                <tbody>
                  <tr v-for="row in rows(preview)" :key="row.key" :data-count="row.key">
                    <th scope="row">{{ row.label }}</th>
                    <td class="wsd-n num">{{ row.added }}</td>
                    <td class="wsd-n num">{{ row.changed }}</td>
                    <td class="wsd-n num muted">{{ row.unchanged }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <h4 class="h4">来源</h4>
              <ul class="sources">
                <li v-for="src in preview.sources" :key="src.url"><span>{{ src.name }}</span><span class="muted num">版本 {{ src.version }}</span><a :href="src.url" target="_blank" rel="noopener noreferrer">查看来源</a></li>
              </ul>
            </div>
            <p v-if="!hasChanges && !expired" class="wsd-hint" data-unchanged>官方来源与库内目录一致，不需要导入。</p>
            <p v-if="applyError && !confirming" class="field-error" role="alert">{{ applyError }}</p>
            <div class="wsd-acts wsd-acts--end">
              <Button v-if="expired" type="button" data-action="preview-catalog" @click="makePreview">重新生成预览</Button>
              <template v-else>
                <Button type="button" variant="outline" data-action="discard-preview" @click="discard">放弃预览</Button>
                <Button type="button" data-action="apply-catalog" :disabled="!hasChanges" @click="confirming = true; applyError = ''">确认导入…</Button>
              </template>
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog :open="confirming && Boolean(preview)" title="导入官方目录" :busy="applying" @close="!applying && (confirming = false)">
        <p>将写入学科 {{ preview && changes(preview.disciplines) }} 项、院校 {{ preview && changes(preview.institutions) }} 项变化，全平台立即生效。</p>
        <p class="muted">导入只新增与更新条目，不停用任何已有条目；各校已开放的学科与已建的学校不受影响，之后可选的范围随之更新。</p>
        <p v-if="applyError" class="field-error" role="alert">{{ applyError }}</p>
        <template #actions>
          <Button type="button" variant="outline" :disabled="applying" @click="confirming = false">取消</Button>
          <Button type="button" data-action="confirm-apply" :disabled="applying" @click="apply">{{ applying ? '正在导入…' : '确认导入' }}</Button>
        </template>
      </ConfirmDialog>
    </AppShell>
  </div>
</template>

<style scoped>
.page {
  min-height: calc(100svh - var(--bar-h));
}
/* form 模板：居中 960 */
.catalog {
  margin-inline: auto;
}
.intro {
  max-width: 72ch;
}
.muted {
  color: var(--ws-muted);
}
.counts th[scope='row'] {
  font-weight: 500;
}
.h4 {
  margin: 0 0 6px;
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
