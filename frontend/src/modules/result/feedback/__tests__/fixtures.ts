/** 虚构的已发布快照（v2），测试用 */
export const published = (extra: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  snapshot_schema_version: 2,
  thesis_id: 't1', base_result_id: 'r1', effective_revision_id: null, correction_pending: false, total: 86,
  outcome: { code: 'PASS', label: '通过' },
  rule_snapshot: { version: 'R-2026', required_experts: 1, mode: 'single', bands: [], dimensions: [{ key: 'topic', label: '选题与综述', max_score: 40 }, { key: 'method', label: '研究方法', max_score: 60 }] },
  items: [{ alias: 'E-001', total: 86, scores: { topic: 34, method: 52 }, recommendation: '建议通过', overall_comment: '总体扎实。', issues: '第三章论证略薄。', revision_advice: '补充对照实验。', ...item }],
  ...extra,
})
