<template><div class="workspace-splitter"><div><slot name="document" /></div><aside><slot name="form" /></aside></div></template>
<style scoped>
.workspace-splitter { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(20rem, .8fr); gap: 1rem; align-items: start; }
/* 设计 §5.7：移动端（≤1000px）双栏上下堆叠；桌面 ≥1000px 保持双栏 */
@media (max-width: 999.98px) { .workspace-splitter { grid-template-columns: 1fr; } }
</style>
