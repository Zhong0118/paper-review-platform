<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import AuthLayout from '@/layouts/AuthLayout.vue'
import InvitationActivationPanel from '@/modules/auth/components/InvitationActivationPanel.vue'
import LoginChannelTabs, { type LoginChannel } from '@/modules/auth/components/LoginChannelTabs.vue'
import SchoolIdentityPanel from '@/modules/auth/components/SchoolIdentityPanel.vue'
import { defaultRouteByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import type { RoleCode } from '@/types/roles'

const props = withDefaults(defineProps<{ demoMode?: boolean }>(), {
  demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
})

const router = useRouter()
const authStore = useAuthStore()
const form = reactive({ account: '', password: '' })
const notice = ref('')
const activeChannel = ref<LoginChannel>('platform')

const demoRoles: Array<{ role: RoleCode; label: string; note: string }> = [
  { role: 'student', label: '学生', note: '提交论文并查看结果' },
  { role: 'school_reviewer', label: '学校管理员', note: '审核材料与发布结果' },
  { role: 'platform_reviewer', label: '百杰运营', note: '专家匹配与派单' },
  { role: 'expert', label: '评审专家', note: '接单并在线评阅' },
  { role: 'supervisor', label: '导师', note: '查看学生评审结果' },
]

async function startDemo(role: RoleCode) {
  authStore.loginAsDemo(role)
  await router.push(defaultRouteByRole[role])
}

const submitting = ref(false)

async function submitFormalLogin() {
  notice.value = ''
  if (!form.account.trim() || !form.password) {
    notice.value = '请输入账号和密码。'
    return
  }
  submitting.value = true
  try {
    await authStore.loginWithPassword(form.account.trim(), form.password)
    const role = authStore.user?.role
    await router.push(role ? defaultRouteByRole[role] : '/login')
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '登录失败，请检查账号密码。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <section class="login-card" aria-labelledby="login-title">
      <p class="login-card__eyebrow">ACCOUNT ACCESS</p>
      <h2 id="login-title">登录评审平台</h2>
      <p class="login-card__intro">按身份来源选择登录方式；平台不开放公开注册。</p>

      <LoginChannelTabs v-model="activeChannel" />

      <form
        v-if="activeChannel === 'platform'"
        id="login-panel-platform"
        class="login-form"
        role="tabpanel"
        aria-labelledby="login-tab-platform"
        @submit.prevent="submitFormalLogin"
      >
        <label>
          <span>账号</span>
          <input v-model="form.account" autocomplete="username" placeholder="请输入账号" />
        </label>
        <label>
          <span>密码</span>
          <input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
          />
        </label>
        <button class="login-form__submit" type="submit" :disabled="submitting">
          {{ submitting ? '登录中…' : '登录' }}
        </button>
        <p v-if="notice" class="login-form__notice" role="status">{{ notice }}</p>
      </form>

      <SchoolIdentityPanel v-else-if="activeChannel === 'school'" />
      <InvitationActivationPanel v-else />

      <section v-if="props.demoMode" class="demo-entry" aria-label="演示角色入口">
        <div class="demo-entry__heading">
          <span>甲方演示模式</span>
          <small>无需账号，选择角色进入固定演示场景</small>
        </div>
        <div class="demo-entry__grid">
          <button
            v-for="item in demoRoles"
            :key="item.role"
            type="button"
            :data-demo-role="item.role"
            @click="startDemo(item.role)"
          >
            <strong>{{ item.label }}</strong>
            <small>{{ item.note }}</small>
          </button>
        </div>
      </section>
    </section>
  </AuthLayout>
</template>

<style scoped>
.login-card {
  width: min(100%, 38rem);
  padding: clamp(1.5rem, 3vw, 2.5rem);
  border: 1px solid #dce3e9;
  background: white;
  box-shadow: 0 1.5rem 4rem rgb(31 55 76 / 0.1);
}

.login-card__eyebrow {
  margin: 0 0 0.5rem;
  color: #5b6b7a;
  font-family: var(--font-data);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.login-card h2 {
  margin: 0;
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 1.75rem;
}

.login-card__intro {
  margin: 0.625rem 0 1.5rem;
  color: #687682;
  font-size: 0.8125rem;
  line-height: 1.65;
}

.login-form {
  display: grid;
  gap: 0.875rem;
}

.login-form label,
.login-form label span {
  display: grid;
  gap: 0.375rem;
}

.login-form label span {
  color: #33414d;
  font-size: 0.8125rem;
  font-weight: 650;
}

.login-form input {
  width: 100%;
  height: 2.75rem;
  padding: 0 0.75rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.375rem;
  background: #fbfcfe;
  color: #212121;
}

.login-form button {
  min-height: 2.75rem;
  border-radius: 0.375rem;
  font-weight: 650;
  cursor: pointer;
}

.login-form__submit {
  border: 1px solid #1b4f8a;
  background: #1b4f8a;
  color: white;
}

.login-form__notice {
  margin: 0;
  padding: 0.625rem 0.75rem;
  background: #fff6e8;
  color: #8d440c;
  font-size: 0.75rem;
}

.demo-entry {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid #dfe5ea;
}

.demo-entry__heading {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.demo-entry__heading span {
  color: #123d6b;
  font-size: 0.8125rem;
  font-weight: 750;
}

.demo-entry__heading small {
  color: #78848e;
  font-size: 0.6875rem;
}

.demo-entry__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.demo-entry__grid button {
  display: grid;
  gap: 0.125rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid #d1dbe3;
  border-radius: 0.375rem;
  background: #f7f9fb;
  color: #33414d;
  text-align: left;
  cursor: pointer;
}

.demo-entry__grid button:hover {
  border-color: #6d95bf;
  background: #edf3f9;
}

.demo-entry__grid small {
  color: #74818c;
  font-size: 0.6875rem;
}

@media (max-width: 480px) {
  .demo-entry__heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .demo-entry__grid {
    grid-template-columns: 1fr;
  }
}
</style>
