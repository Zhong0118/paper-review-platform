<script setup lang="ts">
/**
 * P02 学生办理门户 + 真实信息创建表单（个人门户）。
 * 一个当前对象时不先给总量报表：首屏是“这篇论文到哪了、下一步做什么”。
 * 创建前先填真实题目/关键词/受控专业（v2.1 C-CREATE，BUG-07 开发报告已修复）。
 * 选项来自 GET /catalog/student-programs 与 GET /catalog/my-disciplines；POST /theses 带 program: {catalog_id, code} 或 discipline。
 * 论文信息草稿按不透明 content_revision 条件保存（C-SAVE，BUG-03）；删除草稿按 C-DELETE 文案（BUG-08）。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import SaveStatus from '../kit/SaveStatus.vue'
import { createDraftController } from '../kit/draftController'
import { thesisDraftTransport } from '../data/fakeTransports'

import PersonalShell from '../kit/PersonalShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import { accounts } from '../data/fixtures'

const states = [
  { value: 'none', label: '还没有论文' },
  { value: 'create-campus', label: '创建：校内专业目录' },
  { value: 'create-official', label: '创建：本校开放学科' },
  { value: 'create-nooptions', label: '创建：无可选专业' },
  { value: 'create-error', label: '创建：请求失败' },
  { value: 'create-conflict', label: '创建：已有论文' },
  { value: 'draft', label: '草稿未完成' },
  { value: 'edit-conflict', label: '草稿：另一页签已保存（冲突）' },
  { value: 'delete', label: '草稿：删除确认' },
  { value: 'deleted', label: '草稿已删除' },
  { value: 'returned', label: '学校退回' },
  { value: 'waiting', label: '学校核验中' },
  { value: 'published', label: '结果已发布' },
  { value: 'ineligible', label: '无送审资格' },
] as const
type S = (typeof states)[number]['value']
const state = useProtoState(states, 'none')
const creating = computed(() => state.value.startsWith('create'))

// GET /catalog/student-programs：校内专业目录项，提交时带 {catalog_id, code}
const campusPrograms = [
  { catalogId: 'cat-2026-r2', code: '081200', name: '计算机科学与技术（学术学位）', official: '0812 计算机科学与技术' },
  { catalogId: 'cat-2026-r2', code: '085400', name: '电子信息（专业学位）', official: '0854 电子信息' },
  { catalogId: 'cat-2026-r2', code: '083500', name: '软件工程（学术学位）', official: '0835 软件工程' },
]
// GET /catalog/my-disciplines：未绑定校内目录时本校开放的学科
const officialPrograms = ['0812 计算机科学与技术', '0835 软件工程', '0854 电子信息', '0705 地理学']

const form = reactive({ title: '', keywords: '', program: '', abstract: '' })
const touched = ref(false)
const pending = ref(false)
const failure = ref<'' | 'error' | 'conflict'>('')
watch(state, (s) => {
  failure.value = ''
  touched.value = false
  if (s === 'create-campus' || s === 'create-official') form.program = ''
})
const mode = computed(() => (state.value === 'create-official' ? 'official' : state.value === 'create-nooptions' ? 'none' : 'campus'))
const rawKeywords = computed(() => form.keywords.split(/[，,、;；\s]+/).map((k) => k.trim()).filter(Boolean))
/** 去重后 1–5 个 */
const keywordList = computed(() => [...new Set(rawKeywords.value)])
const keywordDupes = computed(() => rawKeywords.value.length - keywordList.value.length)
const mapped = computed(() => campusPrograms.find((p) => p.code === form.program)?.official ?? '')
const errors = computed(() => ({
  title: form.title.trim().length < 4 ? '请填写论文题目' : '',
  keywords: keywordList.value.length < 1 || keywordList.value.length > 5 ? '请填写 1–5 个不重复的关键词' : '',
  program: mode.value !== 'none' && !form.program ? '请选择专业' : '',
}))
const valid = computed(() => !errors.value.title && !errors.value.keywords && !errors.value.program && mode.value !== 'none')

async function create() {
  touched.value = true
  if (!valid.value || pending.value) return
  pending.value = true
  failure.value = ''
  await new Promise((r) => setTimeout(r, 700))
  pending.value = false
  if (state.value === 'create-error') failure.value = 'error'
  else if (state.value === 'create-conflict') failure.value = 'conflict'
  else state.value = 'draft'
}
function start() {
  state.value = 'create-campus'
}

const current = computed(() => {
  const s = state.value as S
  if (s === 'draft' || s === 'edit-conflict' || s === 'delete') return { pill: '草稿', tone: 'neutral' as const, next: '补齐材料后提交给学校核验', action: '继续编辑' }
  if (s === 'returned') return { pill: '已退回', tone: 'warning' as const, next: '按学校的退回原因修改后重新提交', action: '修改这份论文' }
  if (s === 'waiting') return { pill: '学校核验中', tone: 'action' as const, next: '等待学校处理，现在不需要你操作', action: '' }
  if (s === 'published') return { pill: '结果已发布', tone: 'success' as const, next: '阅读专家的正式反馈；如有异议可以在反馈页登记', action: '阅读正式反馈' }
  return null
})
const moreOpen = ref(false)

// 论文信息草稿：content_revision 是不透明字符串，原样回传，不解析不加 1
type Info = { title: string; abstract: string }
const infoInitial: Info = {
  title: '面向边缘计算的容错任务调度方法研究',
  abstract: '针对边缘计算环境中节点失效相关性被忽视的问题，提出按任务关键度分级的副本放置策略。',
}
const info = reactive<Info>({ ...infoInitial })
const infoDraft = createDraftController<Info, string>({
  initial: infoInitial,
  revision: 'cr_7f3a91e2',
  debounceMs: 800,
  save: thesisDraftTransport<Info>(
    () => (state.value === 'edit-conflict' ? 'conflict' : 'ok'),
    (mine) => ({ ...mine, abstract: `${infoInitial.abstract}在另一页签补充：实验覆盖模拟与真实集群。` }),
  ),
})
watch(info, (value) => infoDraft.update(value), { deep: true })
onBeforeUnmount(() => infoDraft.dispose())
const infoCopied = ref(false)
function copyInfo() {
  void navigator.clipboard?.writeText(`论文题目\n${info.title}\n\n摘要\n${info.abstract}`)
  infoCopied.value = true
}
function useServerInfo() {
  infoDraft.acceptServer()
  Object.assign(info, infoDraft.local.value)
}
const infoDiff = computed(() => {
  const server = infoDraft.conflict.value?.server
  if (!server) return []
  return (['title', 'abstract'] as const)
    .filter((k) => server[k] !== info[k])
    .map((k) => ({ key: k, label: k === 'title' ? '论文题目' : '摘要', mine: info[k], server: server[k] }))
})
watch(
  state,
  (s) => {
    infoCopied.value = false
    if (s === 'edit-conflict' && infoDraft.state.value !== 'conflict') {
      info.abstract = `${infoInitial.abstract}本页补充：第五章增加敏感性分析。`
      void infoDraft.flush()
    }
  },
  { immediate: true },
)

const isDraft = computed(() => state.value === 'draft' || state.value === 'edit-conflict' || state.value === 'delete')
const deleteOpen = computed(() => state.value === 'delete')
const deleting = ref(false)
async function confirmDelete() {
  deleting.value = true
  await new Promise((r) => setTimeout(r, 600))
  deleting.value = false
  state.value = 'deleted'
}
</script>

<template>
  <ProtoFrame v-model:state="state" name="学生办理门户" :states="states">
    <PersonalShell :nav="[{ label: '我的送审', to: '/prototype/student', active: true }, { label: '正式反馈', to: '/prototype/feedback' }]" :account="accounts.student">
      <header class="page-head">
        <h1>我的送审</h1>
        <p class="batch"><span>2026 年秋季学位论文送审</span><span class="muted">收件截止 11 月 30 日</span></p>
      </header>

      <!-- 无资格 -->
      <StateBlock v-if="state === 'ineligible'" kind="unconfigured" title="你目前没有本批次的送审资格">
        送审资格由学校维护。如果你认为有误，请联系学院研究生秘书。已有的历史论文仍可在下方查看。
      </StateBlock>

      <!-- 无论文 -->
      <section v-else-if="state === 'none'" class="empty">
        <h2>还没有论文</h2>
        <p class="muted">你已具备本批次的送审资格。开始前请准备好论文题目、关键词和所属专业；原稿与匿名稿可以在下一步上传。</p>
        <button type="button" class="btn btn--primary" @click="start">开始送审</button>
      </section>

      <!-- 创建表单 -->
      <section v-else-if="creating" class="create" aria-labelledby="create-h">
        <div class="create__head">
          <h2 id="create-h">开始送审</h2>
          <button type="button" class="btn btn--quiet" @click="state = 'none'">取消</button>
        </div>

        <div v-if="failure === 'error'" class="banner banner--danger" role="alert">
          <strong>没有创建成功：服务暂时不可用。</strong><span>你填写的内容还在，可以直接重试。</span>
        </div>
        <div v-else-if="failure === 'conflict'" class="banner banner--info" role="alert">
          <strong>你在本批次已经有一篇论文，不能再新建。</strong>
          <span>《面向边缘计算的容错任务调度方法研究》。打开时按它现在的状态显示。</span>
          <button type="button" class="btn btn--sm" @click="state = 'waiting'">打开已有论文</button>
          <ProtoNote contract="C-CREATE">冲突响应 data.id 定位已有论文，再重新读取其真实状态（本例为已提交、学校核验中），不假定它是草稿。</ProtoNote>
        </div>

        <form class="create__form" novalidate @submit.prevent="create">
          <label class="field">
            <span>论文题目</span>
            <input v-model="form.title" class="input" :aria-invalid="touched && Boolean(errors.title)" aria-describedby="e-title" />
            <span v-if="touched && errors.title" id="e-title" class="field-error">{{ errors.title }}</span>
          </label>
          <label class="field">
            <span>关键词</span>
            <input v-model="form.keywords" class="input" placeholder="用逗号或顿号分隔" :aria-invalid="touched && Boolean(errors.keywords)" aria-describedby="e-kw" />
            <small>已识别 {{ keywordList.length }} 个：{{ keywordList.join('、') || '无' }}<template v-if="keywordDupes">（已去掉 {{ keywordDupes }} 个重复）</template></small>
            <span v-if="touched && errors.keywords" id="e-kw" class="field-error">{{ errors.keywords }}</span>
          </label>

          <div v-if="mode === 'campus'" class="field">
            <label for="prog"><span class="lbl">专业</span></label>
            <select id="prog" v-model="form.program" class="select" :aria-invalid="touched && Boolean(errors.program)" aria-describedby="prog-src e-prog">
              <option value="">请选择校内专业</option>
              <option v-for="p in campusPrograms" :key="p.code" :value="p.code">{{ p.code }} {{ p.name }}</option>
            </select>
            <small id="prog-src">选项来自学校维护的校内专业目录</small>
            <span v-if="touched && errors.program" id="e-prog" class="field-error">{{ errors.program }}</span>
            <p class="mapped"><span class="muted">对应官方学科</span><strong>{{ mapped || '选择专业后显示' }}</strong></p>
          </div>
          <div v-else-if="mode === 'official'" class="field">
            <label for="prog2"><span class="lbl">学科</span></label>
            <select id="prog2" v-model="form.program" class="select" :aria-invalid="touched && Boolean(errors.program)">
              <option value="">请选择本校开放的学科</option>
              <option v-for="p in officialPrograms" :key="p" :value="p">{{ p }}</option>
            </select>
            <small>学校尚未为本批次绑定校内专业目录，按本校开放的官方学科选择。</small>
            <span v-if="touched && errors.program" class="field-error">{{ errors.program }}</span>
          </div>
          <StateBlock v-else kind="unconfigured" title="本批次还没有可选的专业" compact>
            学校还没有为本批次维护专业目录或开放学科，暂时不能开始送审。请联系学院研究生秘书。
          </StateBlock>

          <label class="field">
            <span>摘要</span>
            <textarea v-model="form.abstract" class="textarea" placeholder="可以现在填写，也可以在编辑页补充" />
          </label>
          <ProtoNote contract="C-CREATE">
            提交真实题目、1–5 个去重关键词，以及 program: {catalog_id, code} 或本校开放学科（BUG-07，开发报告已修复，未合入本工作树）。
            暂停的资格只影响新建，不影响已有论文。字段名以修复快照的接口类型为准。
          </ProtoNote>

          <div class="create__actions">
            <button type="submit" class="btn btn--primary" :disabled="pending || mode === 'none'">{{ pending ? '正在创建…' : '创建并继续' }}</button>
            <span class="muted">创建后进入编辑页上传原稿与匿名稿。</span>
          </div>
        </form>
      </section>

      <!-- 删除后 -->
      <section v-else-if="state === 'deleted'" class="empty" role="status">
        <h2>草稿已删除</h2>
        <p class="muted">这份草稿已从你的论文列表移除。你仍有本批次的送审资格，可以重新开始送审。</p>
        <button type="button" class="btn btn--primary" @click="start">重新开始送审</button>
      </section>

      <!-- 当前论文 -->
      <section v-else-if="current" class="current" aria-labelledby="cur-h">
        <div class="current__top">
          <StatusPill :tone="current.tone">{{ current.pill }}</StatusPill>
          <div class="more">
            <button type="button" class="btn btn--sm btn--quiet" aria-haspopup="menu" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">更多</button>
            <div v-if="moreOpen" class="more__menu" role="menu">
              <button v-if="isDraft" type="button" role="menuitem" class="danger" @click="moreOpen = false; state = 'delete'">删除这份草稿…</button>
              <button v-if="state === 'waiting'" type="button" role="menuitem">撤回提交…</button>
              <button type="button" role="menuitem">查看处理记录</button>
            </div>
          </div>
        </div>
        <h2 id="cur-h" class="current__title">面向边缘计算的容错任务调度方法研究</h2>
        <p class="muted current__prog">0812 计算机科学与技术</p>

        <div v-if="state === 'returned'" class="returned">
          <p class="returned__who">学校退回了这篇论文，原因：</p>
          <blockquote>匿名稿第 3 页致谢中出现“周老师”，第 7 页出现“东湖校区实验平台”，请删除或改为不可识别的表述后重新上传匿名稿。</blockquote>
        </div>

        <div class="next">
          <div>
            <p class="next__label muted">下一步</p>
            <p class="next__text">{{ current.next }}</p>
          </div>
          <button v-if="current.action" type="button" class="btn btn--primary">{{ current.action }}</button>
        </div>

        <section v-if="isDraft" class="info" aria-labelledby="info-h">
          <div class="info__head">
            <h3 id="info-h">论文信息</h3>
            <SaveStatus :state="infoDraft.state.value" :saved-at="infoDraft.savedAt.value" />
          </div>
          <div v-if="infoDraft.state.value === 'conflict'" class="banner banner--danger" role="alert">
            <strong>论文信息在另一个页签或设备上保存过更新的内容。</strong>
            <span>本页修改没有覆盖它，自动保存已暂停。先复制本页内容，再决定是否使用服务器版本。</span>
            <div v-for="d in infoDiff" :key="d.key" class="diff">
              <p class="diff__label">{{ d.label }}</p>
              <div class="diff__cols">
                <div><span class="muted">本页</span><p>{{ d.mine }}</p></div>
                <div><span class="muted">服务器</span><p>{{ d.server }}</p></div>
              </div>
            </div>
            <span class="banner__actions">
              <button type="button" class="btn btn--sm" @click="copyInfo">{{ infoCopied ? '已复制' : '复制本页内容' }}</button>
              <button type="button" class="btn btn--sm" :disabled="!infoCopied" @click="useServerInfo">使用服务器版本</button>
            </span>
            <ProtoNote contract="C-SAVE">论文草稿按不透明 content_revision 条件保存（BUG-03，开发报告已修复，未合入本工作树）；冲突后不自动重新套用指纹。</ProtoNote>
          </div>
          <label class="field">
            <span>论文题目</span>
            <input v-model="info.title" class="input" :disabled="infoDraft.state.value === 'conflict'" />
          </label>
          <label class="field">
            <span>摘要</span>
            <textarea v-model="info.abstract" class="textarea" :disabled="infoDraft.state.value === 'conflict'" />
          </label>
        </section>

        <dl v-if="isDraft" class="materials">
          <div><dt>论文信息</dt><dd><StatusPill tone="success">已填写</StatusPill></dd></div>
          <div><dt>原稿</dt><dd><StatusPill tone="success">已上传</StatusPill></dd></div>
          <div><dt>匿名稿</dt><dd><StatusPill tone="warning">未上传</StatusPill></dd></div>
          <div><dt>匿名检测</dt><dd><StatusPill>未运行</StatusPill></dd></div>
        </dl>
        <ProtoNote v-if="isDraft" contract="C-DELETE">
          删除只对从未提交过的草稿出现；检测或 PDF 变换之后同样可以删除（BUG-08，开发报告已修复，未合入本工作树）。不提供回收站或恢复。
        </ProtoNote>
        <p v-if="state === 'returned'" class="muted small">这篇论文提交过，不能删除；修改后会重新进入学校核验。你的身份信息由学校维护，此处只读。</p>

        <div v-if="state === 'published'" class="verdict">
          <p><strong>修改后通过</strong><span class="num">总分 74 / 100</span></p>
        </div>

        <section class="log" aria-label="处理记录">
          <h3>处理记录</h3>
          <ol>
            <li v-if="state === 'published'">学校发布了评阅结果</li>
            <li v-if="state === 'returned'">学校退回修改</li>
            <li v-if="!isDraft">你提交了论文</li>
            <li>你创建了这篇论文</li>
          </ol>
          <ProtoNote contract="C-EVENTS">recent_events 当前不带时间，原型只列先后，不编造时间。</ProtoNote>
        </section>
      </section>

      <section class="others" aria-label="其他论文">
        <h2>其他论文</h2>
        <ul>
          <li>
            <span><strong>边缘缓存替换策略的实验比较</strong><span class="muted">2025 年春季学位论文送审</span></span>
            <StatusPill tone="success">结果已发布</StatusPill>
            <RouterLink class="btn btn--sm" to="/prototype/feedback">查看反馈</RouterLink>
          </li>
        </ul>
      </section>
    </PersonalShell>

    <ConfirmDialog :open="deleteOpen" title="删除这份草稿？" @close="state = 'draft'">
      <p>删除后，该草稿将从你的论文列表移除，可以重新建稿；必要的检测、材料处理与审计记录仍按平台规则保留。此操作不提供自助恢复。</p>
      <template #actions>
        <button type="button" class="btn" :disabled="deleting" @click="state = 'draft'">保留草稿</button>
        <button type="button" class="btn btn--danger" :disabled="deleting" @click="confirmDelete">{{ deleting ? '正在删除…' : '删除草稿' }}</button>
      </template>
    </ConfirmDialog>
  </ProtoFrame>
</template>

<style scoped>
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 20px;
}
.page-head h1 {
  font-size: 22px;
  font-weight: 650;
}
.batch {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 13px;
}
.empty,
.create,
.current {
  display: grid;
  gap: 14px;
  padding: 24px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.empty {
  justify-items: start;
}
.empty h2,
.create h2 {
  font-size: 17px;
  font-weight: 600;
}
.empty p {
  max-width: 56ch;
}
.create__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.create__form {
  display: grid;
  gap: 16px;
  max-width: 620px;
}
.lbl {
  font-size: 13px;
  font-weight: 500;
}
.mapped {
  display: flex;
  gap: 12px;
  margin-top: 2px;
  padding: 8px 10px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  font-size: 13px;
}
.create__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  font-size: 13px;
}
.banner {
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 10px 12px;
  border-left: 3px solid var(--ws-action);
  background: var(--ws-action-soft);
  font-size: 13px;
}
.banner--danger {
  border-left-color: var(--ws-danger);
  background: var(--ws-danger-soft);
}
.current__top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.current__title {
  font-size: 20px;
  font-weight: 650;
  line-height: 1.45;
}
.current__prog {
  margin-top: -8px;
  font-size: 13px;
}
.more {
  position: relative;
  margin-left: auto;
}
.more__menu {
  position: absolute;
  z-index: 10;
  right: 0;
  min-width: 180px;
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
  text-align: left;
  cursor: pointer;
}
.more__menu button:hover {
  background: var(--ws-sunken);
}
.more__menu .danger {
  color: var(--ws-danger);
}
.returned {
  padding: 12px 14px;
  border-left: 3px solid var(--ws-warning);
  background: var(--ws-warning-soft);
}
.returned__who {
  font-size: 13px;
}
.returned blockquote {
  margin: 6px 0 0;
  line-height: 1.7;
}
.next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-block: 1px solid var(--ws-border);
}
.next__label {
  font-size: 12px;
}
.next__text {
  font-size: 15px;
  font-weight: 500;
}
.info {
  display: grid;
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--ws-border);
}
.info__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
}
.info__head h3 {
  font-size: 15px;
  font-weight: 600;
}
.banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.diff {
  display: grid;
  gap: 4px;
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
  font-size: 13px;
}
.materials {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin: 0;
}
.materials div {
  display: grid;
  gap: 4px;
}
.materials dt {
  color: var(--ws-muted);
  font-size: 12px;
}
.materials dd {
  margin: 0;
}
.verdict p {
  display: flex;
  gap: 16px;
  align-items: baseline;
  font-size: 18px;
}
.small {
  font-size: 12px;
}
.log h3,
.others h2 {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}
.log ol {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.log li {
  display: flex;
  gap: 16px;
}
.log li span {
  min-width: 88px;
  color: var(--ws-muted);
}
.others {
  margin-top: 28px;
}
.others ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--ws-border);
}
.others li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--ws-border);
}
.others li > span:first-child {
  display: grid;
  flex: 1;
  min-width: 200px;
  font-size: 13px;
}
@media (max-width: 640px) {
  .empty,
  .create,
  .current {
    padding: 16px;
  }
  .next .btn {
    width: 100%;
  }
}
@media (max-width: 640px) {
  .diff__cols {
    grid-template-columns: 1fr;
  }
}
</style>
