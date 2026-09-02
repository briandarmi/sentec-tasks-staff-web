import { computed } from 'vue'
import { useSession } from '~/composables/useSession'

/**
 * What the signed-in user may do. Cosmetic gates only — the API enforces the
 * real rules and is the only thing standing between a caller and the data.
 *
 * Role model (account-wide, per the real API):
 *   staff    — work their own department's queue; may create tasks only when
 *              their account carries the createTask claim
 *   leader   — staff, plus assign work and review submissions in their own
 *              department
 *   admin    — leader, plus configure the property (SLAs, routing, board,
 *              catalog, staff) at hotels in their claim
 *   operator — a platform-level flag: provisions tenants, groups, partners and
 *              the source-app registry. An operator has NO hotel claim, so
 *              hotel-scoped screens are not theirs — platform screens are.
 */
export function useCaps() {
  const session = useSession()

  const role = computed(() => session.role.value)
  const isOperator = computed(() => session.isOperator.value)
  const isAdmin = computed(() => role.value === 'admin' && !isOperator.value)
  const isLeader = computed(() => isAdmin.value || role.value === 'leader')

  /** Working a queue needs a hotel in the claim; an operator has none. */
  const canWork = computed(() => Boolean(session.hotelId.value))
  /** Plain staff need the createTask claim; leaders and admins always may. */
  const canCreateTask = computed(() => canWork.value && (role.value !== 'staff' || session.createTask.value))
  /** Reassignment is a leader action; Claim deliberately cannot do it. */
  const canAssign = computed(() => canWork.value && isLeader.value)
  const canConfigureProperty = computed(() => canWork.value && isAdmin.value)
  const canProvision = computed(() => isOperator.value)

  const roleLabel = computed(() => {
    if (isOperator.value) return 'Operator'
    switch (role.value) {
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
  }
}
