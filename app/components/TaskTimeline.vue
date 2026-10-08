<script setup lang="ts">
import { computed } from 'vue'
import type { TaskDetail, TaskHistory, TaskStatus } from '~/utils/clientFakeApi'
import { useSession } from '~/composables/useSession'
import { displayName, relativeTime } from '~/utils/task-ui'
import { statusSignal } from '~/utils/task-signals'
import { ESCALATION_ACTOR, isEscalationHistoryRow } from '~/utils/escalation-ui'

/**
 * One chronological stream: history rows and comments interleaved.
 *
 * History rows carry only a staffId (never a name — the API resolves names on
 * comments and collaborators, not history), so the actor label is derived from
 * what the detail already knows: "You", the current assignee's name, a helper's
 * name, or plain "Staff"; a nil staffId is a system/partner action — or the
 * escalation worker, which the description gives away.
 */
const props = defineProps<{ task: TaskDetail }>()

const session = useSession()

type Entry =
  | { kind: 'status', at: string, actor: string, status: TaskStatus, text: string | null, escalation: boolean }
  | { kind: 'comment', at: string, actor: string, text: string }

function actorFor(row: TaskHistory): string {
  if (isEscalationHistoryRow(row)) return ESCALATION_ACTOR
  const staffId = row.staffId
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
    actor: actorFor(row),
    status: row.status as TaskStatus,
    text: row.description,
    escalation: isEscalationHistoryRow(row),
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
  <ol class="relative space-y-4 pl-8">
    <span class="absolute left-[11px] bottom-1 top-1 w-px bg-border" aria-hidden="true" />

    <li v-for="(entry, index) in entries" :key="index" class="relative">
      <!-- The node wears the status's own icon, so the stream can be read
           down the left edge without a word. -->
      <span
        class="absolute -left-8 top-0 flex size-6 items-center justify-center rounded-full ring-2 ring-background"
        :class="entry.kind === 'status' ? statusSignal(entry.status).chip : 'bg-neutral-tint text-neutral-tint-foreground'"
        aria-hidden="true"
      >
        <component :is="statusSignal(entry.status).icon" v-if="entry.kind === 'status'" class="size-3" />
        <span v-else class="size-1.5 rounded-full bg-current" />
      </span>
      <div class="flex items-baseline justify-between gap-2">
        <p class="text-sm font-semibold text-foreground">
          <!-- An escalation row keeps the status it found the task in; it did
               not move anything, so it is not worded as a move. -->
          <template v-if="entry.kind === 'status' && entry.escalation">
            {{ entry.actor }} ·
            <span :class="statusSignal(entry.status).chip" class="ml-0.5 rounded-full px-2 py-0.5 text-xs">{{ statusSignal(entry.status).label }}</span>
          </template>
          <template v-else-if="entry.kind === 'status'">
            {{ entry.actor }} moved to
            <span :class="statusSignal(entry.status).chip" class="ml-0.5 rounded-full px-2 py-0.5 text-xs">{{ statusSignal(entry.status).label }}</span>
          </template>
          <template v-else>{{ entry.actor }}</template>
        </p>
        <span class="shrink-0 text-xs text-muted-foreground">{{ relativeTime(entry.at) }}</span>
      </div>
      <p v-if="entry.kind === 'comment'" class="mt-1 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">{{ entry.text }}</p>
      <p v-else-if="entry.text" class="mt-0.5 text-xs text-muted-foreground">{{ entry.text }}</p>
    </li>

    <li v-if="entries.length === 0" class="text-sm text-muted-foreground">No activity yet.</li>
  </ol>
</template>
