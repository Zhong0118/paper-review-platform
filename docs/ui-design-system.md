---
title: UI 设计系统
status: DRAFT
version: 0.1.0
last_updated: 2026-08-04
sources:
  - 用户提供的前端视觉规范示例
  - docs/02_产品设计/产品与流程设计.md（页面清单与交互规则）
related_documents:
  - ../engineering-specification.md
  - ../02_产品设计/产品与流程设计.md
---

# UI 设计系统

本文件规定平台前端的**视觉与组件设计系统**，是 `docs/engineering-specification.md` 第 4 节的视觉细则。前端采用 **Tailwind CSS v4 + Element Plus** 双轨方案：**Tailwind 负责布局/间距/排版/业务自定义组件样式，Element Plus 负责表单/表格/弹窗/日期/上传/消息等交互组件**。所有颜色、字号、间距通过设计令牌（Design Token）使用，禁止在业务组件中散落硬编码值。

> 状态：本文件为 `DRAFT`，供用户评审。评审通过后，编码阶段作为前端 UI 的强制约束。

## 1. 设计目标与基调

平台面向高校学术评审场景，整体风格应体现：**专业、稳重、清晰、学术**。高信息密度但不过度拥挤。

- 禁止：过度娱乐化、强烈渐变、复杂玻璃拟态、大面积动画；
- 允许：克制的状态色、轻量反馈动画（≤200ms）、无阴影的边框区分；
- 盲审平台信息隔离：页面不得在 URL、文件名、日志或导出中携带被隔离身份（见 02 产品设计交互规则）。

## 1.1 Tailwind 与 Element Plus 分工边界

| 能力 | 归属 | 说明 |
|---|---|---|
| 布局、间距、排版、栅格、flex/grid | Tailwind | 原子类完成，业务组件不写布局 CSS |
| 表单控件（输入/选择/日期/上传/校验） | Element Plus | 含原生表单校验 |
| 表格、弹窗、抽屉、分页、消息提示 | Element Plus | 交互组件统一 |
| 业务自定义组件（状态标签、论文卡片、评阅表单、进度条） | Tailwind + 设计令牌 | 用令牌类组合，不另写魔法值 |
| 主题变量与令牌 | Tailwind `@theme` + Element Plus CSS 变量 | 两端同步（见第 2 节） |

原则：**Element Plus 管"交互与控件"，Tailwind 管"布局与视觉"**。业务页面优先用 Element Plus 组件 + Tailwind 原子类组织，不重复造组件库已提供的轮子；业务特有视觉（状态色、卡片、盲审标识）用令牌类。

## 2. 设计令牌（Design Tokens）

令牌在 **Tailwind v4 `@theme`（`frontend/src/styles/theme.css`）中定义一次**，同时映射到 Element Plus CSS 变量（覆盖 `--el-color-primary` 等），两端引用同一来源。业务组件只允许使用 Tailwind 语义类（如 `bg-primary`、`text-primary`、`text-secondary`）或 Element Plus 语义变量，禁止硬编码十六进制色值。

```css
/* frontend/src/styles/theme.css（示意） */
@import "tailwindcss";

@theme {
  --color-primary: #1B4F8A;
  --color-primary-hover: #2A63A6;
  --color-primary-active: #123D6B;
  --color-primary-soft: #E8F0F9;
  --color-success: #2E7D32;
  --color-warning: #E65100;
  --color-danger: #C62828;
  --color-info: #0288D1;
  /* …中性色、字体、间距、圆角、阴影、断点见下文… */
}

:root {
  /* 同步到 Element Plus */
  --el-color-primary: var(--color-primary);
  --el-color-primary-light-3: #2A63A6;
  --el-color-success: var(--color-success);
  --el-color-warning: var(--color-warning);
  --el-color-danger: var(--color-danger);
  --el-font-size-base: 14px;
}
```

### 2.1 色彩体系

**主色：学术蓝**——用于主要操作、导航选中、重点信息。

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-primary` | `#1B4F8A` | 主按钮、链接、激活态 |
| `--color-primary-hover` | `#2A63A6` | 主按钮悬浮 |
| `--color-primary-active` | `#123D6B` | 主按钮按下 |
| `--color-primary-soft` | `#E8F0F9` | 主色浅底（标签/选中背景） |
| `--color-primary-50` | `#F4F8FC` | 页面浅底辅助区 |

**语义色**：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-success` | `#2E7D32` | 通过、完成 |
| `--color-warning` | `#E65100` | 临期、待处理 |
| `--color-danger` | `#C62828` | 驳回、失败、高风险 |
| `--color-info` | `#0288D1` | 提示性信息 |

**中性色**：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-text-primary` | `#212121` | 主文字 |
| `--color-text-secondary` | `#616161` | 次要文字 |
| `--color-text-disabled` | `#9E9E9E` | 禁用文字 |
| `--color-border` | `#E0E0E0` | 分隔线、描边 |
| `--color-fill` | `#F5F5F5` | 输入框底、页面底 |
| `--color-bg` | `#FFFFFF` | 页面/卡片背景 |

颜色全部通过令牌类（`bg-primary`、`text-secondary` 等）或 Element Plus 语义变量使用。业务组件不得出现十六进制色值。

### 2.2 字体层级

| 令牌 | 字号 | 行高 | 字重 | Tailwind 类 | 用途 |
|---|---|---|---|---|---|
| `--font-h1` | 24px | 32px | 600 | `text-h1` | 页面主标题 |
| `--font-h2` | 18px | 26px | 600 | `text-h2` | 模块标题 |
| `--font-h3` | 16px | 24px | 600 | `text-h3` | 卡片标题 |
| `--font-body` | 14px | 22px | 400 | `text-body` | 正文 |
| `--font-body-sm` | 13px | 20px | 400 | `text-sm` | 表格/辅助 |
| `--font-caption` | 12px | 18px | 400 | `text-caption` | 辅助文字 |
| `--font-number` | 14px | 22px | 500 | `tabular-nums` | 数字/分数（等宽数字） |

正文行高不得低于 1.5。层级靠字号+间距+颜色，不靠大量加粗。字号在 `@theme` 中注册为 `--text-h1` 等，Tailwind 生成 `text-h1` 语义类。

### 2.3 间距体系（4px 基数）

`4 / 8 / 12 / 16 / 24 / 32 / 40 / 48`

- 页面主区域间距默认 24px；
- 卡片内部间距 16px 或 24px；
- 表单字段间距 16px（纵向）、12px（横向）；
- 列表行间距 8px。

间距在 `@theme` 中映射为 Tailwind 默认 spacing 语义类（`p-4`、`gap-6`、`mt-6` 等），不使用任意值魔法数字。

### 2.4 圆角

| 令牌 | 值 | 用途 | Tailwind 类 |
|---|---|---|---|
| `--radius-sm` | 6px | 表单控件 | `rounded-sm` |
| `--radius-md` | 8px | 卡片、弹窗 | `rounded-md` |
| `--radius-lg` | 12px | 大容器（受限） | `rounded-lg` |

不过度使用大圆角。

### 2.5 阴影

| 令牌 | 值 | 用途 | Tailwind 类 |
|---|---|---|---|
| `--shadow-none` | none | 普通卡片 | `shadow-none` |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.06)` | 悬浮态 | `shadow-sm` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.12)` | 弹窗、浮层 | `shadow-md` |

普通卡片优先用边框区分；阴影仅用于弹窗、浮层、必要悬浮。

### 2.6 断点与适配

| 断点 | 宽度 | 布局 |
|---|---|---|
| `--bp-xs` | <576px | 移动端堆叠 |
| `--bp-md` | 576–992px | 平板/窄屏两列 |
| `--bp-lg` | >992px | 后台桌面布局 |

断点映射到 Tailwind 默认断点（`sm`/`md`/`lg`），响应式用 `md:`/`lg:` 前缀类实现，不自定义魔数断点。管理端支持主流桌面浏览器；专家/学生关键流程支持移动浏览器自适应（NFR-011）。

## 3. 页面布局

后台页面统一结构：

```text
顶部栏（全局导航/用户）
左侧导航（模块菜单）
面包屑
页面标题区（标题 + 主操作）
筛选区（列表页）
主内容区（表格/表单/详情）
```

- 页面内容最大宽度一致（建议 1200px，`--content-max` 令牌）；
- 列表页筛选区、操作区、表格区布局统一；
- 移动端左侧导航收为抽屉。
- 布局骨架用 Tailwind 组织（顶部栏/侧栏 `flex` + 固定高度，内容区 `overflow-auto`），不用组件库布局组件硬堆。

## 4. 通用组件规范

### 4.1 表格（数据密集结构化展示）

- 首列一般为主要标识；操作列固定右侧；
- 操作 >3 个收进"更多"下拉；危险操作红色文字 + 二次确认；
- 空值统一显示 `--`；日期时间统一格式 `YYYY-MM-DD HH:mm`；状态用统一状态标签组件；
- 必须支持加载、空数据、错误三态；大数据列表后端分页（服务端 cursor）；
- 表格列宽可拖拽不强制；长文本省略并 tooltip。

### 4.2 表单

- 简单表单单列；复杂表单可两列但相关字段相邻；
- 标签位置统一（左对齐，`--form-label-width` 90px）；必填/选填清晰；
- 帮助文字放字段下方；保存/取消按钮位置一致（右下）；
- 字段级错误 + 可恢复操作；校验失败聚焦首个错误字段。

### 4.3 按钮层级

- 每操作区通常只有一个主按钮；
- 层级：`Primary`（主要）/ `Default`（次要）/ `Text`（弱）/ `Danger`（危险）；
- 禁止同一区域多个同权重主按钮；危险操作红色 + 二次确认。

### 4.4 弹窗与浮层

- 弹窗圆角 8px；遮罩默认半透明；居中展示；
- 二次确认弹窗说明影响范围（如"确认发布后学生将可见结果"）；
- 表单弹窗宽度按内容定（建议 480/640/800px），纵向超屏可滚动；
- 关闭按钮、Esc、点击遮罩关闭策略统一（危险表单弹窗默认禁止遮罩关闭）。

### 4.5 状态标签

状态使用统一 `StatusTag` 组件，映射见 02 唯一枚举表：

| 状态示例 | 色 |
|---|---|
| DRAFT/SUBMITTED | 中性灰 |
| PREPARING/READY_FOR_DISPATCH | 信息蓝 |
| UNDER_REVIEW/IN_REVIEW | 主色蓝 |
| COMPLETED/SUCCESS/PAID | 成功绿 |
| OVERDUE/逾期/临期 | 警告橙 |
| TERMINATED/REJECTED/FAILED | 危险红 |

### 4.6 图标

统一使用项目指定图标库（Element Plus Icons 或约定图标库）；图标必须语义明确；禁止混用多个风格不一致的图标库。

## 5. 视觉与交互细节

- 加载反馈：按钮 loading、表格 loading、骨架屏，不使用整页转圈占位大面积阻塞；
- 空状态：图标 + 说明 + 引导动作；
- 错误状态：可重试按钮；
- 动效克制 ≤200ms，仅 hover/active/过渡反馈；
- 滚动容器统一内边距与滚动条样式。

## 6. 可访问性基线

- 键盘可操作、可见焦点；语义标签；错误提示关联；
- 正文对比度 ≥ 4.5:1；大字号 ≥ 3:1；
- 颜色不单独传达信息（同时用文字/图标辅助）；
- 焦点顺序与视觉顺序一致。

## 7. 与工程规范的关系

- 前端技术选型（Tailwind v4 + Element Plus + TypeScript + Pinia + axios + dayjs + @element-plus/icons-vue）见 `docs/engineering-specification.md` 第 1 节与第 8 节选型决策；
- 前端代码组织、命名、API 调用、表单/上传规范见 `docs/engineering-specification.md` 第 4 节；
- 本文件只定义"长什么样"（视觉与组件规范），工程规范定义"怎么写"（代码与工程规范）；两者在编码时同时强制；
- 新页面/新组件上线前按本文件做视觉与可访问性检查，纳入 UI 实施评审。
