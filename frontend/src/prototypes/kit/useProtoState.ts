/** 原型状态与 URL `?state=` 同步，便于截图复现与评审直达；不用于真实页面。 */
import { computed, inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export interface ProtoStateOption<S extends string = string> {
  value: S
  label: string
}

export function useProtoState<S extends string>(options: readonly ProtoStateOption<S>[], fallback: S) {
  const route = useRoute()
  const router = useRouter()
  return computed<S>({
    get: () => {
      const raw = route.query.state
      return options.some((option) => option.value === raw) ? (raw as S) : fallback
    },
    set: (value) => {
      void router.replace({ query: { ...route.query, state: value } })
    },
  })
}

const notesKey: InjectionKey<Ref<boolean>> = Symbol('proto-notes')

export function provideProtoNotes() {
  const show = ref(true)
  provide(notesKey, show)
  return show
}

export function useProtoNotes() {
  return inject(notesKey, ref(true))
}
