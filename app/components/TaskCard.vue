<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ChevronRightIcon, FolderKanbanIcon, HandIcon, MapPinIcon } from '@lucide/vue'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { useSourceApps } from '~/composables/useSourceApps'
import { useNow } from '~/composables/useNow'
import { initials, relativeTime, taskRef } from '~/utils/task-ui'
import { HEAT_TONE, taskHeat, taskSignals } from '~/utils/task-signals'

const props = defineProps<{
  task: TaskListItem
  /** Highlight that the task is assigned to the signed-in user. */
  mine?: boolean
  /** Show the one-tap Claim inside the card; the parent decides who may. */
  claimable?: boolean
  /** The claim is in flight. */
  claiming?: boolean
}>()

const emit = defineEmits<{ claim: [] }>()

const sourceApps = useSourceApps()
onMounted(() => { void sourceApps.ensureLoaded() })

/** Shared ticking clock: the edge follows the live countdown, not a stamp. */
const now = useNow()

/** The traffic light on the card's edge: the hottest reason, while work runs. */
const heat = computed(() => taskHeat(props.task, now.value))
/**
 * The Claim is the tonal secondary button in the card's own colour: a red
 * tint on a late task, amber on one due soon, green on one with time,
 * Sentinel Blue where no clock runs. The button then says "take this" with
 * the same signal the edge gives, without shouting louder than the detail
 * page's own primary Claim.
 */
const CLAIM_TONE = { late: 'destructive', soon: 'warning', ok: 'success', none: 'primary' } as const
const claimTone = computed(() => CLAIM_TONE[heat.value])
/** Why it is that colour, minus the clock, which sits top-right on its own. */
const reasons = computed(() => taskSignals(props.task, now.value).filter(s => s.kind === 'escalation' || s.kind === 'priority'))

const assigneeName = computed(() => {
  const a = props.task.assignment
  return a?.kind === 'STAFF' ? a.staffName ?? 'Team member' : null
})
/** A pool task is assigned but owned by nobody: the chip names the pool. */
const poolLabel = computed(() => {
  const a = props.task.assignment
  if (!a || a.kind === 'STAFF') return null
  return a.kind === 'TEAM' ? a.teamName ?? 'Team pool' : a.departmentName ?? 'Department pool'
})
/** The Claim names the pool it takes from, so nobody claims blind. */
const claimLabel = computed(() => {
  const a = props.task.assignment
  if (a?.kind === 'TEAM') return `Claim from ${a.teamName ?? 'the team'}`
  if (a?.kind === 'DEPARTMENT') return `Claim from ${a.departmentName ?? 'the department'}`
  return 'Claim this'
})
/** Where the task came from — resolved through the source-app registry. */
const sourceBadge = computed(() => {
  if (props.task.sourceProduct === 'sentec-tasks') return null
  return sourceApps.badge(props.task.sourceProduct)
})
</script>

<template>
  <!-- The whole card is one tap target: the link stretches over it through
       its ::after layer. The Claim button, when there is one, sits above that
       layer, so a card can carry a second action without nesting a button in
       a link. -->
  <article
    class="relative rounded-2xl border border-l-4 bg-card p-4 shadow-sm transition-colors hover:bg-accent/30 has-[a:active]:bg-accent/50 focus-within:ring-[3px] focus-within:ring-primary-tint"
    :class="HEAT_TONE[heat].edge"
  >
    <NuxtLink
      :to="`/tasks/${task.id}`"
      class="block focus-visible:outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
    >
      <!-- Scan order at arm's length in a corridor: the edge, then the room,
           then the clock — the title only after that. -->
      <div class="flex items-start justify-between gap-2">
        <p v-if="task.roomNumber" class="flex items-center gap-1.5 text-lg font-bold leading-tight tabular-nums text-foreground">
          <MapPinIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {{ task.roomNumber }}
        </p>
        <p v-else class="flex items-center gap-1.5 text-sm font-semibold leading-tight text-muted-foreground">
          <MapPinIcon class="size-4 shrink-0" aria-hidden="true" />
          {{ task.locationTypeName ?? 'No room' }}
        </p>
        <div class="ml-auto shrink-0">
          <SlaBadge :task="task" />
        </div>
      </div>

      <p class="mt-2 text-base font-semibold leading-snug text-foreground">{{ task.title }}</p>
      <p v-if="task.description" class="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{{ task.description }}</p>
      <!-- Project tasks leave the hotel board and default list, so this only
           shows under Mine / Helping and inside the project itself — where a
           reader still wants to know which project a card belongs to. -->
      <p v-if="task.project" class="mt-1.5 flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
        <FolderKanbanIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">Project · {{ task.project.name }}</span>
      </p>

      <!-- Why the edge is the colour it is, then the lifecycle status, then the facts. -->
      <div class="mt-3 flex flex-wrap items-center gap-1.5">
        <SignalChip
          v-for="signal in reasons"
          :key="signal.kind"
          :heat="signal.heat"
          :icon="signal.icon"
          :label="signal.label"
          :title="signal.detail"
        />
        <StatusPill :status="task.status" />
        <!-- A department the hotel has since retired still owns its old tasks. -->
        <Badge v-if="task.department" variant="outline" class="min-h-7">{{ task.department.name }}{{ task.department.isActive === false ? ' (inactive)' : '' }}</Badge>
        <Badge v-if="task.quantity && task.quantity > 1" variant="outline" class="min-h-7 tabular-nums">×{{ task.quantity }}</Badge>
        <!-- The originating app matters operationally: a Butler task has a guest
             waiting on the other end. The dot is the registry's colour — data,
             not a theme token — and it sits at the row's edge so it reads the
             same on every card. -->
        <Badge v-if="sourceBadge" variant="outline" class="ml-auto min-h-7 gap-1.5 text-muted-foreground">
          <span
            v-if="sourceBadge.color"
            class="size-2 rounded-full"
            :style="{ backgroundColor: sourceBadge.color }"
            aria-hidden="true"
          />
          {{ sourceBadge.label }}
        </Badge>
      </div>

      <div class="mt-3 flex items-center justify-between gap-2">
        <span class="truncate text-xs font-medium text-muted-foreground">
          {{ taskRef(task.id) }} · {{ relativeTime(task.createdAt) }}
        </span>
        <div class="flex items-center gap-1.5">
          <Avatar v-if="assigneeName" class="size-7" :title="assigneeName">
            <AvatarFallback
              class="text-xs font-bold"
              :class="mine ? 'bg-primary text-primary-foreground' : 'bg-primary-tint text-primary-tint-foreground'"
            >
              {{ initials(assigneeName) }}
            </AvatarFallback>
          </Avatar>
          <!-- The Claim below says the same thing as this pill, so only one shows. -->
          <span
            v-else-if="!claimable"
            class="flex min-h-7 items-center rounded-full border border-dashed px-2.5 text-xs font-semibold text-muted-foreground"
          >{{ poolLabel ?? 'To claim' }}</span>
          <ChevronRightIcon class="size-5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        </div>
      </div>
    </NuxtLink>

    <!-- Claim without opening the task — the one-handed path, inside the card,
         tinted in the card's traffic-light colour so the button says how soon. -->
    <Button
      v-if="claimable"
      variant="secondary"
      :tone="claimTone"
      class="relative z-10 mt-3 min-h-11 w-full"
      :disabled="claiming"
      :aria-busy="claiming"
      @click="emit('claim')"
    >
      <HandIcon class="size-5" />
      {{ claiming ? 'Claiming…' : claimLabel }}
    </Button>
  </article>
</template>
