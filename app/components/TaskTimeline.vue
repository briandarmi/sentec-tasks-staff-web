<script setup lang="ts">
import { computed } from 'vue'
import type { TaskStatus } from '~/utils/clientFakeApi'
import { fullName, relativeTime, statusMeta } from '~/utils/task-ui'

interface Person { firstName: string, lastName: string }

const props = defineProps<{
  history: Array<{ createDate: string, status: TaskStatus, description: string | null, user: Person | null }>
  comments: Array<{ createDate: string, comment: string, user: Person | null }>
}>()

type Entry =
  | { kind: 'status', at: string, user: Person | null, status: TaskStatus, text: string | null }
  | { kind: 'comment', at: string, user: Person | null, text: string }

/** One chronological stream: transitions and comments interleaved. */
const entries = computed<Entry[]>(() => {
  const status: Entry[] = props.history.map(e => ({
    kind: 'status', at: e.createDate, user: e.user, status: e.status, text: e.description,
  }))
  const comments: Entry[] = props.comments.map(e => ({
    kind: 'comment', at: e.createDate, user: e.user, text: e.comment,
  }))
  return [...status, ...comments].sort((a, b) => a.at.localeCompare(b.at))
})

/** Unattributed rows are partner dispatches, not anonymous people. */
function actor(user: Person | null) {
  return user ? fullName(user) : 'System'
}
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
            {{ actor(entry.user) }} moved to
            <span :class="statusMeta(entry.status).badge" class="ml-0.5 rounded-full px-1.5 py-0.5">{{ statusMeta(entry.status).label }}</span>
          </template>
          <template v-else>{{ actor(entry.user) }}</template>
        </p>
        <span class="shrink-0 text-[11px] text-muted-foreground">{{ relativeTime(entry.at) }}</span>
      </div>
      <p v-if="entry.kind === 'comment'" class="mt-1 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">{{ entry.text }}</p>
      <p v-else-if="entry.text" class="mt-0.5 text-xs text-muted-foreground">{{ entry.text }}</p>
    </li>

    <li v-if="entries.length === 0" class="text-xs text-muted-foreground">No activity yet.</li>
  </ol>
</template>
