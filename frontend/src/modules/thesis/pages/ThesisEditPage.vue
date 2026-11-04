<script setup lang="ts">
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { createThesis, getThesis, patchThesis, submitThesis, type ThesisDetail } from '@/api/theses'
import PdfTransformDialog from '@/components/app/PdfTransformDialog.vue'
import SensitiveFindingPanel from '@/components/app/SensitiveFindingPanel.vue'
import { checkSensitiveThesis } from '@/api/sensitiveChecks'
import { uploadThesisFile } from '@/api/files'
import { toStudentThesisDetail } from '@/api/adapters'
import type { StudentDraftInput, StudentThesisDetail, ThesisFileMeta } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import StudentIdentityPanel, {
  type StudentIdentityView,
} from '../components/StudentIdentityPanel.vue'
import StudentDemoScenarioController from '../components/StudentDemoScenarioController.vue'
import { studentPrograms,type ProgramOptions } from '@/api/schoolPrograms'
import { getMyDisciplines, type CatalogOption } from '@/api/catalogs'
import DisciplineSelector from '../components/DisciplineSelector.vue'
import ThesisMaterialEditor from '../components/ThesisMaterialEditor.vue'

type ValidationField = 'title' | 'abstract' | 'discipline' | 'keywords' | 'original' | 'anonymous'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const pendingUploads = ref<Partial<Record<'SCHOOL_ARCHIVE' | 'EXPERT_REVIEW', File>>>({})
const liveVersion = ref(1)
const realDetail = ref<ThesisDetail | null>(null)
const checking = ref(false)
const transformOpen = ref(false)
const preparingTransform = ref(false)
const checkError = ref('')
let checkGeneration = 0
const editor = ref<InstanceType<typeof ThesisMaterialEditor>>()
const submitOpener = ref<HTMLButtonElement>()
const confirmDialog = ref<HTMLElement>()
const cancelConfirmation = ref<HTMLButtonElement>()
const thesisId = ref('')
const anonymousId = ref('')
const loading = ref(true)
const loadError = ref('')
const disciplineOptions = ref<CatalogOption[]>([])
const programs = ref<ProgramOptions>({catalog_id:null,items:[]})
const localCode = ref('')
const localOptions = computed(()=>programs.value.items.map(item=>({code:item.code,name:`${item.name} · ${item.official_code} ${item.official_name}`})))
const shownProgram = computed(()=>{
  const choice=localOptions.value.find(item=>item.code===localCode.value)
  if(choice)return choice
  const old=realDetail.value?.current_version?.school_program
  return old && old.code===localCode.value ? {code:old.code,name:old.name} : undefined
})
function chooseProgram(value:{code:string;name:string}) {
  const item=programs.value.items.find(p=>p.code===value.code)
  if(!item)return
  localCode.value=item.code
  const official={code:item.official_code,name:item.official_name}
  if(!thesisId.value)newDiscipline.value=official
  else updateForm({...form.value,discipline:official})
}
function selectedProgram(){
  return programs.value.catalog_id && localCode.value ? {program:{catalog_id:programs.value.catalog_id,code:localCode.value}} : {}
}
const createTitle = ref('')
const createKeywordText = ref('')
const createError = ref('')
const existingId = ref('')
const createKeywords = computed(()=>[...new Set(createKeywordText.value.split(/[,，;；、\n]/).map(x=>x.trim()).filter(Boolean))])
const newDiscipline = ref<{code:string;name:string}>()
const dirty = ref(false)
const saving = ref(false)
const saveFailed = ref(false)
const contentRevision = ref('')
const saveConflict = ref(false)
const serverCopy = ref<ThesisDetail | null>(null)
async function compareServerCopy() {
  const gen=checkGeneration, id=thesisId.value
  try {
    const copy=await getThesis(id)
    if(gen===checkGeneration && id===thesisId.value) serverCopy.value=copy
  } catch { if(gen===checkGeneration) validationError.value='读取服务器版本失败，请重试。' }
}
const lastSavedAt = ref('')
const formRevision = ref(0)
const validationError = ref('')
const submitError = ref('')
let submitAttempt: {snapshot:string; key:string}|undefined
const showConfirmation = ref(false)
const submitting = ref(false)
const refreshingChecklist = ref(false)
const demoDialogOpen = ref(false)
const form = ref<StudentDraftInput>({
  title: '',
  abstract: '',
  discipline: { code: '', name: '' },
  keywords: [],
  files: [],
})
const identity = ref<StudentIdentityView>({
  school: '海岳大学',
  college: '计算机学院',
  studentId: '20260042',
  studentName: '林知远',
  trainingLevel: '硕士研究生',
  degreeType: '工学硕士',
  supervisor: '赵文博教授',
  batch: '2026 年春季硕士论文盲审',
  deadline: '2026-05-20 18:00',
})

function copyFiles(files: ThesisFileMeta[]) {
  return files.map((file) => ({ ...file }))
}

async function loadDraft() {
  const gen=++checkGeneration
  loading.value = true
  loadError.value = ''
  try {
    const requestedId = String(route.query.thesisId ?? (demoEnabled ? 'thesis-main' : 'new'))
    let liveDetail: ThesisDetail | null = null
    let thesis: StudentThesisDetail
    if (demoEnabled && service) {
      thesis = requestedId === 'new'
        ? await service.createStudentDraft()
        : await service.getStudentThesis(requestedId)
    } else {
      const [official,local] = await Promise.all([getMyDisciplines(),studentPrograms(requestedId==='new'?undefined:requestedId)])
      if (gen!==checkGeneration) return
      disciplineOptions.value=official;programs.value=local;localCode.value='';newDiscipline.value=undefined
      if (requestedId === 'new') { thesisId.value = ''; return }
      liveDetail = await getThesis(requestedId)
      if (gen!==checkGeneration) return
      contentRevision.value=liveDetail.current_version?.content_revision ?? ''
      realDetail.value = liveDetail
      localCode.value=liveDetail.current_version?.school_program?.code ?? ''
      thesis = toStudentThesisDetail(liveDetail)
    }
    liveVersion.value = Number((thesis as { version?: number }).version ?? 1)
    thesisId.value = thesis.id
    anonymousId.value = thesis.anonymousId
    form.value = {
      title: thesis.form.title,
      abstract: thesis.form.abstract,
      discipline: { ...thesis.form.discipline },
      keywords: [...thesis.form.keywords],
      files: copyFiles(thesis.files),
    }
    identity.value = liveDetail ? {
      school: liveDetail.student?.tenant_name || '未提供',
      college: liveDetail.student?.college_name || '未提供',
      studentId: liveDetail.student?.student_no || '未提供',
      studentName: liveDetail.student?.name || '未提供',
      trainingLevel: '未提供',
      degreeType: liveDetail.student?.degree_type || '未提供',
      supervisor: liveDetail.student?.supervisor_name || '未提供',
      batch: liveDetail.review_batch?.name || liveDetail.batch_name || '未提供',
      deadline: liveDetail.review_batch?.end_at || '未设置',
    } : {
      ...identity.value,
      school: thesis.student.tenantName || identity.value.school,
      studentId: thesis.studentId || thesis.student.id,
      studentName: thesis.studentName || thesis.student.name,
      batch: thesis.batchName || identity.value.batch,
    }
    if (requestedId === 'new') {
      await router.replace({ query: { ...route.query, thesisId: thesis.id } })
    }
    dirty.value = false
  } catch (error) {
    if (gen!==checkGeneration) return
    loadError.value = error instanceof Error ? error.message : '论文材料加载失败。'
  } finally {
    if(gen===checkGeneration) loading.value = false
  }
}

async function startDraft() {
  if (!newDiscipline.value || !createTitle.value.trim() || !createKeywords.value.length || createKeywords.value.length>5 || saving.value) return
  saving.value=true; createError.value=''; existingId.value=''
  const generation=checkGeneration
  try {
    const draft=await createThesis({title:createTitle.value.trim(),abstract:'',keywords:createKeywords.value,
      ...selectedProgram(),discipline_code:newDiscipline.value.code,discipline_name:newDiscipline.value.name})
    if (generation!==checkGeneration) return
    await router.replace({query:{...route.query,thesisId:draft.id}})
  } catch (error) {
    if (generation!==checkGeneration) return
    const body=(error as {response?:{data?:{code?:string;message?:string;data?:{id?:string}}}})?.response?.data
    if (body?.code==='VERSION_CONFLICT' && body.data?.id) {
      existingId.value=body.data.id; createError.value='本批次已有有效论文，可打开已有记录。'
    } else createError.value=body?.message ?? (error instanceof Error ? error.message : '创建草稿失败，请重试。')
  } finally { saving.value=false }
}

function updateForm(value: StudentDraftInput) {
  form.value = value
  for (const purpose of ['SCHOOL_ARCHIVE', 'EXPERT_REVIEW'] as const) {
    if (!value.files.some(file => file.purpose === purpose)) delete pendingUploads.value[purpose]
  }
  formRevision.value += 1
  dirty.value = true
  saveFailed.value = false
  validationError.value = ''
}

function onNativeFile(payload: { purpose: ThesisFileMeta['purpose']; file: File }) {
  if (payload.purpose === 'SCHOOL_ARCHIVE' || payload.purpose === 'EXPERT_REVIEW') {
    pendingUploads.value[payload.purpose] = payload.file
  }
}

function draftSnapshot(): StudentDraftInput {
  return {
    title: form.value.title,
    abstract: form.value.abstract,
    discipline: { ...form.value.discipline },
    keywords: [...form.value.keywords],
    files: copyFiles(form.value.files),
  }
}

async function persistDraft(snapshot: StudentDraftInput, revision: number) {
  if (saving.value || !thesisId.value) return false
  const gen=checkGeneration
  saving.value = true
  saveFailed.value = false
  try {
    const saved =
      demoEnabled && service
        ? await service.saveStudentDraft(thesisId.value, snapshot)
        : await patchThesis(thesisId.value, {
            expected_content_revision:contentRevision.value,
            ...(localCode.value !== (realDetail.value?.current_version?.school_program?.code ?? '') ? selectedProgram() :
              {discipline_code:snapshot.discipline.code,discipline_name:snapshot.discipline.name}),
            title: snapshot.title,
            abstract: snapshot.abstract,
            keywords: snapshot.keywords,
          })
    if (gen!==checkGeneration) return false
    if (!demoEnabled) contentRevision.value=(saved as ThesisDetail).current_version?.content_revision ?? ''
    saveConflict.value=false; serverCopy.value=null
    if (!demoEnabled && formRevision.value === revision) realDetail.value = saved as ThesisDetail
    if (!demoEnabled) liveVersion.value = (saved as { version?: number }).version ?? liveVersion.value
    if (formRevision.value === revision) dirty.value = false
    lastSavedAt.value =
      demoEnabled && saved && 'updatedAt' in saved
        ? String(saved.updatedAt)
        : new Date().toISOString()
    return true
  } catch(error) {
    if(gen!==checkGeneration) return false
    saveConflict.value=(error as {response?:{status?:number}})?.response?.status===409
    saveFailed.value = true
    return false
  } finally {
    if(gen===checkGeneration) saving.value=false
  }
}

async function uploadBoundFile(purpose:'original'|'anonymous', file: File) {
  const gen=checkGeneration
  const result=await uploadThesisFile({thesisId:thesisId.value,purpose,file,token:authStore.accessToken!,revision:contentRevision.value})
  if (gen!==checkGeneration || !result?.content_revision) throw new Error('材料版本已变化，请核对后重试')
  contentRevision.value=result.content_revision
}

async function checkDraft() {
  if (checking.value || saving.value || submitting.value || !thesisId.value) return
  if (!form.value.files.some(file => file.purpose === 'EXPERT_REVIEW')) {
    checkError.value = '请先选择匿名 PDF 材料'; return
  }
  const request = ++checkGeneration
  const revision = formRevision.value
  checking.value = true; checkError.value = ''
  try {
    if (!await persistDraft(draftSnapshot(), revision)) return
    if (request !== checkGeneration || revision !== formRevision.value) return
    const raw = pendingUploads.value.EXPERT_REVIEW
    if (raw && authStore.accessToken) {
      await uploadBoundFile('anonymous',raw)
      if (request !== checkGeneration) return
      if (pendingUploads.value.EXPERT_REVIEW === raw) delete pendingUploads.value.EXPERT_REVIEW
    }
    const detail = await getThesis(thesisId.value)
    if (request !== checkGeneration || revision !== formRevision.value) return
    if ((detail.current_version?.content_revision ?? '')!==contentRevision.value) {
      saveConflict.value=true; checkError.value='材料或论文内容已变更，请核对服务器版本。'; return
    }
    realDetail.value = detail
    const anonymous = detail.current_version?.files.find(f=>f.purpose === 'anonymous')
    if (!anonymous) { checkError.value = '请先选择匿名 PDF 材料'; return }
    const report = await checkSensitiveThesis(detail.id,{expected_version:detail.version,file_id:anonymous.file_id})
    if (request !== checkGeneration || revision !== formRevision.value) return
    realDetail.value = {...detail,anonymization:report}
  } catch(e) { if (request === checkGeneration) checkError.value = e instanceof Error ? e.message : '检测失败，请重试' }
  finally { if (request === checkGeneration) checking.value = false }
}
function clearEditor() {
  submitAttempt=undefined; checkGeneration++; dirty.value=false; pendingUploads.value={}; formRevision.value++
  thesisId.value=''; realDetail.value=null; serverCopy.value=null; contentRevision.value=''; saveConflict.value=false
  form.value={title:'',abstract:'',keywords:[],discipline:{code:'',name:''},files:[]}
  createTitle.value=''; createKeywordText.value=''; createError.value=''; existingId.value=''; lastSavedAt.value='';saveFailed.value=false
  saving.value=false; submitting.value=false; showConfirmation.value=false; checking.value=false
}
watch(()=>route.query.thesisId, (id,old)=>{
  if(demoEnabled || id===old || route.path!=='/student/thesis/edit') return
  clearEditor(); void loadDraft()
})
onBeforeRouteUpdate((to,from)=> from.query.thesisId===to.query.thesisId || !dirty.value || window.confirm('当前修改尚未保存，确认离开吗？'))
watch(() => [authStore.user?.id,authStore.user?.tenantId,authStore.user?.role], () => {
  clearEditor(); checkError.value='';transformOpen.value=false; loading.value=true
  if(authStore.user && !demoEnabled) void loadDraft()
})
onBeforeUnmount(()=>{checkGeneration++})

async function openTransform() {
  if (saving.value || submitting.value || checking.value || preparingTransform.value) return
  preparingTransform.value = true; checkError.value = ''
  const revision = formRevision.value
  const identity = authStore.user?.id
  try {
    if (!await persistDraft(draftSnapshot(), revision)) return
    for (const [local, purpose] of [['SCHOOL_ARCHIVE','original'],['EXPERT_REVIEW','anonymous']] as const) {
      const file = pendingUploads.value[local]
      if (file && authStore.accessToken) {
        await uploadBoundFile(purpose,file)
        if (pendingUploads.value[local] === file) delete pendingUploads.value[local]
      }
    }
    if (revision !== formRevision.value || identity !== authStore.user?.id) return
    await loadDraft()
    if (!loadError.value && realDetail.value?.stage === 'DRAFT') transformOpen.value = true
  } catch(e) { checkError.value = e instanceof Error ? e.message : 'PDF 材料准备失败' }
  finally { preparingTransform.value = false }
}
async function appliedTransform() { transformOpen.value = false; await loadDraft() }

async function saveDraft() {
  await persistDraft(draftSnapshot(), formRevision.value)
}

const issues = computed(() => {
  const items: Array<{field: ValidationField | null; message: string}> = []
  const add = (field: ValidationField | null, message: string) => items.push({field, message})
  if (!demoEnabled && !realDetail.value?.draft_eligibility_status)
    add(null, '缺少原批次资格记录，请联系学校审核员')
  if (!form.value.title.trim()) add('title', '请填写论文题目。')
  if (!form.value.abstract.trim()) add('abstract', '请填写论文摘要。')
  if (!form.value.discipline.code) add('discipline', '请选择学科专业。')
  else if (!demoEnabled && !disciplineOptions.value.some(d => d.code === form.value.discipline.code && d.name === form.value.discipline.name))
    add('discipline', '所选专业不在本校开放目录，请重选或联系学校审核员。')
  if (localCode.value && !programs.value.items.some(p=>p.code===localCode.value))
    add('discipline','校内专业当前不可选择，请重选或联系学校审核员。')
  if (!form.value.keywords.length) add('keywords', '请至少填写 1 个关键词。')
  if (!form.value.files.some(f => f.purpose === 'SCHOOL_ARCHIVE' && f.validationStatus === 'VALID'))
    add('original', '请上传原始版论文。')
  if (!form.value.files.some(f => f.purpose === 'EXPERT_REVIEW' && ['VALID','REVIEW_REQUIRED'].includes(f.validationStatus)))
    add('anonymous', '请上传匿名版论文。')
  return items
})

async function openSubmitConfirmation() {
  if (!demoEnabled) {
    if (refreshingChecklist.value || saving.value || checking.value || submitting.value) return
    const id = thesisId.value, generation = checkGeneration
    refreshingChecklist.value = true
    try {
      const [detail, options, local] = await Promise.all([getThesis(id), getMyDisciplines(), studentPrograms(id)])
      if (generation !== checkGeneration || id !== thesisId.value) return
      if (detail.stage !== 'DRAFT' || detail.version !== liveVersion.value ||
          detail.current_version?.id !== realDetail.value?.current_version?.id || (detail.current_version?.content_revision ?? '') !== contentRevision.value) {
        validationError.value = '论文状态或版本已变化，请刷新页面后核对。'; return
      }
      realDetail.value = detail
      disciplineOptions.value = options
      programs.value=local
    } catch {
      validationError.value = '未能核对本批资格和开放专业，请重试。'; return
    } finally { refreshingChecklist.value = false }
  }
  const failure = issues.value[0]
  if (failure) {
    validationError.value = failure.message
    await nextTick()
    if (failure.field) editor.value?.focusField(failure.field)
    return
  }
  validationError.value = ''
  showConfirmation.value = true
  await nextTick()
  cancelConfirmation.value?.focus()
}

async function closeSubmitConfirmation() {
  if (submitting.value) return
  showConfirmation.value = false
  submitError.value = ''
  await nextTick()
  submitOpener.value?.focus()
}

function handleConfirmationKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeSubmitConfirmation()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(
    confirmDialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
  )
  if (focusable.length === 0) return
  const activeIndex = focusable.indexOf(document.activeElement as HTMLButtonElement)
  const nextIndex = event.shiftKey
    ? activeIndex <= 0
      ? focusable.length - 1
      : activeIndex - 1
    : activeIndex < 0 || activeIndex === focusable.length - 1
      ? 0
      : activeIndex + 1
  event.preventDefault()
  focusable[nextIndex]?.focus()
}

async function confirmSubmit() {
  if (submitting.value || checking.value || !thesisId.value) return
  const generation=checkGeneration
  submitting.value = true
  submitError.value = ''
  try {
    if (dirty.value) {
      const revision = formRevision.value
      const saved = await persistDraft(draftSnapshot(), revision)
      if (!saved) {
        submitError.value = '提交前保存失败，请重试。'
        return
      }
      if (formRevision.value !== revision) {
        submitError.value = '材料已发生新的修改，请重新确认提交。'
        return
      }
    }
    if (!demoEnabled && authStore.accessToken) {
      for (const [purpose, raw] of Object.entries(pendingUploads.value)) {
        if (!raw) continue
        await uploadBoundFile(purpose==='SCHOOL_ARCHIVE'?'original':'anonymous',raw)
        if(pendingUploads.value[purpose as keyof typeof pendingUploads.value]===raw)
          delete pendingUploads.value[purpose as keyof typeof pendingUploads.value]
      }
    }
    if (demoEnabled && service) await service.submitStudentThesis(thesisId.value)
    else {
      const snapshot=JSON.stringify([authStore.user?.id,thesisId.value,liveVersion.value,contentRevision.value])
      if(submitAttempt?.snapshot!==snapshot) submitAttempt={snapshot,key:crypto.randomUUID()}
      await submitThesis(thesisId.value, liveVersion.value, contentRevision.value,{idempotencyKey:submitAttempt.key})
    }
    if(generation!==checkGeneration) return
    dirty.value = false
    showConfirmation.value = false
    await router.push('/student/dashboard')
  } catch {
    if(generation!==checkGeneration) return
    submitError.value = demoEnabled ? '提交失败，请重试。' : '提交失败，请关闭确认框，重新核对资格、专业和文件后重试。'
  } finally {
    submitting.value = false
  }
}

onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm('当前修改尚未保存，确认离开吗？')
})

void loadDraft()
</script>

<template>
  <PortalLayout
    :menu-items="portalMenus('student', demoEnabled)"
    active-path="/student/dashboard"
    :context-label="demoEnabled ? '学生端 · 海岳大学' : '学生端 · ' + (authStore.user?.tenantCode ?? '本校')"
    :user-name="authStore.user?.displayName ?? '林知远'"
    :background-locked="showConfirmation || demoDialogOpen"
  >
    <div class="edit-page">
      <PageHeader
        eyebrow="PAGE-003 · THESIS SUBMISSION"
        title="论文信息与材料提交"
        description="提交前请同时核对原始论文与匿名版。匿名版不得包含姓名、导师、致谢及可识别个人身份的信息。"
      >
        <template #actions>
          <button
            class="button button--quiet"
            type="button"
            @click="router.push('/student/dashboard')"
          >
            返回工作台
          </button>
        </template>
      </PageHeader>

      <BlindRail
        audience="本人论文信息与学校审核状态"
        hidden-from="评审专家只能看到匿名论文号和匿名版材料"
        stage="提交准备"
      />

      <p v-if="loading" class="page-state">正在加载论文草稿…</p>
      <p v-else-if="loadError" class="page-state page-state--error" role="alert">{{ loadError }} <button type="button" @click="loadDraft">重试加载</button></p>

      <section v-else-if="!demoEnabled && !thesisId" class="paper-form">
        <h2>新建送审论文</h2>
        <label>论文题目 <input v-model="createTitle" data-create-title maxlength="255" required></label>
        <label>关键词（1 至 5 个，用逗号分隔） <input v-model="createKeywordText" data-create-keywords required></label>
        <template v-if="programs.catalog_id"><p>从本批固定的校内目录选择，校码后显示对应官方学科。</p>
          <DisciplineSelector :model-value="shownProgram" :options="localOptions" @update:model-value="chooseProgram"/>
          <p v-if="!localOptions.length">本批暂无开放的校内专业，请联系学校审核员。</p></template>
        <DisciplineSelector v-else v-model="newDiscipline" :options="disciplineOptions" />
        <p v-if="!programs.catalog_id && !disciplineOptions.length">本校暂无可选学科，请联系学校审核员。</p>
        <button type="button" data-action="create-selected-draft" :disabled="!newDiscipline || !createTitle.trim() || !createKeywords.length || createKeywords.length>5 || saving" @click="startDraft">创建论文草稿</button>
        <p v-if="createError" role="alert">{{ createError }} <button v-if="existingId" type="button" data-open-existing @click="router.replace({query:{...route.query,thesisId:existingId}})">打开已有论文</button><button v-else type="button" @click="loadDraft">刷新可选专业</button></p>
      </section>
      <section v-else-if="!demoEnabled && realDetail && (realDetail.stage!=='DRAFT' || !realDetail.current_version?.is_editable)" class="paper-form">
        <h2>{{ realDetail.current_version?.title || '已有论文' }}</h2>
        <p>本批次已有这篇论文，当前版本不可编辑。请返回工作台查看进度和可执行操作。</p>
        <RouterLink to="/student/dashboard">查看我的论文</RouterLink>
      </section>
      <form v-else class="paper-form" @submit.prevent>
        <StudentIdentityPanel :identity="identity" />
        <ThesisMaterialEditor
          ref="editor"
          :model-value="form"
          :discipline-options="demoEnabled ? undefined : disciplineOptions"
          :identity-tokens="[identity.studentName, identity.studentId]"
          @update:model-value="updateForm"
          @native-file="onNativeFile">
          <template v-if="!demoEnabled && programs.catalog_id" #discipline>
            <div><p>校内专业 · 本批固定目录</p>
            <p v-if="!localCode">原稿已选官方学科 {{form.discipline.code}} {{form.discipline.name}}；可保留原稿，或主动改选校内专业。</p>
            <DisciplineSelector :model-value="shownProgram" :options="localOptions" @update:model-value="chooseProgram"/>
            <p v-if="!localOptions.length">当前无可选项，请联系学校审核员。</p></div>
          </template>
        </ThesisMaterialEditor>

        <button v-if="!demoEnabled && realDetail?.stage === 'DRAFT'" type="button" data-open-pdf-transform
          :disabled="saving || submitting || checking || preparingTransform" @click="openTransform">{{preparingTransform ? '正在保存材料…' : '保存并处理 PDF 材料'}}</button>
        <Transition name="confirmation"><PdfTransformDialog v-if="transformOpen && realDetail" :thesis-id="realDetail.id" :version="realDetail.version" :content-revision="contentRevision"
          :files="realDetail.current_version?.files ?? []" @close="transformOpen=false" @applied="appliedTransform" /></Transition>
        <SensitiveFindingPanel v-if="!demoEnabled && realDetail" :detail="realDetail" :busy="checking"
          :disabled="saving || submitting" :invalidated="dirty || !!pendingUploads.EXPERT_REVIEW || !form.files.some(file => file.purpose === 'EXPERT_REVIEW')" @check="checkDraft" />
        <p v-if="checkError" role="alert">{{checkError}}</p>
        <p v-if="validationError" class="validation-error" data-validation-error role="alert">
          {{ validationError }}
        </p>

        <section v-if="!demoEnabled && realDetail?.stage === 'DRAFT'" data-submit-checklist class="checklist">
          <h2>送审前核对</h2>
          <p v-if="realDetail.draft_eligibility_status === 'SUSPENDED'">原批次资格已暂停，仅限制新建论文；已有草稿仍可提交。</p>
          <p v-else-if="realDetail.draft_eligibility_status">已核对本论文的原批次资格记录</p>
          <ul v-if="issues.length"><li v-for="issue in issues" :key="issue.message">
            {{issue.message}} <button v-if="issue.field" type="button" @click="editor?.focusField(issue.field)">去填写</button>
          </li></ul>
          <p v-else>当前表单没有缺项，提交时将再次核验专业和文件。</p>
          <p v-if="pendingUploads.SCHOOL_ARCHIVE || pendingUploads.EXPERT_REVIEW">本地已选文件会在确认提交时上传，尚未完成服务端核验。</p>
        </section>
        <footer class="paper-form__footer">
          <div>
            <p>系统将在学校确认匿名检测结果后，才允许进入专家匹配环节。</p>
            <div v-if="saveConflict" data-save-status role="alert">其他页面已改动内容或材料。本页输入已保留，请核对服务器版本。
              <button type="button" @click="compareServerCopy">查看服务器版本</button>
              <dl v-if="serverCopy?.current_version"><dt>服务器题目和摘要</dt><dd>{{serverCopy.current_version.title}} · {{serverCopy.current_version.abstract}}</dd>
                <dt>专业与关键词</dt><dd>{{serverCopy.current_version.discipline_name}} {{serverCopy.current_version.school_program?.code}} · {{serverCopy.current_version.keywords.join('、')}}</dd>
                <dt>服务器材料</dt><dd>{{serverCopy.current_version.files.map(f=>f.filename).join('、') || '无'}}</dd></dl>
              <p>请另存所需输入后，重新打开论文进行合并。</p></div>
            <small v-else-if="saveFailed" data-save-status>保存失败，请重试。</small>
            <small v-else-if="dirty" data-save-status>
              有未保存修改<span v-if="lastSavedAt"> · 上次保存 {{ lastSavedAt }}</span>
            </small>
            <small v-else-if="pendingUploads.SCHOOL_ARCHIVE || pendingUploads.EXPERT_REVIEW" data-save-status>元数据已保存；所选文件尚未上传</small>
            <small v-else-if="lastSavedAt" data-save-status>已保存 · {{ lastSavedAt }}</small>
            <small v-else data-save-status>材料已同步</small>
          </div>
          <div class="paper-form__actions">
            <button
              class="button button--quiet"
              data-action="save-draft"
              type="button"
              :disabled="saving"
              @click="saveDraft"
            >
              {{ saving ? '保存中…' : saveFailed ? '重新保存' : '保存草稿' }}
            </button>
            <button
              ref="submitOpener"
              class="button button--primary"
              data-action="open-submit-confirmation"
              type="button"
              :disabled="refreshingChecklist || saving || checking || submitting"
              @click="openSubmitConfirmation"
            >
              提交学校审核
            </button>
          </div>
        </footer>
      </form>
    </div>

    <StudentDemoScenarioController
      :enabled="demoEnabled"
      @changed="loadDraft"
      @reset-dialog-change="demoDialogOpen = $event"
    />

    <template #modal>
      <div v-if="showConfirmation" class="dialog-backdrop">
        <section
          ref="confirmDialog"
          class="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          @keydown="handleConfirmationKeydown"
        >
          <span class="confirm-dialog__mark" aria-hidden="true">审</span>
          <h2 id="confirm-title">确认提交论文？</h2>
          <p>
            提交后将进入学校材料审核。审核完成前你不能再次替换文件，如需修改请联系学校管理员退回。
          </p>
          <p v-if="submitError" class="confirm-dialog__error" data-submit-error role="alert">
            {{ submitError }}
          </p>
          <dl>
            <div>
              <dt>论文题目</dt>
              <dd>{{ form.title }}</dd>
            </div>
            <div>
              <dt>匿名论文号</dt>
              <dd>{{ anonymousId }}</dd>
            </div>
          </dl>
          <footer>
            <button
              ref="cancelConfirmation"
              class="button button--quiet"
              data-action="close-submit-confirmation"
              type="button"
              @click="closeSubmitConfirmation"
            >
              继续检查
            </button>
            <button
              class="button button--primary"
              data-action="confirm-submit"
              type="button"
              :disabled="submitting"
              @click="confirmSubmit"
            >
              {{ submitting ? '正在提交…' : '确认提交' }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.checklist{padding:1rem;border:1px solid #ccdbea;border-radius:.4rem}.checklist h2{font-size:1rem}.checklist li{margin:.35rem 0}.checklist button{color:#174a79;cursor:pointer}

.edit-page,
.paper-form {
  display: grid;
  gap: 1rem;
}

.page-state,
.validation-error {
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid #dce3e9;
  background: white;
  color: #52616d;
}

.page-state--error,
.validation-error {
  border-color: #dfb2ae;
  background: #fff7f6;
  color: #9a302b;
}

.paper-form__footer {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border: 1px solid #d6dee5;
  background: rgb(255 255 255 / 0.96);
  box-shadow: 0 -0.5rem 1.5rem rgb(31 55 76 / 0.06);
  backdrop-filter: blur(8px);
}

.paper-form__footer p,
.paper-form__footer small {
  display: block;
  margin: 0;
  color: #697680;
  font-size: 0.75rem;
}

.paper-form__footer small {
  margin-top: 0.25rem;
  color: #2d617b;
}

.paper-form__actions {
  display: flex;
  gap: 0.625rem;
}

.button {
  min-height: 2.5rem;
  padding: 0.5rem 0.875rem;
  border-radius: 0.375rem;
  font-weight: 650;
  cursor: pointer;
}

.button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.button--quiet {
  border: 1px solid #bec9d2;
  background: white;
  color: #42515d;
}

.button--primary {
  border: 1px solid #1b4f8a;
  background: #1b4f8a;
  color: white;
}

.dialog-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(20 32 42 / 0.48);
}

.confirm-dialog {
  width: min(30rem, 100%);
  padding: 1.5rem;
  border-top: 0.25rem solid #1b4f8a;
  background: white;
  box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.25);
}

.confirm-dialog__mark {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid #1b4f8a;
  color: #1b4f8a;
  font-family: var(--font-display);
}

.confirm-dialog h2 {
  margin: 0.75rem 0 0;
  color: #243746;
  font-family: var(--font-display);
}

.confirm-dialog p {
  color: #60707d;
  line-height: 1.7;
}

.confirm-dialog .confirm-dialog__error {
  padding: 0.625rem 0.75rem;
  border: 1px solid #dfb2ae;
  background: #fff7f6;
  color: #9a302b;
}

.confirm-dialog dl {
  padding: 0.75rem;
  background: #f4f7f9;
}

.confirm-dialog dl div,
.confirm-dialog footer {
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.confirm-dialog dd {
  margin: 0;
  text-align: right;
}

.confirm-dialog footer {
  margin-top: 1rem;
  justify-content: flex-end;
}

@media (max-width: 680px) {
  .paper-form__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .paper-form__actions {
    justify-content: flex-end;
  }
}
</style>
