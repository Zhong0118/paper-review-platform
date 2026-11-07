# R05 学校管理员列表请求竞态

范围：只处理 `TenantPermissionsPage.vue` 的管理员列表请求。工作树保留既有 T01–T05/R01–R04 修改；分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`，未提交、推送或部署。

先在 `realTenantPermissions.spec.ts` 增加四项延迟 Promise 用例：A、B 先后选中但 B 先返回；A 的失败晚于切换；刷新后 A 消失再选 B；刷新使同一学校的待完成请求失效。修复前定向测试 5 通过、4 失败。页面增加局部递增 generation，并捕获请求发起时的 tenant ID；成功、失败和 finally 只有在 generation 与当前选择均匹配时才更新列表、错误和加载状态。刷新和清空选择均使旧请求失效。未修改 API 或权限语义。

验证：

- `cd frontend && node_modules/.bin/vitest run src/modules/system/__tests__/realTenantPermissions.spec.ts`：9 passed，退出码 0。
- `cd frontend && node_modules/.bin/vue-tsc --build`：退出码 0。
- `git diff --check`：退出码 0。
- 独立测试库 `127.0.0.1:5433/paper_review_test` 的 operations 临时 schema 上，启动后端 `acceptance_server.py --scenario operations --port 8011` 与 `VITE_DEMO_MODE=false` 的 Vite（端口 5186）。浏览器用本地测试账号登录系统管理端，查看 A（无管理员）、B（1 名管理员）、试点学校（1 名管理员），快速切换并刷新；标题与管理员行始终对应所选学校。所见登录、租户列表和管理员列表 HTTP 请求均返回 200。浏览器没有强制制造逆序响应；这部分由上述延迟 Promise 测试覆盖。
- 验收页面与服务已正常关闭；测试库残留 `acceptance_%`/`test_%` schema 数量为 0，临时存储目录不存在，8011/5186 无监听。

未运行前后端全套、真实环境或 Hosted CI；统一验收仍归 R08。R05 交付边界已到，下一项为 R06。
