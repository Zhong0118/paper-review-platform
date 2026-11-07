<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ExpertSelfProfile } from '@/demo/types'
import DisciplineSelector from '@/modules/thesis/components/DisciplineSelector.vue'

const REVIEWABLE_TYPE_OPTIONS = ['学术型', '应用型'] as const

const props = defineProps<{
  profile: ExpertSelfProfile
  /** 保存进行中（防重复提交：确认对话框关闭并提示已保存）。 */
  saving?: boolean
  saved?: boolean
}>()

const emit = defineEmits<{
  save: [input: Record<string, unknown>]
}>()

const contact = ref(props.profile.contact)
const unit = ref(props.profile.unit)
const title = ref(props.profile.title)
const discipline = ref({ ...props.profile.discipline })
const tags = ref<string[]>([])
const tagsDraft = ref('')
const reviewableTypes = ref<string[]>([...props.profile.reviewableTypes])
const avoidStatement = ref(props.profile.avoidStatement)

watch(
  () => props.profile,
  (profile) => {
    contact.value = profile.contact
    unit.value = profile.unit
    title.value = profile.title
    discipline.value = { ...profile.discipline }
    tags.value = [...profile.researchTags]
    tagsDraft.value = ''
    reviewableTypes.value = [...profile.reviewableTypes]
    avoidStatement.value = profile.avoidStatement
  },
  { immediate: true },
)

const tagCount = computed(() => tags.value.length)
const tagLimitReached = computed(() => tagCount.value >= 8)
const tagLimitText = computed(() => `最多填写 8 个（当前 ${tagCount.value} 个）`)

function addTag() {
  const value = tagsDraft.value.trim()
  if (!value) return
  if (tags.value.includes(value)) {
    tagsDraft.value = ''
    return
  }
  if (tags.value.length >= 8) {
    tagsDraft.value = ''
    return
  }
  tags.value = [...tags.value, value]
  tagsDraft.value = ''
}

function removeTag(tag: string) {
  tags.value = tags.value.filter((item) => item !== tag)
}

function toggleReviewableType(option: string) {
  reviewableTypes.value = reviewableTypes.value.includes(option)
    ? reviewableTypes.value.filter((item) => item !== option)
    : [...reviewableTypes.value, option]
}

function submit() {
  emit('save', {
    contact: contact.value,
    unit: unit.value,
    title: title.value,
    discipline: { ...discipline.value },
    researchTags: [...tags.value],
    reviewableTypes: [...reviewableTypes.value],
    avoidStatement: avoidStatement.value,
  })
}
</script>

<template>
  <form class="profile-form" @submit.prevent="submit">
    <section class="profile-form__section">
      <h2>基本信息</h2>
      <p class="profile-form__hint">姓名按平台策略只读；资料变更经平台审核后用于候选匹配（演示投影）。</p>
      <div class="profile-form__grid">
        <label>
          <span>姓名</span>
          <input
            data-field="name"
            type="text"
            :value="profile.name"
            readonly
            aria-readonly="true"
            title="姓名按平台策略只读"
          />
        </label>
        <label>
          <span>联系方式</span>
          <input
            v-model="contact"
            data-field="contact"
            type="text"
            autocomplete="off"
            placeholder="请填写联系电话或邮箱"
          />
        </label>
        <label>
          <span>所属单位</span>
          <input v-model="unit" data-field="unit" type="text" placeholder="请填写所属单位" />
        </label>
        <label>
          <span>职称</span>
          <input v-model="title" data-field="title" type="text" placeholder="请填写职称" />
        </label>
      </div>
    </section>

    <section class="profile-form__section">
      <h2>评审能力</h2>
      <div class="profile-form__field">
        <DisciplineSelector v-model="discipline" />
      </div>
      <div class="profile-form__field">
        <label>
          <span>擅长评审领域</span>
          <p class="profile-form__field-hint">{{ tagLimitText }}；重复与空白输入会被自动忽略。</p>
          <div class="tag-input">
            <input
              v-model="tagsDraft"
              data-field="tags"
              type="text"
              placeholder="输入方向后回车添加"
              :disabled="tagLimitReached"
              @keydown.enter.prevent="addTag"
              @blur="addTag"
            />
          </div>
        </label>
        <div v-if="tags.length > 0" class="tag-list">
          <span v-for="tag in tags" :key="tag" class="tag-list__tag">
            {{ tag }}
            <button
              type="button"
              :data-remove-tag="tag"
              aria-label="删除标签"
              @click="removeTag(tag)"
            >
              ×
            </button>
          </span>
        </div>
        <p v-if="tagLimitReached" class="profile-form__warn">已满 8 个方向，请先删除再添加。</p>
      </div>
      <div class="profile-form__field">
        <span>可评论文类型</span>
        <div class="type-options">
          <label v-for="option in REVIEWABLE_TYPE_OPTIONS" :key="option" class="type-options__item">
            <input
              type="checkbox"
              :checked="reviewableTypes.includes(option)"
              @change="toggleReviewableType(option)"
            />
            {{ option }}
          </label>
        </div>
      </div>
    </section>

    <section class="profile-form__section">
      <h2>回避声明</h2>
      <p class="profile-form__hint">
        请补充声明与本人存在利益冲突、可能影响公正评阅的关系（如导师、同事、合作者等），平台据此执行回避规则。
      </p>
      <textarea
        v-model="avoidStatement"
        data-field="avoid-statement"
        rows="3"
        placeholder="如无补充可留空（演示投影，不宣称自动检测）。"
      ></textarea>
    </section>

    <footer class="profile-form__footer">
      <p v-if="saved" class="profile-form__saved" role="status">资料已保存（本地演示投影，正式服务以后端为准）。</p>
      <button
        type="submit"
        data-action="save-profile"
        :disabled="saving"
        @click.prevent="submit"
      >
        {{ saving ? '正在保存…' : '保存资料' }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.profile-form {
  display: grid;
  gap: 1rem;
}

.profile-form__section {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--color-border, #d8e0e6);
  background: #fff;
}

.profile-form__section h2 {
  margin: 0;
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.profile-form__hint {
  margin: 0;
  color: #71808c;
  font-size: 0.7rem;
  line-height: 1.6;
}

.profile-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.profile-form__grid label,
.profile-form__field label {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}

.profile-form__grid label > span,
.profile-form__field > span {
  color: #4a5965;
  font-size: 0.72rem;
  font-weight: 650;
}

.profile-form__grid input,
.profile-form__field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.65rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.3rem;
  background: #fbfcfe;
  color: #33414d;
  font-size: 0.78rem;
}

.profile-form__grid input[readonly] {
  background: #eef1f4;
  color: #5d6b76;
  cursor: not-allowed;
}

.profile-form__field {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
}

.profile-form__field-hint {
  margin: 0;
  color: #7a8791;
  font-size: 0.66rem;
}

.tag-input input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.65rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.3rem;
  background: #fbfcfe;
  color: #33414d;
  font-size: 0.78rem;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-list__tag {
  display: inline-flex;
  gap: 0.3rem;
  align-items: center;
  padding: 0.22rem 0.45rem;
  border-radius: 999px;
  background: #edf1f4;
  color: #53636f;
  font-size: 0.68rem;
}

.tag-list__tag button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #7a8791;
  cursor: pointer;
}

.profile-form__warn {
  margin: 0;
  color: #b03232;
  font-size: 0.68rem;
}

.type-options {
  display: flex;
  gap: 1rem;
}

.type-options__item {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
  color: #33414d;
  font-size: 0.78rem;
}

.profile-form__footer {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: flex-end;
}

.profile-form__footer button {
  padding: 0.55rem 1.1rem;
  border: 1px solid #1b4f8a;
  border-radius: 0.3rem;
  background: #1b4f8a;
  color: #fff;
  font-weight: 650;
  cursor: pointer;
}

.profile-form__footer button:disabled {
  border-color: #d8dee3;
  background: #f2f4f6;
  color: #a3adb6;
  cursor: not-allowed;
}

.profile-form__saved {
  margin: 0;
  color: #28642d;
  font-size: 0.72rem;
}

@media (max-width: 640px) {
  .profile-form__grid {
    grid-template-columns: 1fr;
  }
}
</style>
