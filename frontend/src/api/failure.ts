/**
 * 把请求失败翻译成页面可以直接显示的中文说明。
 * 优先用后端返回的 message；没有响应时说明是网络问题；不把 axios 的英文默认消息给用户看。
 */
export interface ApiFailure {
  status?: number
  code?: string
  message: string
}

export function apiFailure(error: unknown): ApiFailure {
  const response = (error as { response?: { status?: number; data?: { code?: string; message?: string } } })?.response
  return {
    status: response?.status,
    code: response?.data?.code,
    message: failureText(error, '请求失败'),
  }
}

export function failureText(error: unknown, fallback: string): string {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response
  const message = response?.data?.message?.trim()
  if (message) return message
  const networkLike = (error && typeof error === 'object' && 'isAxiosError' in error) || (error instanceof Error && error.message === 'Network Error')
  if (networkLike && !response) return '网络连接中断，请检查网络后重试'
  if (response?.status) return `${fallback}（服务返回 ${response.status}）`
  if (error instanceof Error && error.message && !/^Request failed|^Network Error$|^timeout/i.test(error.message)) return error.message
  return fallback
}
