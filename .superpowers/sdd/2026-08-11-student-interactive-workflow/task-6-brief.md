### Task 6: 学生消息通知交互

**Files:**
- Create: `frontend/src/modules/shared/components/StudentNotificationList.vue`
- Create: `frontend/src/modules/shared/__tests__/studentNotifications.spec.ts`
- Create: `frontend/src/router/studentNotificationRoutes.ts`
- Create: `frontend/src/router/__tests__/studentNotificationRoutes.spec.ts`
- Create: `frontend/src/styles/__tests__/notificationContrast.spec.ts`
- Create: `frontend/src/components/app/StatusTag.vue`（既存学生工作台的直接构建前置依赖）
- Create: `frontend/src/modules/thesis/components/EligibilityCard.vue`（既存学生工作台的直接构建前置依赖）
- Modify: `frontend/src/modules/shared/pages/NotificationCenterPage.vue`
- Modify: `frontend/src/router/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `listStudentNotifications()`、`markStudentNotificationRead()`、`markAllStudentNotificationsRead()`。
- Produces: 通知目标 `{ routeName, query: { thesisId } }`，只跳转到本人论文、结果或异议页面。

- [ ] **Step 1: 写消息已读和跳转失败测试**

```ts
it('marks a notification read and navigates to its thesis target', async () => {
  await wrapper.get('[data-notification-id="notice-result"] [data-action="open-notification"]').trigger('click')
  await flushPromises()
  expect((await service.listStudentNotifications()).find((item) => item.id === 'notice-result')?.read).toBe(true)
  expect(router.currentRoute.value).toMatchObject({
    path: '/student/results', query: { thesisId: 'thesis-main' },
  })
})
```

增加全部已读、空消息和非学生角色继续使用原页面投影的测试。

- [ ] **Step 2: 运行消息测试并确认失败**

Run: `npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts`

Expected: FAIL，当前通知由页面常量生成，按钮不改变服务状态也不导航。

- [ ] **Step 3: 实现学生通知列表和角色分支**

学生角色从服务加载通知，展示类型、标题、公开摘要、时间和已读状态；点击先标记已读再导航。其他角色保持现有演示内容，避免本轮扩展其业务范围。全部已读调用一次服务动作并同步未读计数。

- [ ] **Step 4: 运行消息及路由回归**

Run: `npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts src/router/__tests__/studentNotificationRoutes.spec.ts src/styles/__tests__/notificationContrast.spec.ts`

Expected: PASS（3 个文件、18 个测试）；生产路由真实注册消息中心及两个学生目标，消息目标始终携带本人论文标识。

- [ ] **Step 5: 提交学生消息交互**

```bash
git add frontend/src/components/app/StatusTag.vue frontend/src/modules/thesis/components/EligibilityCard.vue frontend/src/modules/shared/components/StudentNotificationList.vue frontend/src/modules/shared/pages/NotificationCenterPage.vue frontend/src/modules/shared/__tests__/studentNotifications.spec.ts frontend/src/router/index.ts frontend/src/router/studentNotificationRoutes.ts frontend/src/router/__tests__/studentNotificationRoutes.spec.ts frontend/src/styles/__tests__/notificationContrast.spec.ts
git commit -m "fix: integrate student notification routes"
```
