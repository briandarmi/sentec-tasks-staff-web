<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ChevronRightIcon, FolderKanbanIcon, MapPinIcon, SirenIcon } from '@lucide/vue'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { useSourceApps } from '~/composables/useSourceApps'
import { initials, priorityMeta, relativeTime, slaAccent, taskRef } from '~/utils/task-ui'

const props = defineProps<{
  task: TaskListItem
  /** Highlight that the task is assigned to the signed-in user. */
  mine?: boolean
}>()

const sourceApps = useSourceApps()
onMounted(() => { void sourceApps.ensureLoaded() })

const accent = computed(() => slaAccent(props.task))
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
/** Where the task came from — resolved through the source-app registry. */
const sourceBadge = computed(() => {
  if (props.task.sourceProduct === 'sentec-tasks') return null
  return sourceApps.badge(props.task.sourceProduct)
})
</script>

<template>
  <NuxtLink
    :to="`/tasks/${task.id}`"
    class="block rounded-xl border border-l-[3px] bg-card p-3.5 shadow-sm transition-colors active:bg-accent/50 hover:bg-accent/30"
    :class="accent"
  >
    <!-- Scan order at arm's length in a corridor: the SLA stripe, then the
         room, then the running clock — the title only after that. -->
    <div class="flex items-start justify-between gap-2">
      <p v-if="task.roomNumber" class="flex items-center gap-1 text-sm font-bold tabular-nums text-foreground">
        <MapPinIcon class="h-3.5 w-3.5 text-muted-foreground" />
        {{ task.roomNumber }}
      </p>
      <p v-else class="text-xs font-medium text-muted-foreground">{{ task.locationTypeName ?? 'No room' }}</p>
      <div class="ml-auto shrink-0">
        <SlaBadge :task="task" :status="task.status" show-countdown />
      </div>
    </div>

    <p class="mt-1.5 text-sm font-semibold leading-snug text-foreground">{{ task.title }}</p>
    <p v-if="task.description" class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{{ task.description }}</p>
    <!-- Project tasks leave the hotel board and default list, so this only
         shows under Mine / Helping and inside the project itself — where a
         reader still wants to know which project a card belongs to. -->
    <p v-if="task.project" class="mt-1 flex items-center gap-1 truncate text-[11px] font-medium text-muted-foreground">
      <FolderKanbanIcon class="h-3 w-3 shrink-0" aria-hidden="true" />
      <span class="truncate">Project · {{ task.project.name }}</span>
    </p>

    <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
      <StatusPill :status="task.status" />
      <!-- Only when it deviates: a NORMAL badge on every card is noise. -->
      <span
        v-if="task.priority !== 'NORMAL'"
        class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
        :class="priorityMeta(task.priority).badge"
      >
        {{ priorityMeta(task.priority).label }}
      </span>
      <!-- The policy stepped in. One word at level 1; the level once it has
           climbed, because a card at L3 is a different kind of late. -->
      <Badge
        v-if="task.escalationLevel > 0"
        variant="destructive"
        class="gap-1 text-[10px]"
        :title="`escalated ${relativeTime(task.escalatedAt)}`"
      >
        <SirenIcon aria-hidden="true" />
        {{ task.escalationLevel >= 2 ? `Esc. L${task.escalationLevel}` : 'Escalated' }}
      </Badge>
      <Badge v-if="task.department" variant="outline" class="text-[10px]">{{ task.department.name }}{{ task.department.isActive === false ? ' (inactive)' : '' }}</Badge>
      <Badge v-if="task.quantity && task.quantity > 1" variant="outline" class="text-[10px]">×{{ task.quantity }}</Badge>
      <!-- The originating app matters operationally: a Butler task has a guest
           waiting on the other end. The dot is the registry's colour — data,
           not a theme token — and it sits at the row's edge so it reads the
           same on every card. -->
      <Badge v-if="sourceBadge" variant="outline" class="ml-auto gap-1 text-[10px] text-muted-foreground">
        <span
          v-if="sourceBadge.color"
          class="h-1.5 w-1.5 rounded-full"
          :style="{ backgroundColor: sourceBadge.color }"
          aria-hidden="true"
        />
        {{ sourceBadge.label }}
      </Badge>
    </div>

    <div class="mt-3 flex items-center justify-between gap-2">
      <span class="truncate text-[11px] font-medium text-muted-foreground">
        {{ taskRef(task.id) }} · {{ relativeTime(task.createdAt) }}
      </span>
      <div class="flex items-center gap-1.5">
        <Avatar v-if="assigneeName" class="h-6 w-6" :title="assigneeName">
          <AvatarFallback
            class="text-[10px] font-semibold"
            :class="mine ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'"
          >
            {{ initials(assigneeName) }}
          </AvatarFallback>
        </Avatar>
        <span
          v-else
          class="flex h-6 items-center rounded-full border border-dashed px-2 text-[10px] font-medium text-muted-foreground/70"
        >{{ poolLabel ?? 'To claim' }}</span>
        <ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground/50" />
      </div>
    </div>
  </NuxtLink>
</template>
