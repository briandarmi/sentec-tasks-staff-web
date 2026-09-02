<script setup lang="ts">
import { computed } from 'vue'
import type { TaskDetail, TaskStatus } from '~/utils/clientFakeApi'
import { useSession } from '~/composables/useSession'
import { displayName, relativeTime, statusMeta } from '~/utils/task-ui'

/**
 * One chronological stream: history rows and comments interleaved.
 *
 * History rows carry only a staffId (never a name — the API resolves names on
 * comments and collaborators, not history), so the actor label is derived from
 * what the detail already knows: "You", the current assignee's name, a helper's
 * name, or plain "Staff"; a nil staffId is a system/partner action.
 */
const props = defineProps<{ task: TaskDetail }>()

const session = useSession()

type Entry =
  | { kind: 'status', at: string, actor: string, status: TaskStatus, text: string | null }
  | { kind: 'comment', at: string, actor: string, text: string }

function actorFor(staffId: string | null): string {
  if (!staffId) return 'System'
  if (staffId === session.userId.value) return 'You'
  const assignment = props.task.assignment
  if (assignment?.kind === 'STAFF' && assignment.staffId === staffId) return displayName(assignment.staffName)
  const helper = props.task.collaborators?.find(c => c.staffId === staffId)
  if (helper) return displayName(helper.staffName)
  return 'Staff'
}

const entries = computed<Entry[]>(() => {
  const status: Entry[] = (props.task.history ?? []).map(row => ({
    kind: 'status',
    at: row.createdAt,
    actor: actorFor(row.staffId),
    status: row.status as TaskStatus,
    text: row.description,
  }))
  const comments: Entry[] = (props.task.comments ?? []).map(row => ({
    kind: 'comment',
    at: row.createdAt,
    actor: row.staffId === session.userId.value ? 'You' : displayName(row.staffName),
    text: row.comment,
  }))
  return [...status, ...comments].sort((a, b) => a.at.localeCompare(b.at))
})
</script>

<template>
  <ol class="relative space-y-4 pl-6">
    <span class="absolute left-[7px] bottom-1 top-1 w-px bg-border" aria-hidden="true" />

    <li v-for="(entry, index) in entries" :key="index" class="relative">
      <span
        class="absolute -left-6 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-background"
        :class="entry.kind === 'status' ? statusMeta(entry.status).dot : 'bg-muted-foreground/40'"
      />
      <div class="flex items-baseline justify-between gap-2">
        <p class="text-xs font-semibold text-foreground">
          <template v-if="entry.kind === 'status'">
            {{ entry.actor }} moved to
            <span :class="statusMeta(entry.status).badge" class="ml-0.5 rounded-full px-1.5 py-0.5">{{ statusMeta(entry.status).label }}</span>
          </template>
          <template v-else>{{ entry.actor }}</template>
        </p>
        <span class="shrink-0 text-[11px] text-muted-foreground">{{ relativeTime(entry.at) }}</span>
      </div>
      <p v-if="entry.kind === 'comment'" class="mt-1 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">{{ entry.text }}</p>
      <p v-else-if="entry.text" class="mt-0.5 text-xs text-muted-foreground">{{ entry.text }}</p>
    </li>

    <li v-if="entries.length === 0" class="text-xs text-muted-foreground">No activity yet.</li>
  </ol>
</template>
