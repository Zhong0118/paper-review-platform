<script setup lang="ts">
/** 全局提示区（R4）：顶部居中，读屏器以 polite 播报；可手动关闭。 */
import { CircleAlert, X } from '@lucide/vue'

import { dismiss, notices } from './notify'
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-3 z-[100] grid justify-items-center gap-2 px-4" role="status" aria-live="polite" data-toaster>
    <p
      v-for="item in notices"
      :key="item.id"
      class="pointer-events-auto flex max-w-[32rem] items-start gap-2 rounded-md border bg-popover py-2.5 pr-2 pl-3 text-sm text-popover-foreground shadow-(--shadow-float)"
      data-notice
    >
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ item.text }}</span>
      <button type="button" class="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label="关闭提示" @click="dismiss(item.id)">
        <X class="size-3.5" />
      </button>
    </p>
  </div>
</template>
