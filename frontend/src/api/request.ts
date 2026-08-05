/**
 * @file axios 统一请求封装
 * @description
 *    所有 HTTP 请求的统一入口，负责携带认证令牌、解析错误码、注入幂等键和请求追踪。

 * 主要功能：
 *    1. 请求拦截：注入 Bearer token、Idempotency-Key、request_id 追踪。
 *    2. 响应拦截：解包统一响应结构（{ code, message, data, request_id }）。
 *    3. 错误处理：按业务错误码映射为可读消息，401 触发重新登录。
 *    4. 提供类型化的 get/post/patch/delete 辅助方法。

 * 错误码基线：见 docs/05_API设计/API设计.md 第 5 节。
 * 后端：FastAPI，API 基线路径 /api/v1（见 docs/05_API设计/API设计.md 第 1 节）。
 * 注意事项：
 *    - 401 自动清理会话并跳转登录。
 *    - 命令接口（提交/发布/提现等）必须传入幂等键，防重复提交。
 *    - 不在浏览器持久化签名地址或敏感论文内容。
 */

import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

/** 后端统一响应包装 */
export interface ApiResponse<T> {
  request_id: string
  code: string
  message: string
  data: T
}

/** 列表分页结构（游标分页） */
export interface PageResult<T> {
  data: T[]
  paging: {
    next_cursor: string | null
    has_more: boolean
  }
}

/** 业务错误码（与 docs/05_API设计/API设计.md 第 5 节一致） */
export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'STATE_TRANSITION_DENIED'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ANONYMIZATION_FAILED'
  | 'FILE_NOT_READY'
  | 'CONFLICT_RULE_TRIGGERED'
  | 'RATE_LIMITED'
  | 'INTEGRATION_UNAVAILABLE'

/** 请求配置扩展：允许显式传幂等键 */
export interface RequestOptions extends AxiosRequestConfig {
  /** 幂等键，命令接口必传 */
  idempotencyKey?: string
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
})

// 请求拦截：注入 token 与幂等键
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const auth = useAuthStore()
  if (auth.accessToken) {
    config.headers.set('Authorization', `Bearer ${auth.accessToken}`)
  }

  const options = config as InternalAxiosRequestConfig & { idempotencyKey?: string }
  if (options.idempotencyKey) {
    config.headers.set('Idempotency-Key', options.idempotencyKey)
  }

  return config
})

// 响应拦截：统一解包 + 错误映射
http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse<unknown>>) => {
    const code = error.response?.data?.code as ApiErrorCode | undefined
    const requestId = error.response?.data?.request_id
    const status = error.response?.status

    // 认证失效：清理会话并跳转登录
    if (status === 401 || code === 'AUTH_REQUIRED') {
      const auth = useAuthStore()
      auth.clearSession()
      window.location.href = '/login'
    }

    // 403/404 统一提示，防资源枚举
    if (status === 403 || code === 'ACCESS_DENIED') {
      ElMessage.error('您没有执行该操作的权限')
      return Promise.reject(error)
    }
    if (status === 404 || code === 'RESOURCE_NOT_FOUND') {
      ElMessage.error('资源不存在或不可见')
      return Promise.reject(error)
    }
    // 409 并发/状态冲突，提示刷新
    if (status === 409 || code === 'VERSION_CONFLICT' || code === 'STATE_TRANSITION_DENIED') {
      ElMessage.error('数据已变更，请刷新后重试')
      return Promise.reject(error)
    }
    if (code === 'RATE_LIMITED') {
      ElMessage.error('操作过于频繁，请稍后重试')
      return Promise.reject(error)
    }

    // 其余：展示后端消息（若存在）
    const message = error.response?.data?.message ?? error.message ?? '请求失败'
    ElMessage.error(message)
    void requestId
    return Promise.reject(error)
  },
)

/** 解包响应体，返回 data */
async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await promise
  return response.data.data
}

/** 类型化请求方法 */
export const httpApi = {
  get<T>(url: string, config?: RequestOptions): Promise<T> {
    return unwrap(http.get<ApiResponse<T>>(url, config))
  },
  post<T>(url: string, data?: unknown, config?: RequestOptions): Promise<T> {
    return unwrap(http.post<ApiResponse<T>>(url, data, config))
  },
  patch<T>(url: string, data?: unknown, config?: RequestOptions): Promise<T> {
    return unwrap(http.patch<ApiResponse<T>>(url, data, config))
  },
  delete<T>(url: string, config?: RequestOptions): Promise<T> {
    return unwrap(http.delete<ApiResponse<T>>(url, config))
  },
}

export default http
