import { computed } from 'vue'
import type { SourceApp } from '~/utils/clientFakeApi'
import { useTasksApi } from '~/composables/useTasksApi'

/**
 * The platform-wide source-app registry, loaded once per session and shared.
 * Any authenticated actor may read it (GET /v1/source-apps) — it is what
 * resolves a task's `sourceProduct` code to a display name and badge colour.
 * A load failure degrades to raw codes rather than blocking any screen.
 */
export function useSourceApps() {
  const apps = useState<SourceApp[] | null>('sourceApps', () => null)
  const api = useTasksApi()

  async function ensureLoaded() {
    if (apps.value !== null) return
    try {
      apps.value = await api.listSourceApps()
    }
    catch {
      apps.value = []
    }
  }

  const byCode = computed(() => new Map((apps.value ?? []).map(app => [app.code, app])))

  function badge(code: string | null | undefined): { label: string, color: string | null } | null {
    if (!code) return null
    const app = byCode.value.get(code)
    return { label: app?.shortName ?? code, color: app?.color ?? null }
  }

  return { apps, ensureLoaded, badge }
}
