<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRightIcon, MapPinIcon } from '@lucide/vue'
import type { TaskListItem } from '~/utils/clientFakeApi'
import { fullName, initials, relativeTime, slaAccent, taskRef } from '~/utils/task-ui'

const props = defineProps<{
  task: TaskListItem
  /** Highlight that the task is assigned to the signed-in user. */
  mine?: boolean
}>()

const accent = computed(() => slaAccent(props.task))
const assignee = computed(() => props.task.assignment?.user ?? null)
</script>

<template>
  <NuxtLink
    :to="`/tasks/${task.id}`"
    class="block rounded-xl border border-l-[3px] bg-card p-3.5 shadow-sm transition-colors active:bg-accent/50 hover:bg-accent/30"
    :class="accent"
  >
    <div class="flex items-start justify-between gap-2">
      <StatusPill :status="task.status" />
      <span class="shrink-0 text-[11px] font-medium text-muted-foreground">{{ relativeTime(task.createDate) }}</span>
    </div>

    <p class="mt-2 text-sm font-semibold leading-snug text-foreground">{{ task.title }}</p>
    <p v-if="task.description" class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{{ task.description }}</p>

    <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
      <Badge v-if="task.location" variant="secondary" class="gap-1 text-[10px] font-medium">
        <MapPinIcon class="h-2.5 w-2.5" />
        {{ task.location }}
      </Badge>
      <Badge v-if="task.department" variant="outline" class="text-[10px]">{{ task.department.name }}</Badge>
      <Badge v-if="task.quantity && task.quantity > 1" variant="outline" class="text-[10px]">×{{ task.quantity }}</Badge>
      <!-- Where the task came from. A partner name matters operationally:
           a Butler task has a guest waiting on the other end of it. -->
      <Badge v-if="task.partner" variant="outline" class="text-[10px] text-muted-foreground">{{ task.partner.name }}</Badge>
    </div>

    <div class="mt-3 flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <SlaBadge :task="task" :status="task.status" show-countdown />
        <span class="truncate text-[11px] font-medium text-muted-foreground">{{ taskRef(task.id) }}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <Avatar v-if="assignee" class="h-6 w-6" :title="fullName(assignee)">
          <AvatarFallback
            class="text-[10px] font-semibold"
            :class="mine ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'"
          >
            {{ initials(assignee) }}
          </AvatarFallback>
        </Avatar>
        <span
          v-else
          class="flex h-6 items-center rounded-full border border-dashed px-2 text-[10px] font-medium text-muted-foreground/70"
        >To claim</span>
        <ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground/50" />
      </div>
    </div>
  </NuxtLink>
</template>
