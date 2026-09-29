import { watch } from 'vue'
import { useSession } from '~/composables/useSession'
import type { TenantSettings } from '~/composables/useTasksApi'
import { setDisplayTimeZone } from '~/utils/task-ui'

/**
 * The selected hotel's own record (GET /v1/tenant), fetched once per hotel
 * and kept in Nuxt state. Its `timezone` is the zone every clock time on
 * screen is shown in — a housekeeper in Jakarta reading a due time must see
 * Jakarta time whatever the device is set to — so adopting it also points
 * `formatClockTime` and friends at that zone. Cleared with the session
 * (`cachedTenant` is in `clearNuxtState`).
 *
 * Any actor of the hotel may read it; only an admin may PATCH the timezone,
 * which the admin console's Property settings do through `useTasksApi`.
 */
export function useTenant() {
  const session = useSession()
  const tenant = useState<TenantSettings | null>('cachedTenant', () => null)
  const isLoading = useState<boolean>('cachedTenantLoading', () => false)

  async function load(force = false) {
    const hotelId = session.hotelId.value
    if (!hotelId || !session.isAuthenticated.value) {
      tenant.value = null
      setDisplayTimeZone(null)
      return null
    }
    if (!force && tenant.value?.hotelRef === hotelId) return tenant.value
    isLoading.value = true
    try {
      const env = await session.request<TenantSettings>('/v1/tenant')
      tenant.value = env.data
      setDisplayTimeZone(env.data?.timezone ?? null)
      return tenant.value
    }
    catch {
      // An operator or a grant-only reach may be refused; times then fall back
      // to the device zone rather than blocking the screen.
      tenant.value = null
      setDisplayTimeZone(null)
      return null
    }
    finally {
      isLoading.value = false
    }
  }

  /** Adopt a freshly saved record (PATCH /v1/tenant) without a refetch. */
  function adopt(next: TenantSettings) {
    tenant.value = next
    setDisplayTimeZone(next.timezone)
  }

  // Follow the switcher: a new hotel means a new zone.
  watch(() => [session.hotelId.value, session.isAuthenticated.value] as const, () => { void load() }, { immediate: true })

  return { tenant, isLoading, load, adopt }
}
