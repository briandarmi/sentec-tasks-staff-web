import { useSession } from '~/composables/useSession'

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
})
