<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ChevronRightIcon, MapPinIcon } from '@lucide/vue'
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
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <StatusPill :status="task.status" />
        <!-- Only when it deviates: a NORMAL badge on every card is noise. -->
        <span
          v-if="task.priority !== 'NORMAL'"
          class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
          :class="priorityMeta(task.priority).badge"
        >
          {{ priorityMeta(task.priority).label }}
        </span>
      </div>
      <span class="shrink-0 text-[11px] font-medium text-muted-foreground">{{ relativeTime(task.createdAt) }}</span>
    </div>

    <p class="mt-2 text-sm font-semibold leading-snug text-foreground">{{ task.title }}</p>
    <p v-if="task.description" class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{{ task.description }}</p>

    <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
      <Badge v-if="task.roomNumber" variant="secondary" class="gap-1 text-[10px] font-medium">
        <MapPinIcon class="h-2.5 w-2.5" />
        {{ task.roomNumber }}
      </Badge>
      <Badge v-if="task.department" variant="outline" class="text-[10px]">{{ task.department.name }}</Badge>
      <Badge v-if="task.quantity && task.quantity > 1" variant="outline" class="text-[10px]">×{{ task.quantity }}</Badge>
      <!-- The originating app matters operationally: a Butler task has a guest
           waiting on the other end. The dot is the registry's colour — data,
           not a theme token. -->
      <Badge v-if="sourceBadge" variant="outline" class="gap-1 text-[10px] text-muted-foreground">
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
      <div class="flex min-w-0 items-center gap-2">
        <SlaBadge :task="task" :status="task.status" show-countdown />
        <span class="truncate text-[11px] font-medium text-muted-foreground">{{ taskRef(task.id) }}</span>
      </div>
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
