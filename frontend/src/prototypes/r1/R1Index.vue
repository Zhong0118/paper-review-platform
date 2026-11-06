<script setup lang="ts">
/** R1 样板入口：三张代表样板＋六角色导航。只在开发构建中可达。 */
import { SAMPLE_NOTE } from './fixtures'

const LINKS = [
  { to: '/prototype/r1/experts', title: '专家库', role: '百杰运营', note: 'data 模板：满宽比较表、工作视图、搜索与筛选、显示设置、档案预览；点“档案”进入完整档案（form 模板）。' },
  { to: '/prototype/r1/verify', title: '学校单篇匿名核验', role: '学校审核', note: 'focus 模板：检测发现、材料、你的判断三栏；通过核验与确认送出分开；1280 / 1024 以下自动改排。' },
  { to: '/prototype/r1/feedback', title: '学生正式反馈', role: '学生', note: 'reading 模板：居中阅读栏、完整意见与修改建议、分项评分；异议入口默认收起。' },
  { to: '/prototype/r1/nav?role=school_reviewer', title: '六角色共用导航', role: '全部角色', note: '同一外壳切换六种角色的菜单；折叠、手机抽屉。' },
]
</script>

<template>
  <main class="min-h-svh bg-page px-(--page-x) py-10">
    <div class="mx-auto grid max-w-[760px] gap-6">
      <header class="grid gap-1">
        <h1 class="text-xl font-semibold">R1 视觉样板</h1>
        <p class="text-sm text-muted-foreground">{{ SAMPLE_NOTE }}每张样板底部有虚线框的“样板状态”，用来切换加载、空、错误、冲突等状态。</p>
      </header>
      <ul class="grid divide-y rounded-lg border bg-background">
        <li v-for="link in LINKS" :key="link.to">
          <RouterLink :to="link.to" class="grid gap-1 px-5 py-4 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
            <span class="flex items-baseline gap-3"><span class="font-semibold text-primary">{{ link.title }}</span><span class="text-xs text-muted-foreground">{{ link.role }}</span></span>
            <span class="text-sm text-muted-foreground">{{ link.note }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </main>
</template>
