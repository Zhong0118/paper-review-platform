<script setup lang="ts">
export interface StudentIdentityView {
  school: string
  college: string
  studentId: string
  studentName: string
  trainingLevel: string
  degreeType: string
  supervisor: string
  batch: string
  deadline: string
}

defineProps<{ identity: StudentIdentityView }>()
</script>

<template>
  <section class="identity-panel" data-student-identity aria-labelledby="identity-title">
    <header>
      <span>学籍</span>
      <div>
        <h2 id="identity-title">学生与送审批次</h2>
        <p>以下信息由学校维护，学生端仅可核对。</p>
      </div>
    </header>
    <dl>
      <div>
        <dt>学校</dt>
        <dd>{{ identity.school }}</dd>
      </div>
      <div>
        <dt>学院</dt>
        <dd>{{ identity.college }}</dd>
      </div>
      <div>
        <dt>学号</dt>
        <dd>{{ identity.studentId }}</dd>
      </div>
      <div>
        <dt>姓名</dt>
        <dd>{{ identity.studentName }}</dd>
      </div>
      <div>
        <dt>培养层次</dt>
        <dd>{{ identity.trainingLevel }}</dd>
      </div>
      <div>
        <dt>学位类型</dt>
        <dd>{{ identity.degreeType }}</dd>
      </div>
      <div>
        <dt>导师</dt>
        <dd>{{ identity.supervisor }}</dd>
      </div>
      <div>
        <dt>送审批次</dt>
        <dd>{{ identity.batch }}</dd>
      </div>
      <div>
        <dt>提交截止时间</dt>
        <dd>{{ identity.deadline }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.identity-panel {
  border: 1px solid #dce3e9;
  background: #f8fafc;
}

.identity-panel > header {
  display: flex;
  gap: 0.75rem;
  align-items: start;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid #e5eaee;
}

.identity-panel > header > span {
  padding: 0.2rem 0.4rem;
  border: 1px solid #aebdca;
  color: #526878;
  font-size: 0.6875rem;
}

.identity-panel h2,
.identity-panel p {
  margin: 0;
}

.identity-panel h2 {
  color: #263744;
  font-family: var(--font-display);
  font-size: 1rem;
}

.identity-panel p {
  margin-top: 0.2rem;
  color: #71808b;
  font-size: 0.75rem;
}

.identity-panel dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.identity-panel dl > div {
  padding: 0.75rem 1rem;
  border-right: 1px solid #e5eaee;
  border-bottom: 1px solid #e5eaee;
}

.identity-panel dt {
  color: #71808b;
  font-size: 0.6875rem;
}

.identity-panel dd {
  margin: 0.2rem 0 0;
  color: #293946;
  font-size: 0.8125rem;
  font-weight: 650;
}

@media (max-width: 760px) {
  .identity-panel dl {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
