<script setup lang="ts">
/**
 * @file 根组件
 * @description
 *    为所有角色页面提供完整视口的挂载容器；主区域语义由页面布局负责。
 *    全局提示区（AppToaster）挂在这里，供请求层的兜底错误使用。
 */
import AppToaster from '@/components/app/notify/AppToaster.vue'
</script>

<template>
  <div id="app-root">
    <router-view />
    <AppToaster />
  </div>
</template>
