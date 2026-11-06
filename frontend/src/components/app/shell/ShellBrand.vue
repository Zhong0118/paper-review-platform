<script setup lang="ts">
/** 品牌标识：两条竖线表示“双向盲审”的两侧隔离。折叠时只留标识。 */
</script>

<template>
  <span class="flex min-w-0 items-center gap-2.5">
    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary" aria-hidden="true">
      <span class="flex h-3.5 gap-[3px]"><i class="w-[3px] rounded-[1px] bg-primary-foreground" /><i class="w-[3px] rounded-[1px] bg-primary-foreground/70" /></span>
    </span>
    <span class="truncate text-base font-semibold text-foreground group-data-[collapsible=icon]:hidden">百杰校审</span>
  </span>
</template>
