<script setup lang="ts">
/** 原型索引：U1 主链与 U3 收尾/设置/资源各组，以及各自可切换的关键状态。 */
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

const u3Groups = [
  {
    title: '学校：结果处理（P09）',
    space: '处理工作空间',
    to: '/prototype/results',
    desc: '对象区先列“将公开的内容”再列“不会公开”；发布确认后读回快照，导出为次要动作；更正待确认在对象内对照，确认即自动追加发布。',
    states: [
      { label: '待发布', to: '/prototype/results' },
      { label: '评阅未齐', to: '/prototype/results?state=notready' },
      { label: '发布确认', to: '/prototype/results?state=publish' },
      { label: '结果已变化', to: '/prototype/results?state=conflict' },
      { label: '已发布', to: '/prototype/results?state=published' },
      { label: '更正待确认', to: '/prototype/results?state=correction' },
      { label: '不予确认', to: '/prototype/results?state=correction-reject' },
      { label: '范围内无论文', to: '/prototype/results?state=empty' },
      { label: '加载失败', to: '/prototype/results?state=error' },
    ],
  },
  {
    title: '学校：异议处理（P11）',
    space: '处理工作空间',
    to: '/prototype/objections',
    desc: '待处理只有“开始处理”；处理中填写渠道与结论（学生可见）再确认办结；学生原文按纯文本显示。',
    states: [
      { label: '有待处理', to: '/prototype/objections' },
      { label: '处理中', to: '/prototype/objections?state=processing' },
      { label: '办结确认', to: '/prototype/objections?state=resolve' },
      { label: '已办结', to: '/prototype/objections?state=resolved' },
      { label: '没有异议', to: '/prototype/objections?state=empty' },
      { label: '加载失败', to: '/prototype/objections?state=error' },
    ],
  },
  {
    title: '学校设置：批次与规则（P12）',
    space: '处理工作空间（学校设置）',
    to: '/prototype/settings/batches',
    desc: '基本信息、生命周期、期限、专业目录版本、收尾核对分区；评审规则只读侧栏；409 保留编辑并列出两边的值。',
    states: [
      { label: '开放中的批次', to: '/prototype/settings/batches' },
      { label: '草稿（期限未配置）', to: '/prototype/settings/batches?state=draft' },
      { label: '版本冲突', to: '/prototype/settings/batches?state=conflict' },
      { label: '截止收件确认', to: '/prototype/settings/batches?state=close' },
      { label: '归档确认', to: '/prototype/settings/batches?state=archive' },
      { label: '新建批次', to: '/prototype/settings/batches?state=create' },
      { label: '还没有批次', to: '/prototype/settings/batches?state=empty' },
    ],
  },
  {
    title: '学校设置：成员与资格（P12）',
    space: '处理工作空间（学校设置）',
    to: '/prototype/settings/members',
    desc: '账号与联系方式、送审资格（暂停只影响新建）、停用与重置密码；密码只在输入框出现，提交后不回显。',
    states: [
      { label: '学生（有资格）', to: '/prototype/settings/members' },
      { label: '资格已暂停', to: '/prototype/settings/members?state=suspended' },
      { label: '尚未建立资格', to: '/prototype/settings/members?state=noeligibility' },
      { label: '版本冲突', to: '/prototype/settings/members?state=conflict' },
      { label: '停用确认', to: '/prototype/settings/members?state=disable' },
      { label: '重置密码', to: '/prototype/settings/members?state=reset' },
      { label: '新建成员', to: '/prototype/settings/members?state=create' },
      { label: '筛选无匹配', to: '/prototype/settings/members?state=nomatch' },
      { label: '成员不可见', to: '/prototype/settings/members?state=gone' },
    ],
  },
  {
    title: '学校设置：学科与专业（P12）',
    space: '处理工作空间（学校设置）',
    to: '/prototype/settings/disciplines',
    desc: '开放学科按门类勾选，未设置时说明默认口径；校内专业 CSV 预览≠写入，有错误不能发布。',
    states: [
      { label: '开放学科', to: '/prototype/settings/disciplines' },
      { label: '未设置', to: '/prototype/settings/disciplines?state=unconfigured' },
      { label: '版本冲突', to: '/prototype/settings/disciplines?state=conflict' },
      { label: '专业：已发布版本', to: '/prototype/settings/disciplines?state=programs' },
      { label: '专业：预览未写入', to: '/prototype/settings/disciplines?state=preview' },
      { label: '专业：预览有错误', to: '/prototype/settings/disciplines?state=preview-errors' },
      { label: '专业：发布确认', to: '/prototype/settings/disciplines?state=publish' },
    ],
  },
  {
    title: '学校设置：检测词表（P12）',
    space: '处理工作空间（学校设置）',
    to: '/prototype/settings/terms',
    desc: '整表编辑，未保存修改数常驻；冲突时保留本地修改并列出对方的改动。',
    states: [
      { label: '已有词表', to: '/prototype/settings/terms' },
      { label: '有未保存修改', to: '/prototype/settings/terms?state=dirty' },
      { label: '版本冲突', to: '/prototype/settings/terms?state=conflict' },
      { label: '词表为空', to: '/prototype/settings/terms?state=empty' },
    ],
  },
  {
    title: '平台：专家库（P13）',
    space: '处理工作空间',
    to: '/prototype/experts',
    desc: '资格审核、服务状态、回避关系三个分区分别说明“不可用”的原因；CSV 导入只更新已有专家档案，有错或过期整批不写。',
    states: [
      { label: '可指派', to: '/prototype/experts' },
      { label: '资格待审核', to: '/prototype/experts?state=pending' },
      { label: '本人暂停服务', to: '/prototype/experts?state=paused' },
      { label: '暂停确认', to: '/prototype/experts?state=pause' },
      { label: '版本冲突', to: '/prototype/experts?state=conflict' },
      { label: '导入预览', to: '/prototype/experts?state=import' },
      { label: '导入有错误', to: '/prototype/experts?state=import-invalid' },
      { label: '导入已过期', to: '/prototype/experts?state=import-expired' },
      { label: '筛选无匹配', to: '/prototype/experts?state=nomatch' },
    ],
  },
  {
    title: '平台：更正审批（P13）',
    space: '处理工作空间',
    to: '/prototype/corrections',
    desc: '只看申请信息与处理记录，不看学校专属的前后对照；批准与驳回都写原因。',
    states: [
      { label: '有待审批', to: '/prototype/corrections' },
      { label: '批准确认', to: '/prototype/corrections?state=approve' },
      { label: '驳回确认', to: '/prototype/corrections?state=reject' },
      { label: '已被他人处理', to: '/prototype/corrections?state=taken' },
      { label: '待学校确认', to: '/prototype/corrections?state=history' },
      { label: '没有申请', to: '/prototype/corrections?state=empty' },
    ],
  },
  {
    title: '系统管理：学校管理（P14）',
    space: '处理工作空间',
    to: '/prototype/system',
    desc: '学校表 → 详情（暂停二次确认、学校管理员）/ 新增（官方院校检索、代码重复保留输入）；没有论文入口。',
    states: [
      { label: '学校列表', to: '/prototype/system' },
      { label: '学校详情', to: '/prototype/system?state=detail' },
      { label: '暂停确认', to: '/prototype/system?state=suspend' },
      { label: '新增学校管理员', to: '/prototype/system?state=reviewer' },
      { label: '新增学校', to: '/prototype/system?state=create' },
      { label: '学校代码重复', to: '/prototype/system?state=duplicate' },
      { label: '筛选无匹配', to: '/prototype/system?state=nomatch' },
    ],
  },
  {
    title: '系统管理：官方基础目录（P14）',
    space: '处理工作空间',
    to: '/prototype/system/catalog',
    desc: '读取内置官方来源生成预览（只有计数），确认带指纹导入；指纹失效整批不写，只能重新预览。',
    states: [
      { label: '尚未预览', to: '/prototype/system/catalog' },
      { label: '预览未写入', to: '/prototype/system/catalog?state=preview' },
      { label: '导入确认', to: '/prototype/system/catalog?state=apply' },
      { label: '预览已过期', to: '/prototype/system/catalog?state=expired' },
      { label: '已导入', to: '/prototype/system/catalog?state=applied' },
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
        <h1>可点击原型</h1>
        <p class="muted">
          全部为虚构数据，不连接真实接口。行为按修复后合同 v2.1 模拟；修复由开发 Agent 报告完成、尚未合入本工作树，相关处以“原型注”标出。对应清单见
          docs/superpowers/specs/2026-11-04-ui-redesign-u0-function-map.md。
        </p>
        <p v-if="route.query.left === 'review'" class="left" role="status">已保存并退出评阅。真实产品会回到“我的任务”。</p>
      </div>
      <h2 class="round">U1：主链</h2>
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
      <h2 class="round">U3：收尾、设置与资源（待验收）</h2>
      <ol class="list">
        <li v-for="g in u3Groups" :key="g.to">
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
.round {
  margin: 24px 0 8px;
  font-size: 15px;
  font-weight: 600;
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
