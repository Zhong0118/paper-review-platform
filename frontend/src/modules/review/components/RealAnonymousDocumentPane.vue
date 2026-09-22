<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getMaterials } from '@/api/expertTasks'
import { getFileContent } from '@/api/files'

const props = defineProps<{ taskId: string }>()
const url = ref('')
const loading = ref(false)
const error = ref('')
let request = 0

function clearFile() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}

async function load() {
  const current = ++request
  clearFile()
  loading.value = true
  error.value = ''
  try {
    const materials = await getMaterials(props.taskId)
    if (current !== request) return
    const file = materials.files.find(item => item.purpose === 'anonymous')
    if (!file) throw new Error('匿名论文暂不可用，请联系学校审核人员。')
    const blob = await getFileContent(file.file_id)
    if (current !== request) return
    if (blob.type !== 'application/pdf') throw new Error('返回的文件不是 PDF，请联系学校审核人员。')
    url.value = URL.createObjectURL(blob)
  } catch {
    if (current === request) error.value = '匿名论文加载失败或已无权访问，请重试或返回任务列表。'
  } finally {
    if (current === request) loading.value = false
  }
}

watch(() => props.taskId, load, { immediate: true })
onBeforeUnmount(() => { request++; clearFile() })
</script>

<template>
  <section class="real-document" aria-label="匿名论文阅读区">
    <header>
      <h2>匿名论文.pdf</h2>
      <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer">在新窗口阅读</a>
    </header>
    <p v-if="loading" role="status">正在加载匿名论文…</p>
    <div v-else-if="error" role="alert">
      <p>{{ error }}</p>
      <button type="button" data-action="retry-materials" @click="load">重新加载</button>
    </div>
    <template v-else-if="url">
      <p>如内嵌阅读器无法显示，请在新窗口阅读。浏览器可能提供保存和打印功能。</p>
      <iframe :src="url" title="匿名论文 PDF" referrerpolicy="no-referrer" />
    </template>
  </section>
</template>

<style scoped>
.real-document {
  min-width: 0;
  height: 100%;
  border: 1px solid #d7dfe6;
  background: #e7ebef;
}
header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; }
h2 { font-size: 1rem; margin: 0; }
p, [role='alert'] { padding: 0 1rem; color: #53636f; }
a, button { color: #1b4f8a; }
iframe { display: block; width: 100%; min-height: 42rem; height: 75vh; border: 0; background: white; }
</style>
