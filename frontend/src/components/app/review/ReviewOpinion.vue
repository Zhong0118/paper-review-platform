<script setup lang="ts">
import { computed } from 'vue'

/**
 * 一位专家的评阅意见（P1-1，G1-1）：各段文字（按调用方给的顺序，缺省时用虚线框说明）与分项评分表。
 * 默认先文字后分数（学生、导师按这个顺序读）；scoresFirst 时分数在前（学校结果纸面）。
 * 学生 / 导师反馈、学校结果、专家本人只读页共用。分数只写“得分 / 满分”，不画进度条。
 * 没有分项说明且不超过 6 个维度时横排（一行维度名、一行得分）；否则竖排，有说明时多一列“分项评价”。
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

const props = defineProps<{ sections: OpinionSection[]; scores: OpinionScore[]; scoresCaption?: string; scoresFirst?: boolean }>()

const hasNotes = computed(() => props.scores.some((score) => Boolean(score.note)))
const order = computed(() => (props.scoresFirst ? ['scores', 'text'] : ['text', 'scores']))
const layout = computed<'row' | 'column'>(() => (!hasNotes.value && props.scores.length <= 6 ? 'row' : 'column'))
</script>

<template>
  <div class="@container grid gap-6" data-review-opinion>
    <template v-for="part in order" :key="part">
      <section v-if="part === 'scores' && scores.length" class="grid gap-2" data-scores>
        <h4 :class="scoresFirst ? 'sr-only' : 'text-md font-semibold'">分项评分</h4>
        <table v-if="layout === 'row'" class="w-full table-fixed border-collapse text-center" data-layout="row">
          <thead>
            <tr>
              <th v-for="score in scores" :key="score.key" scope="col" class="border bg-page px-1.5 py-2 text-xs font-normal text-muted-foreground">{{ score.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td v-for="score in scores" :key="score.key" class="tabular border px-1.5 py-2 text-md font-medium" :data-score-value="score.key">{{ score.score }} <span class="text-sm font-normal text-faint">/ {{ score.max }}</span></td>
            </tr>
          </tbody>
        </table>
        <table v-else class="w-full border-collapse text-left text-sm" data-layout="column">
          <thead>
            <tr class="bg-page text-xs text-muted-foreground">
              <th scope="col" class="w-px border px-3 py-2 font-normal whitespace-nowrap">维度</th>
              <th scope="col" class="w-px border px-3 py-2 text-center font-normal whitespace-nowrap">得分</th>
              <th v-if="hasNotes" scope="col" class="border px-3 py-2 font-normal">分项评价</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="score in scores" :key="score.key" class="align-top">
              <th scope="row" class="border px-3 py-2 font-normal whitespace-nowrap">{{ score.label }}</th>
              <td class="tabular border px-3 py-2 text-center font-medium whitespace-nowrap" :data-score-value="score.key">{{ score.score }} <span class="font-normal text-faint">/ {{ score.max }}</span></td>
              <td v-if="hasNotes" class="border px-3 py-2 leading-relaxed break-words whitespace-pre-line text-muted-foreground">
                <span v-if="score.note" data-score-note>{{ score.note }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="scoresCaption" class="text-sm text-muted-foreground" data-scores-caption>{{ scoresCaption }}</p>
      </section>
      <div v-else-if="part === 'text'" class="grid gap-4">
        <section
          v-for="section in sections"
          :key="section.key"
          class="grid gap-1.5 @[560px]:grid-cols-[6rem_minmax(0,1fr)] @[560px]:gap-6"
          :data-section="section.key"
          :data-advice="section.key === 'advice' || undefined"
        >
          <h4 class="font-display text-md font-semibold text-muted-foreground">{{ section.heading }}</h4>
          <p v-if="section.text.trim()" class="max-w-[36em] text-md leading-[1.85] break-words whitespace-pre-line">{{ section.text }}</p>
          <p v-else class="max-w-[36em] rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-muted-foreground" data-missing>{{ section.missing }}</p>
        </section>
      </div>
    </template>
  </div>
</template>
