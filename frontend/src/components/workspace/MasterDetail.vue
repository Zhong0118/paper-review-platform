<script setup lang="ts">
/**
 * 清单｜对象两栏（U3 原型验收后提升为真实组件）：宽屏并排，窄屏先清单、点开后进入对象并显示返回。
 * 清单宽度可调；对象区自己滚动，清单保持位置。
 */
defineProps<{ open: boolean; narrow: boolean; listLabel: string; detailLabel: string; backLabel?: string; listWidth?: string }>()
const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <div class="md" :class="{ 'md--narrow': narrow }" :style="listWidth ? { '--md-list': listWidth } : undefined">
    <section v-show="!narrow || !open" class="md__list" :aria-label="listLabel"><slot name="list" /></section>
    <section v-if="open" class="md__detail" :aria-label="detailLabel">
      <button v-if="narrow" type="button" class="btn btn--quiet md__back" @click="emit('back')">‹ {{ backLabel ?? '返回清单' }}</button>
      <slot />
    </section>
    <section v-else-if="!narrow" class="md__detail md__detail--empty" :aria-label="detailLabel"><slot name="empty" /></section>
  </div>
</template>

<style scoped>
.md {
  display: grid;
  grid-template-columns: var(--md-list, 320px) minmax(0, 1fr);
  height: calc(100vh - var(--ws-bar));
}
.md--narrow {
  grid-template-columns: minmax(0, 1fr);
  height: auto;
  min-height: calc(100vh - var(--ws-bar));
}
.md__list {
  min-width: 0;
  overflow-y: auto;
  border-right: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.md--narrow .md__list {
  border-right: 0;
}
.md__detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  background: var(--ws-page);
}
.md__detail--empty {
  justify-content: center;
}
.md__back {
  align-self: flex-start;
  margin: 8px 8px 0;
}
</style>
