/** 窄屏判断：与 OperationsShell 不同的断点由调用方给出。卸载时解除监听。 */
import { onBeforeUnmount, ref } from 'vue'

export function useNarrow(query = '(max-width: 899px)') {
  const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null
  const narrow = ref(media?.matches ?? false)
  const sync = () => (narrow.value = media?.matches ?? false)
  media?.addEventListener('change', sync)
  onBeforeUnmount(() => media?.removeEventListener('change', sync))
  return narrow
}
