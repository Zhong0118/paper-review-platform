<script setup lang="ts">
/**
 * P10 正式反馈（个人门户阅读版心）：只读已发布快照。
 * 阅读顺序：论文与发布元数据 → 结论与总分 → 总体评价 → 主要问题 → 修改建议 → 分项评分 → 异议（仅学生）。
 * 发布快照 schema（v2.1 C-RESULT，BUG-04 开发报告已修复）：
 *   v1 无版本标记 → “此历史发布版本未收录修改建议”；v2（snapshot_schema_version: 2）带 revision_advice，
 *   空字符串 → “未填写修改建议”；格式错误或未知版本 → 按接口错误处理，不猜。
 * 不展示 strengths、分项评价文字与完整评语；所有文本按纯文本插值渲染（不使用 v-html）；不猜发布日期。
 */
import { computed, ref } from 'vue'

import PersonalShell from '../kit/PersonalShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import { accounts, feedback, supervisedStudents } from '../data/fixtures'

const states = [
  { value: 'student', label: '学生：v2 含修改建议' },
  { value: 'v2-empty', label: '学生：v2 未填写修改建议' },
  { value: 'legacy', label: '学生：v1 历史发布版本' },
  { value: 'malformed', label: '学生：快照格式无法识别' },
  { value: 'correction', label: '学生：更正待学校确认' },
  { value: 'corrected', label: '学生：更正已确认' },
  { value: 'objection', label: '学生：已有未结异议' },
  { value: 'supervisor', label: '导师：只读' },
  { value: 'unpublished', label: '未发布' },
] as const
const state = useProtoState(states, 'student')
const isSupervisor = computed(() => state.value === 'supervisor')
const account = computed(() => (isSupervisor.value ? accounts.supervisor : accounts.student))
const nav = computed(() =>
  isSupervisor.value
    ? [{ label: '学生评审结果', to: '/prototype/feedback?state=supervisor', active: true }]
    : [{ label: '我的送审', to: '/prototype/student' }, { label: '正式反馈', to: '/prototype/feedback', active: true }],
)
const studentId = ref('s1')

/** 已发布快照的修改建议字段，按 schema 版本解读 */
type Snapshot = { snapshot_schema_version?: unknown; revision_advice?: unknown }
type Advice = { kind: 'v1' } | { kind: 'v2'; text: string } | { kind: 'invalid' }
function readAdvice(snap: Snapshot): Advice {
  if (snap.snapshot_schema_version === undefined) return 'revision_advice' in snap ? { kind: 'invalid' } : { kind: 'v1' }
  if (snap.snapshot_schema_version === 2 && typeof snap.revision_advice === 'string') return { kind: 'v2', text: snap.revision_advice }
  return { kind: 'invalid' }
}
const snapshot = computed<Snapshot>(() => {
  switch (state.value) {
    case 'legacy':
      return {}
    case 'v2-empty':
      return { snapshot_schema_version: 2, revision_advice: '' }
    case 'malformed':
      return { snapshot_schema_version: 3, revision_advice: feedback.advice }
    case 'corrected':
      return { snapshot_schema_version: 2, revision_advice: correctedAdvice }
    default:
      return { snapshot_schema_version: 2, revision_advice: feedback.advice }
  }
})
const advice = computed(() => readAdvice(snapshot.value))
const correctedAdvice = `${feedback.advice}\n（更正）第四章的假设对照可放在附录，不必改动正文结构。`

const objectionText = ref('')
const objectionSent = ref(false)
const objectionOpen = computed(() => state.value === 'objection' || objectionSent.value)
</script>

<template>
  <ProtoFrame v-model:state="state" name="正式反馈" :states="states">
    <PersonalShell :nav="nav" :account="account" width="reading">
      <div v-if="isSupervisor" class="picker">
        <label for="stu">学生</label>
        <select id="stu" v-model="studentId" class="select">
          <option v-for="s in supervisedStudents" :key="s.id" :value="s.id">{{ s.name }}：{{ s.title }}</option>
        </select>
        <span class="muted">只列出你指导的、结果已发布的学生</span>
      </div>

      <StateBlock v-if="state === 'unpublished'" kind="empty" title="这篇论文的评阅结果还没有发布">
        学校发布后会在这里显示正式反馈。发布前看不到分数或评语，这不代表评阅进度。
        <template #actions><RouterLink class="btn" to="/prototype/student?state=waiting">回到我的送审</RouterLink></template>
      </StateBlock>

      <StateBlock v-else-if="advice.kind === 'invalid'" kind="error" title="这份评阅结果暂时无法显示">
        结果数据的格式无法识别，为避免显示错误内容，本页没有展示任何部分。请稍后再试；如果一直如此，请联系学校。
        <template #actions><RouterLink class="btn" to="/prototype/student?state=published">回到我的送审</RouterLink></template>
      </StateBlock>

      <article v-else class="paper">
        <div v-if="state === 'correction'" class="notice" role="status">
          评阅专家提出的更正正在处理。学校确认前，你看到的仍是当前已发布的版本；确认后这里会显示新的发布版本。
        </div>
        <div v-else-if="state === 'corrected'" class="notice" role="status">
          这是学校确认更正后的发布版本。更正前的版本仍保留在记录中，不会被删除。
        </div>

        <header class="paper__head">
          <p class="paper__ctx muted"><span>{{ feedback.batch }}</span><span>{{ feedback.program }}</span></p>
          <h1 class="paper__title">{{ isSupervisor && studentId === 's2' ? supervisedStudents[1]!.title : feedback.title }}</h1>
          <p class="paper__meta muted">第 1 轮评阅，1 位匿名专家</p>
          <ProtoNote contract="C-RESULT">
            按发布快照 schema v1/v2 解读修改建议（BUG-04，开发报告已修复，未合入本工作树）。发布日期以接口实际字段为准，原型不显示，也不用本地读取时间代替。
            更正确认后追加一次新发布，学校无需另行发布。
          </ProtoNote>
        </header>

        <section class="verdict" aria-label="评阅结论">
          <div>
            <p class="verdict__label">结论</p>
            <p class="verdict__value">{{ feedback.outcome }}</p>
          </div>
          <div>
            <p class="verdict__label">总分</p>
            <p class="verdict__value num">{{ feedback.total }}<small> / 100</small></p>
          </div>
          <div>
            <p class="verdict__label">专家建议</p>
            <p class="verdict__value verdict__value--sm">{{ feedback.recommendation }}</p>
          </div>
        </section>

        <section class="block">
          <h2>总体评价</h2>
          <p>{{ feedback.overall }}</p>
        </section>
        <section class="block">
          <h2>主要问题</h2>
          <p class="pre">{{ feedback.issues }}</p>
        </section>
        <section class="block">
          <h2>修改建议</h2>
          <p v-if="advice.kind === 'v1'" class="missing">此历史发布版本未收录修改建议。它发布于该项加入之前，不代表专家没有提出建议。</p>
          <p v-else-if="advice.kind === 'v2' && !advice.text.trim()" class="missing">未填写修改建议。</p>
          <p v-else-if="advice.kind === 'v2'" class="pre">{{ advice.text }}</p>
        </section>

        <section class="block">
          <h2>分项评分</h2>
          <p class="muted small">只显示各项得分；专家的分项评价文字不对外发布。</p>
          <table class="scores">
            <tbody>
              <tr v-for="s in feedback.scores" :key="s.label">
                <th scope="row">{{ s.label }}</th>
                <td class="bar"><span :style="{ width: `${(s.score / s.max) * 100}%` }" /></td>
                <td class="num">{{ s.score }} <span class="muted">/ {{ s.max }}</span></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="!isSupervisor" class="objection" aria-labelledby="obj-h">
          <h2 id="obj-h">对这份结果有异议？</h2>
          <template v-if="objectionOpen">
            <p role="status"><StatusPill tone="action">学校处理中</StatusPill> 你登记的异议正在由学校处理，处理完成后会在这里显示结论。</p>
          </template>
          <template v-else>
            <p class="muted">异议由学校处理。登记异议不会自动改变分数，也不会让专家重新评阅。</p>
            <label class="field">
              <span>异议内容</span>
              <textarea v-model="objectionText" class="textarea" placeholder="写明你对哪一部分有异议，以及理由" />
            </label>
            <button type="button" class="btn btn--primary" :disabled="objectionText.trim().length < 10" @click="objectionSent = true">提交异议</button>
          </template>
        </section>
      </article>
    </PersonalShell>
  </ProtoFrame>
</template>

<style scoped>
.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin-bottom: 20px;
  font-size: 13px;
}
.picker .select {
  width: auto;
  max-width: 100%;
}
.paper {
  display: grid;
  gap: 28px;
  padding: 40px 56px 48px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.notice {
  padding: 10px 14px;
  border-left: 3px solid var(--ws-action);
  background: var(--ws-action-soft);
  font-size: 14px;
  line-height: 1.7;
}
.paper__head {
  display: grid;
  gap: 8px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ws-border);
}
.paper__ctx {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 13px;
}
.paper__title {
  font-family: var(--ws-font-reading);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.4;
}
.paper__meta {
  font-size: 13px;
}
.verdict {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 48px;
  padding: 18px 20px;
  border-radius: var(--ws-radius-panel);
  background: var(--ws-page);
}
.verdict__label {
  color: var(--ws-muted);
  font-size: 12px;
}
.verdict__value {
  font-size: 24px;
  font-weight: 650;
  line-height: 1.3;
}
.verdict__value small {
  color: var(--ws-muted);
  font-size: 14px;
  font-weight: 400;
}
.verdict__value--sm {
  font-size: 18px;
}
.block {
  max-width: 42em;
}
.block h2,
.objection h2 {
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 650;
}
.block p {
  font-size: 16px;
  line-height: 1.8;
}
.small {
  margin-bottom: 6px;
  font-size: 13px !important;
}
.pre {
  white-space: pre-line;
}
.missing {
  padding: 10px 14px;
  border: 1px dashed var(--ws-border-strong);
  border-radius: var(--ws-radius);
  color: var(--ws-muted);
  font-size: 14px !important;
}
.scores {
  width: 100%;
  max-width: 560px;
  border-collapse: collapse;
}
.scores th {
  width: 9em;
  padding: 8px 0;
  font-weight: 400;
  text-align: left;
}
.scores td {
  padding: 8px 0 8px 12px;
  white-space: nowrap;
}
.bar {
  width: 100%;
}
.bar span {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: var(--ws-action);
  opacity: 0.75;
}
.objection {
  display: grid;
  gap: 10px;
  justify-items: start;
  max-width: 42em;
  padding-top: 24px;
  border-top: 1px solid var(--ws-border);
}
.objection .field {
  width: 100%;
}
@media (max-width: 640px) {
  .paper {
    padding: 22px 18px 28px;
  }
  .paper__title {
    font-size: 21px;
  }
  .verdict {
    gap: 12px 28px;
  }
}
</style>
