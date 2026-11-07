/**
 * 学生论文编辑会话：建稿（D5）、读取、内容保存（content_revision 不透明原样回传）、
 * 绑定上传与 PDF 变换（D4：If-Draft-Revision 由 files/pdfTransforms 接口带上，成功后换用新指纹）、
 * 匿名检测、提交前核对与提交（幂等键按快照稳定）。
 * U2-3 从 ThesisEditPage 原样搬出：旧页与新编辑页共用，旧页既有 spec 不改一行即通过。
 * 页面相关的焦点处理以回调传入，不在这里碰 DOM。
 */
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'

import { createThesis, getThesis, patchThesis, submitThesis, type ThesisDetail } from '@/api/theses'
import { checkSensitiveThesis } from '@/api/sensitiveChecks'
import { uploadThesisFile } from '@/api/files'
import { toStudentThesisDetail } from '@/api/adapters'
import type { ScenarioService, StudentDraftInput, StudentThesisDetail, ThesisFileMeta } from '@/demo/types'
import { useAuthStore } from '@/stores/auth'
import { studentPrograms,type ProgramOptions } from '@/api/schoolPrograms'
import { getMyDisciplines, type CatalogOption } from '@/api/catalogs'

import type { StudentIdentityView } from '../components/StudentIdentityPanel.vue'

export type ValidationField = 'title' | 'abstract' | 'discipline' | 'keywords' | 'original' | 'anonymous'

export interface ThesisEditorOptions {
  /** demo 模式传入演示服务；真实模式为 null */
  service: ScenarioService | null
  /** 提交前核对发现缺项时聚焦对应字段 */
  focusField?: (field: ValidationField) => void
  /** 提交确认框打开 / 关闭后的焦点处理 */
  onConfirmationOpened?: () => void
  onConfirmationClosed?: () => void
}

export function useThesisEditor({ service, focusField, onConfirmationOpened, onConfirmationClosed }: ThesisEditorOptions) {

  const route = useRoute()
  const router = useRouter()
  const authStore = useAuthStore()
  const demoEnabled = Boolean(service)
  const pendingUploads = ref<Partial<Record<'SCHOOL_ARCHIVE' | 'EXPERT_REVIEW', File>>>({})
  const liveVersion = ref(1)
  const realDetail = ref<ThesisDetail | null>(null)
  const checking = ref(false)
  const transformOpen = ref(false)
  const preparingTransform = ref(false)
  const checkError = ref('')
  let checkGeneration = 0
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
      if (failure.field) focusField?.(failure.field)
      return
    }
    validationError.value = ''
    showConfirmation.value = true
    await nextTick()
    onConfirmationOpened?.()
  }

  async function closeSubmitConfirmation() {
    if (submitting.value) return
    showConfirmation.value = false
    submitError.value = ''
    await nextTick()
    onConfirmationClosed?.()
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

  return {
    authStore,
    demoEnabled,
    pendingUploads,
    liveVersion,
    realDetail,
    checking,
    transformOpen,
    preparingTransform,
    checkError,
    thesisId,
    anonymousId,
    loading,
    loadError,
    disciplineOptions,
    programs,
    localCode,
    localOptions,
    shownProgram,
    chooseProgram,
    selectedProgram,
    createTitle,
    createKeywordText,
    createError,
    existingId,
    createKeywords,
    newDiscipline,
    dirty,
    saving,
    saveFailed,
    contentRevision,
    saveConflict,
    serverCopy,
    compareServerCopy,
    lastSavedAt,
    formRevision,
    validationError,
    submitError,
    showConfirmation,
    submitting,
    refreshingChecklist,
    demoDialogOpen,
    form,
    identity,
    copyFiles,
    loadDraft,
    startDraft,
    updateForm,
    onNativeFile,
    draftSnapshot,
    persistDraft,
    uploadBoundFile,
    checkDraft,
    clearEditor,
    openTransform,
    appliedTransform,
    saveDraft,
    issues,
    openSubmitConfirmation,
    closeSubmitConfirmation,
    confirmSubmit,
  }
}
