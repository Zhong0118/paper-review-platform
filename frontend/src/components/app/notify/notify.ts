/**
 * 全局提示（R4，U4 计划 §19.12）：取代 Element Plus 的 ElMessage。只给请求层的兜底错误用；
 * 页面能原位说明的错误应走 quiet 请求，不进这里。同一句正在显示时不重复叠加，5 秒后自动消失。
 */
import { reactive } from 'vue'

export interface Notice {
  id: number
  text: string
}

const SHOW_MS = 5000
let nextId = 0
export const notices = reactive<Notice[]>([])

export function dismiss(id: number) {
  const index = notices.findIndex((item) => item.id === id)
  if (index >= 0) notices.splice(index, 1)
}

export const notify = {
  error(text: string) {
    if (notices.some((item) => item.text === text)) return
    const id = ++nextId
    notices.push({ id, text })
    setTimeout(() => dismiss(id), SHOW_MS)
  },
}
