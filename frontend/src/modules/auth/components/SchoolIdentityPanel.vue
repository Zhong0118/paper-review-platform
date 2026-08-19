<script setup lang="ts">
import { ref } from 'vue'

const schoolCode = ref('')
const notice = ref('')

function continueToSchool() {
  if (!schoolCode.value.trim()) return
  notice.value = '真实学校统一身份认证尚未接入；演示环境不会跳转或创建登录会话。'
}
</script>

<template>
  <section
    id="login-panel-school"
    class="channel-panel"
    role="tabpanel"
    aria-labelledby="login-tab-school"
  >
    <div class="channel-panel__note">
      <strong>面向学生、导师与校内老师</strong>
      <span>输入学校代码后，正式环境将跳转至该校统一身份认证系统。</span>
    </div>
    <form class="channel-form" @submit.prevent="continueToSchool">
      <label>
        <span>学校代码</span>
        <input
          v-model="schoolCode"
          name="school-code"
          autocomplete="organization"
          placeholder="例如：10001"
        />
      </label>
      <button
        type="submit"
        class="channel-form__primary"
        data-action="continue-school-sso"
        :disabled="!schoolCode.trim()"
      >
        继续前往学校认证
      </button>
    </form>
    <p v-if="notice" class="channel-panel__notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.channel-panel,
.channel-form,
.channel-form label,
.channel-form label span,
.channel-panel__note {
  display: grid;
  gap: 0.625rem;
}

.channel-panel__note {
  margin-bottom: 1rem;
  padding: 0.875rem;
  border-left: 3px solid #5b6b7a;
  background: #edf1f4;
}

.channel-panel__note strong {
  color: #33414d;
  font-size: 0.8125rem;
}

.channel-panel__note span,
.channel-panel__notice {
  color: #687682;
  font-size: 0.75rem;
  line-height: 1.6;
}

.channel-form label span {
  color: #33414d;
  font-size: 0.8125rem;
  font-weight: 650;
}

.channel-form input {
  width: 100%;
  height: 2.75rem;
  padding: 0 0.75rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.375rem;
  background: #fbfcfe;
}

.channel-form__primary {
  min-height: 2.75rem;
  border: 1px solid #1b4f8a;
  border-radius: 0.375rem;
  background: #1b4f8a;
  color: white;
  font-weight: 650;
  cursor: pointer;
}

.channel-form__primary:disabled {
  border-color: #cbd4dc;
  background: #dfe5ea;
  color: #7b8791;
  cursor: not-allowed;
}

.channel-panel__notice {
  margin: 0.875rem 0 0;
  padding: 0.625rem 0.75rem;
  background: #fff6e8;
  color: #8d440c;
}
</style>
