/**
 * @file 前端应用入口
 * @description
 *    创建 Vue 应用实例并装配 Pinia、路由与 Element Plus。

 * 主要功能：
 *    1. 创建并挂载根应用。
 *    2. 装配状态管理（Pinia）。
 *    3. 装配路由。
 *    4. 注册 Element Plus（含中文 locale）。

 * 注意事项：
 *    - 全局样式在此引入（Tailwind + 设计令牌）。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

import App from './App.vue'
import router from './router'
import '@/styles/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')
