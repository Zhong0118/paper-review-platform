### Task 7: 演示场景控制器和环境隔离

**Files:**

- Create: `frontend/src/modules/thesis/components/StudentDemoScenarioController.vue`
- Create: `frontend/src/modules/thesis/__tests__/studentDemoScenario.spec.ts`
- Modify: `frontend/src/modules/thesis/pages/StudentDashboardPage.vue`
- Modify: `frontend/src/modules/thesis/pages/ThesisEditPage.vue`
- Modify: `frontend/src/modules/result/pages/StudentResultPage.vue`
- Modify: `frontend/.env.example`
- Modify: `frontend/src/vite-env.d.ts`

**Interfaces:**

- Consumes: Task 1 的 `loadStudentScenario(preset)` 和 `resetStudentDemo()`。
- Produces: `StudentScenarioPreset = 'DRAFT' | 'RETURNED' | 'SCHOOL_REVIEW' | 'EXPERT_REVIEW' | 'RESULT_PROCESSING' | 'COMPLETED'`。

- [ ] **Step 1: 写环境门禁和一致快照失败测试**

```ts
it("does not render without explicit demo mode", () => {
  const wrapper = mount(StudentDemoScenarioController, {
    props: { enabled: false },
  });
  expect(wrapper.html()).toBe("<!--v-if-->");
});

it("loads a completed snapshot with result, timeline and notification", async () => {
  const wrapper = mount(StudentDemoScenarioController, {
    props: { enabled: true },
    global: { provide: { [studentPortalServiceKey as symbol]: service } },
  });
  await wrapper.get('[data-scenario="COMPLETED"]').trigger("click");
  await flushPromises();
  expect((await service.getStudentThesis("thesis-main")).stage).toBe(
    "COMPLETED",
  );
  expect(await service.getStudentResult("thesis-main")).not.toBeNull();
  expect(await service.listStudentNotifications()).toContainEqual(
    expect.objectContaining({ kind: "RESULT_PUBLISHED" }),
  );
});
```

- [ ] **Step 2: 运行场景控制器测试并确认失败**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/studentDemoScenario.spec.ts`

Expected: FAIL，控制器和场景快照接口尚不存在。

- [ ] **Step 3: 实现显式环境门禁和六个一致快照**

页面按 `const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'` 传入 `enabled`。控制器放在业务页面右下方独立浮动入口中，展开后标注“仅用于演示，不代表学生拥有该操作权限”。关闭演示模式时不渲染入口，服务也拒绝 `loadStudentScenario()`。

每个快照同时替换论文阶段、时间线、结果、撤回/异议和通知，不调用学生业务动作伪造跨角色权限。

- [ ] **Step 4: 实现资格、文件失败和重置辅助场景**

控制器附加选择“资格有效/暂停/过期”和“文件校验成功/失败”，以及“一键恢复默认数据”。重置需二次确认并清除 `baijie-demo-student:v1` 后重新装载固定 fixtures。

- [ ] **Step 5: 运行演示控制器和学生模块回归**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__ src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/shared/__tests__/studentNotifications.spec.ts`

Run: `npm run type-check`

Expected: PASS；`enabled=false` 时 DOM 和可调用服务中都没有场景切换能力。

- [ ] **Step 6: 提交演示状态控制器**

```bash
git add frontend/src/modules/thesis/components/StudentDemoScenarioController.vue frontend/src/modules/thesis/pages/StudentDashboardPage.vue frontend/src/modules/thesis/pages/ThesisEditPage.vue frontend/src/modules/result/pages/StudentResultPage.vue frontend/src/modules/thesis/__tests__/studentDemoScenario.spec.ts frontend/.env.example frontend/src/vite-env.d.ts
git commit -m "feat: add isolated student demo scenarios"
```
