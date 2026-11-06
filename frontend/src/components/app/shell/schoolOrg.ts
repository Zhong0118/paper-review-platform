/** 外壳里显示的学校：优先学校名称；旧会话没有名称时退回学校代码（F1 · A1）。 */
export function schoolOrg(user: { tenantName?: string | null; tenantCode?: string | null } | null | undefined): string {
  return user?.tenantName || user?.tenantCode || ''
}
