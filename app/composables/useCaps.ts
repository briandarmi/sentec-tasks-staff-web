import { computed } from 'vue'
import { useSession } from '~/composables/useSession'

/**
 * What the signed-in user may do at the active property.
 *
 * These gates are cosmetic — the API enforces the same rules and is the only
 * thing standing between a caller and the data. They exist so the UI does not
 * offer an action that is going to come back 403, not to provide security.
 *
 * Role model (per property):
 *   staff    — work their own department's queue
 *   leader   — staff, plus assign work within the property
 *   admin    — leader, plus configure the property (SLAs, routing, departments,
 *              board columns, catalog, staff)
 *   operator — Sentinel Tech platform role: provision properties, groups and
 *              integration partners, and grant group access
 */
export function useCaps() {
  const session = useSession()

  const role = computed(() => session.role.value)
  const isOperator = computed(() => session.isOperator.value)
  const isAdmin = computed(() => isOperator.value || role.value === 'admin')
  const isLeader = computed(() => isAdmin.value || role.value === 'leader')

  const canWork = computed(() => Boolean(role.value))
  const canCreateTask = computed(() => Boolean(role.value))
  /** Reassignment is a leader action; Claim deliberately cannot do it. */
  const canAssign = computed(() => isLeader.value)
  const canConfigureProperty = computed(() => isAdmin.value)
  const canProvision = computed(() => isOperator.value)
  const canReadAudit = computed(() => isAdmin.value)

  const roleLabel = computed(() => {
    switch (role.value) {
      case 'operator': return 'Operator'
      case 'admin': return 'Property Admin'
      case 'leader': return 'Team Leader'
      case 'staff': return 'Staff'
      default: return 'Signed in'
    }
  })

  return {
    role,
    roleLabel,
    isOperator,
    isAdmin,
    isLeader,
    canWork,
    canCreateTask,
    canAssign,
    canConfigureProperty,
    canProvision,
    canReadAudit,
  }
}
