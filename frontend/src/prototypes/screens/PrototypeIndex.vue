<script setup lang="ts">
/** U1 原型索引：五组可点击原型与各自可切换的关键状态。 */
import { useRoute } from 'vue-router'

import BrandMark from '../kit/BrandMark.vue'
import '../kit/tokens.css'

const route = useRoute()
const groups = [
  {
    title: '学校：送审准备队列 → 核验台',
    space: '处理工作空间 → 专注',
    to: '/prototype/school',
    desc: '队列视图计数、非模态预览；核验台把发现目录、匿名稿/原稿与判断放在同一对象上，通过核验与确认送出分开。',
    states: [
      { label: '有待办', to: '/prototype/school' },
      { label: '筛选无匹配', to: '/prototype/school?q=量子' },
      { label: '加载失败', to: '/prototype/school?state=error' },
      { label: '自动：需人工复核', to: '/prototype/school/verify?thesis=t01' },
      { label: '自动：未发现线索', to: '/prototype/school/verify?thesis=t02&state=pass' },
      { label: '自动：不通过', to: '/prototype/school/verify?thesis=t03&state=fail' },
      { label: '上次通过＋报告过期', to: '/prototype/school/verify?thesis=t04&state=stale' },
      { label: '已被他人处理', to: '/prototype/school/verify?thesis=t01&state=taken' },
      { label: '版本冲突', to: '/prototype/school/verify?thesis=t01&state=conflict' },
      { label: '永久终止', to: '/prototype/school/verify?thesis=t01&state=terminate' },
    ],
  },
  {
    title: '平台：派单台',
    space: '处理工作空间',
    to: '/prototype/dispatch',
    desc: '论文清单与候选比较并排；单选指派，区分无专家记录、全员不可派与请求失败；改派与拒绝后重新指派是不同命令。',
    states: [
      { label: '有候选', to: '/prototype/dispatch' },
      { label: '无专家记录', to: '/prototype/dispatch?state=norecords' },
      { label: '全员不可派', to: '/prototype/dispatch?state=allblocked' },
      { label: '加载失败', to: '/prototype/dispatch?state=error' },
      { label: '档案已变', to: '/prototype/dispatch?state=conflict' },
      { label: '改派确认', to: '/prototype/dispatch?state=reassign' },
    ],
  },
  {
    title: '专家：专注评阅',
    space: '专注工作空间',
    to: '/prototype/review',
    desc: '匿名稿与评阅区分栏可调；保存状态常驻；保存并退出先等待保存确认；冲突时列出两边差异、暂停自动保存；更正稿手动保存。',
    states: [
      { label: '正常保存', to: '/prototype/review' },
      { label: '保存较慢', to: '/prototype/review?state=slow' },
      { label: '保存失败', to: '/prototype/review?state=fail' },
      { label: '冲突', to: '/prototype/review?state=conflict' },
      { label: '提交确认', to: '/prototype/review?state=submit' },
      { label: '已提交只读', to: '/prototype/review?state=submitted' },
      { label: '任务已不在名下', to: '/prototype/review?state=cancelled' },
      { label: '更正：手动保存', to: '/prototype/review?state=correction' },
      { label: '更正：保存失败', to: '/prototype/review?state=correction-fail' },
      { label: '更正：版本冲突', to: '/prototype/review?state=correction-conflict' },
    ],
  },
  {
    title: '学生：我的送审与创建',
    space: '个人门户',
    to: '/prototype/student',
    desc: '首屏是当前论文的状态与下一步；创建前填写真实题目、1–5 个关键词与受控专业，失败保留输入；草稿可删除并重新建稿。',
    states: [
      { label: '还没有论文', to: '/prototype/student' },
      { label: '创建：校内目录', to: '/prototype/student?state=create-campus' },
      { label: '创建：官方学科', to: '/prototype/student?state=create-official' },
      { label: '创建：无选项', to: '/prototype/student?state=create-nooptions' },
      { label: '创建：失败', to: '/prototype/student?state=create-error' },
      { label: '创建：已有论文', to: '/prototype/student?state=create-conflict' },
      { label: '草稿', to: '/prototype/student?state=draft' },
      { label: '草稿保存冲突', to: '/prototype/student?state=edit-conflict' },
      { label: '删除确认', to: '/prototype/student?state=delete' },
      { label: '删除后', to: '/prototype/student?state=deleted' },
      { label: '已退回', to: '/prototype/student?state=returned' },
      { label: '核验中', to: '/prototype/student?state=waiting' },
      { label: '已发布', to: '/prototype/student?state=published' },
    ],
  },
  {
    title: '学生与导师：正式反馈',
    space: '个人门户（阅读版心）',
    to: '/prototype/feedback',
    desc: '先结论与总分，再完整段落；修改建议按发布快照 v1/v2 如实说明；导师只读、没有异议入口。',
    states: [
      { label: 'v2 含修改建议', to: '/prototype/feedback' },
      { label: 'v2 未填写', to: '/prototype/feedback?state=v2-empty' },
      { label: 'v1 历史版本', to: '/prototype/feedback?state=legacy' },
      { label: '格式无法识别', to: '/prototype/feedback?state=malformed' },
      { label: '更正待确认', to: '/prototype/feedback?state=correction' },
      { label: '更正已确认', to: '/prototype/feedback?state=corrected' },
      { label: '已有异议', to: '/prototype/feedback?state=objection' },
      { label: '导师只读', to: '/prototype/feedback?state=supervisor' },
      { label: '未发布', to: '/prototype/feedback?state=unpublished' },
    ],
  },
]
</script>

<template>
  <div class="ws index">
    <header class="index__head">
      <BrandMark subtitle="U1 交互原型" />
    </header>
    <main class="index__main">
      <div class="intro">
        <h1>五组可点击原型</h1>
        <p class="muted">
          全部为虚构数据，不连接真实接口。行为按修复后合同 v2.1 模拟；修复由开发 Agent 报告完成、尚未合入本工作树，相关处以“原型注”标出。对应清单见
          docs/superpowers/specs/2026-11-04-ui-redesign-u0-function-map.md。
        </p>
        <p v-if="route.query.left === 'review'" class="left" role="status">已保存并退出评阅。真实产品会回到“我的任务”。</p>
      </div>
      <ol class="list">
        <li v-for="g in groups" :key="g.to">
          <div class="item__head">
            <RouterLink :to="g.to" class="item__title">{{ g.title }}</RouterLink>
            <span class="muted item__space">{{ g.space }}</span>
          </div>
          <p class="item__desc">{{ g.desc }}</p>
          <p class="item__states">
            <RouterLink v-for="s in g.states" :key="s.label" :to="s.to" class="chip">{{ s.label }}</RouterLink>
          </p>
        </li>
      </ol>
    </main>
  </div>
</template>

<style scoped>
.index__head {
  display: flex;
  height: 56px;
  align-items: center;
  padding: 0 24px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.index__main {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}
.intro {
  display: grid;
  gap: 8px;
  margin-bottom: 24px;
}
.intro h1 {
  font-size: 22px;
  font-weight: 650;
}
.intro p {
  max-width: 70ch;
}
.left {
  padding: 8px 12px;
  border-left: 3px solid var(--ws-success);
  background: var(--ws-success-soft);
}
.list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--ws-border);
}
.list li {
  display: grid;
  gap: 6px;
  padding: 18px 0;
  border-bottom: 1px solid var(--ws-border);
}
.item__head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: baseline;
}
.item__title {
  color: var(--ws-action);
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
}
.item__title:hover {
  text-decoration: underline;
}
.item__space {
  font-size: 12px;
}
.item__desc {
  max-width: 72ch;
}
.item__states {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 2px 8px;
  border: 1px solid var(--ws-border);
  border-radius: 4px;
  background: var(--ws-surface);
  color: var(--ws-text);
  font-size: 12px;
  text-decoration: none;
}
.chip:hover {
  border-color: var(--ws-action);
  color: var(--ws-action);
}
</style>
