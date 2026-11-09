<script setup lang="ts">
/**
 * 一位专家的评阅意见（P1-1）：各段文字按调用方给的顺序排，缺省时用虚线框说明；之后是分项评分表。
 * 学生 / 导师反馈、学校结果、专家本人只读页共用，条形只有这一种画法。
 * 哪些段落、哪些备注能出现，由调用方按身份决定（例如“主要优点（不发布）”和分项评价只在专家本人页面传入）。
 */
export interface OpinionSection {
  key: string
  heading: string
  text: string
  /** 文字为空时显示的说明 */
  missing: string
}

export interface OpinionScore {
  key: string
  label: string
  score: number
  max: number
  note?: string
}

defineProps<{ sections: OpinionSection[]; scores: OpinionScore[]; scoresCaption?: string }>()

const width = (score: OpinionScore) => `${score.max > 0 ? Math.min(100, Math.max(0, (score.score / score.max) * 100)) : 0}%`
</script>

<template>
  <div class="grid gap-6" data-review-opinion>
    <section
      v-for="section in sections"
      :key="section.key"
      class="grid max-w-[42em] gap-1.5"
      :data-section="section.key"
      :data-advice="section.key === 'advice' || undefined"
    >
      <h4 class="text-md font-semibold">{{ section.heading }}</h4>
      <p v-if="section.text.trim()" class="text-md leading-[1.75] break-words whitespace-pre-line">{{ section.text }}</p>
      <p v-else class="rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-muted-foreground" data-missing>{{ section.missing }}</p>
    </section>

    <section class="grid gap-1.5" data-scores>
      <h4 class="text-md font-semibold">分项评分</h4>
      <p v-if="scoresCaption" class="text-sm text-muted-foreground" data-scores-caption>{{ scoresCaption }}</p>
      <table class="w-full max-w-[560px] text-sm">
        <tbody>
          <tr v-for="score in scores" :key="score.key" class="border-b align-top last:border-b-0" data-score-row>
            <th scope="row" class="w-px py-2 pr-4 text-left font-normal whitespace-nowrap">
              {{ score.label }}
              <small v-if="score.note" class="block max-w-[24em] pt-0.5 text-xs whitespace-normal text-muted-foreground" data-score-note>{{ score.note }}</small>
            </th>
            <td class="py-2 align-middle" aria-hidden="true">
              <span class="block h-1.5 min-w-20 rounded-full bg-muted"><span class="block h-full rounded-full bg-primary" data-score-fill :style="{ width: width(score) }" /></span>
            </td>
            <td class="tabular w-px py-2 pl-4 text-right whitespace-nowrap">{{ score.score }} <span class="text-muted-foreground">/ {{ score.max }}</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
