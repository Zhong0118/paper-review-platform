import type { RequestOptions } from './request'

/**
 * 可选的末尾请求配置：没传时不多出一个 undefined 实参，旧调用（与断言实参的旧 spec）保持原样。
 * 单独成文件：许多 spec 整体 mock './request'，放在那里会被替换掉。
 */
export const optionArgs = (options?: RequestOptions): [] | [RequestOptions] => (options ? [options] : [])
