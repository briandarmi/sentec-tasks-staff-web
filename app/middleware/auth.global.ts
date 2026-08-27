import { useSession } from '~/composables/useSession'

/**
 * Auth gate for the staff workspace.
 *
 * /login is the only public route; every other screen needs a session. There
 * are no role gates here — every role works its own queue, and the workspace
 * shows or hides individual actions through `useCaps()` rather than by blocking
 * a route. Property configuration and the platform screens live in
 * sentec-tasks-admin-web, which gates them itself.
 *
 * This redirect is a courtesy — it keeps someone from landing on a screen that
 * can only render an error — but the API is what actually refuses the data, so a
 * hand-typed URL gains nothing.
 */
export default defineNuxtRouteMiddleware((to) => {
  const session = useSession()

  if (to.path === '/login') {
    return session.isAuthenticated.value ? navigateTo('/') : undefined
  }

  if (!session.isAuthenticated.value) {
    // Come back here after signing in rather than dumping the user on the home
    // screen — a deep link to a task is usually why they were sent to /login.
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } })
  }
})
