import { computed } from 'vue'
import type { SourceApp } from '~/utils/clientFakeApi'
import { useTasksApi } from '~/composables/useTasksApi'

export type SourceAppsStatus = 'idle' | 'loading' | 'ready' | 'failed'

/**
 * The platform-wide source-app registry, loaded once per session and shared.
 * Any authenticated actor may read it (GET /v1/source-apps) — it is what
 * resolves a task's `sourceProduct` code to a display name and badge colour.
 *
 * A load failure degrades to raw codes rather than blocking any screen. The
 * `status` is exposed for the one view that is meaningless without names —
 * grouping the task list by source — so it can hide itself instead of
 * rendering a single "Other" lane.
 */
export function useSourceApps() {
  const apps = useState<SourceApp[]>('sourceApps', () => [])
  const status = useState<SourceAppsStatus>('sourceAppsStatus', () => 'idle')
  const api = useTasksApi()

  /** Idempotent: one fetch per session. A failure may be retried by the next caller. */
  async function ensureLoaded() {
    if (status.value === 'loading' || status.value === 'ready') return
    status.value = 'loading'
    try {
      apps.value = await api.listSourceApps()
      status.value = 'ready'
    }
    catch {
      apps.value = []
      status.value = 'failed'
    }
  }

  /** Active apps only — a retired code renders like an unknown one: raw, uncoloured. */
  const byCode = computed(() => new Map(apps.value.filter(app => app.isActive).map(app => [app.code, app])))

  /** Short label + registry colour for a badge; the raw code when unregistered. */
  function badge(code: string | null | undefined): { label: string, color: string | null } | null {
    if (!code) return null
    const app = byCode.value.get(code)
    return { label: app?.shortName ?? code, color: app?.color ?? null }
  }

  /** Full display name for a "Created by" row; the raw code when unregistered, never blank. */
  function nameOf(code: string | null | undefined): string | null {
    if (!code) return null
    return byCode.value.get(code)?.name ?? code
  }

  return { apps, status, byCode, ensureLoaded, badge, nameOf }
}
