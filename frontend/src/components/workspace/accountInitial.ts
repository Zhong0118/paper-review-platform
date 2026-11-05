/** 头像字：取姓名去掉职称后的最后一个字（“周明远教授”→“远”）；取不到时用“我”。 */
const TITLES = /(副?教授|讲师|副?研究员|博士|老师|先生|女士|同学)$/

export function accountInitial(name: string | null | undefined): string {
  const bare = (name ?? '').trim().replace(TITLES, '').trim()
  if (!bare || bare === '身份未取得') return '我'
  return Array.from(bare).at(-1) ?? '我'
}
