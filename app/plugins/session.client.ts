import { useSession } from '~/composables/useSession'
import { useTenant } from '~/composables/useTenant'

/**
 * Re-establish the signed-in session before the first route resolves.
 *
 * Without this the global auth middleware would see an empty session on a hard
 * refresh and bounce a signed-in user to /login. Registered as a plugin rather
 * than done inside the middleware so it runs exactly once per page load instead
 * of on every navigation.
 */
export default defineNuxtPlugin(async () => {
  await useSession().restore()
  // Follow the selected hotel's timezone from here on (GET /v1/tenant), so
  // every clock time on screen is the hotel's rather than the device's.
  useTenant()
})
