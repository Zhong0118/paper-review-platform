<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    fileName?: string
    note?: string
  }>(),
  { fileName: '', note: '仅支持 PDF，单个文件不超过 100MB' },
)

const emit = defineEmits<{ selected: [fileName: string] }>()
const selectedName = ref(props.fileName)

function chooseDemoFile() {
  selectedName.value = props.fileName || 'HY-2026-0042.pdf'
  emit('selected', selectedName.value)
}
</script>

<template>
  <section class="file-upload">
    <div>
      <strong>{{ label }}</strong>
      <small>{{ note }}</small>
    </div>
    <div v-if="selectedName" class="file-upload__file">
      <span aria-hidden="true">PDF</span>
      <div><b>{{ selectedName }}</b><small>文件校验通过</small></div>
    </div>
    <button type="button" @click="chooseDemoFile">{{ selectedName ? '重新选择' : '选择演示文件' }}</button>
  </section>
</template>

<style scoped>
.file-upload {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px dashed #aebbc6;
  background: #f8fafc;
}

.file-upload strong,
.file-upload small,
.file-upload__file b {
  display: block;
}

.file-upload small {
  margin-top: 0.25rem;
  color: #75818b;
  font-size: 0.6875rem;
}

.file-upload__file {
  display: flex;
  gap: 0.625rem;
  align-items: center;
  padding: 0.625rem;
  border: 1px solid #dce3e9;
  background: white;
}

.file-upload__file > span {
  padding: 0.375rem;
  background: #c62828;
  color: white;
  font-family: var(--font-data);
  font-size: 0.625rem;
  font-weight: 700;
}

.file-upload button {
  width: fit-content;
  padding: 0.5rem 0.75rem;
  border: 1px solid #8ba7c2;
  border-radius: 0.375rem;
  background: white;
  color: #123d6b;
  cursor: pointer;
}
</style>
