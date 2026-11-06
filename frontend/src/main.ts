/**
 * @file 前端应用入口
 * @description
 *    创建 Vue 应用实例并装配 Pinia 与路由。

 * 主要功能：
 *    1. 创建并挂载根应用。
 *    2. 装配状态管理（Pinia）。
 *    3. 装配路由。

 * 注意事项：
 *    - 全局样式在此引入（Tailwind + 设计令牌）。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { scenarioService, scenarioServiceKey } from './demo/serviceProvider'
import router from './router'
import '@/styles/main.css'

const app = createApp(App)

app.provide(scenarioServiceKey, scenarioService)
app.use(createPinia())
app.use(router)

app.mount('#app')
