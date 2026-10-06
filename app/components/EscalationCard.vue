<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { SirenIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { TaskDetail, TaskEscalation } from '~/utils/clientFakeApi'
import { formatDateTime, relativeTime } from '~/utils/task-ui'
import { actionLabel, actionName, levelLabel, skipLabel, triggerLabel } from '~/utils/escalation-ui'
import type { ParsedRef } from '~/utils/escalation-ui'

/**
 * "What the policy did" — GET /v1/tasks/{id}/escalations. Shown only on a
 * task that carries a policy (resolved once, at creation); a task created
 * before any policy existed has nothing to watch it and no card. Anyone who
 * can open the task may ask. Newest step first: the latest change is what
 * someone opening an escalated task wants to see.
 */
const props = defineProps<{ task: TaskDetail }>()

const api = useTasksApi()
const session = useSession()

const data = ref<TaskEscalation[] | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')

/**
 * The API lists oldest first; a catch-up burst can apply several steps at the
 * same instant, so the level breaks the tie.
 */
const records = computed(() => [...(data.value ?? [])].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt) || b.level - a.level))

/**
 * Names only from what the detail already knows — the current assignment,
 * the helpers, the task's department. No directory fetch for a line that
 * reads fine as "a colleague" when the person has since moved on.
 */
function nameFor(ref: ParsedRef): string | null {
  const assignment = props.task.assignment
  if (ref.kind === 'staff') {
    if (ref.id === session.userId.value) return 'you'
    if (assignment?.staffId === ref.id && assignment.staffName) return assignment.staffName
    return props.task.collaborators?.find(c => c.staffId === ref.id)?.staffName ?? null
  }
  if (ref.kind === 'team') return assignment?.teamId === ref.id ? assignment.teamName : null
  if (ref.kind === 'department') return props.task.department?.id === ref.id ? props.task.department.name : null
  return null
}

function notifiedLabel(count: number) {
  return count === 1 ? '1 person notified' : `${count} people notified`
}

async function load() {
  if (!props.task.escalationPolicyId) return
  isLoading.value = true
  errorMessage.value = ''
  try {
    data.value = await api.listTaskEscalations(props.task.id)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

defineExpose({ load })

onMounted(load)
</script>

<template>
  <Card v-if="task.escalationPolicyId">
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-sm">
        <SirenIcon class="h-4 w-4" /> Escalation
      </CardTitle>
      <CardDescription class="text-xs">
        <template v-if="task.escalationLevel > 0">Steps the policy applied to this task.</template>
        <template v-else>Not escalated yet — the policy watches this task's deadlines.</template>
      </CardDescription>
    </CardHeader>
    <CardContent class="text-sm">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Couldn't load the escalation steps</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div v-else-if="isLoading && !data" class="space-y-2">
        <Skeleton class="h-5 w-2/3 rounded" />
        <Skeleton class="h-4 w-1/2 rounded" />
      </div>

      <template v-else-if="data">
        <ol v-if="records.length" class="space-y-3">
          <li v-for="record in records" :key="record.stepId" class="space-y-1">
            <div class="flex items-baseline justify-between gap-2">
              <p class="flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge variant="destructive" class="text-[10px]">{{ levelLabel(record.level) }}</Badge>
                <span class="truncate text-xs font-medium text-foreground">{{ triggerLabel(record.trigger.kind, record.trigger.value) }}</span>
              </p>
              <span class="shrink-0 text-[11px] text-muted-foreground" :title="formatDateTime(record.appliedAt)">{{ relativeTime(record.appliedAt) }}</span>
            </div>
            <ul class="space-y-0.5 pl-0.5 text-xs">
              <li v-for="(applied, index) in record.applied" :key="`a${index}`" class="text-foreground">
                {{ actionLabel(applied, nameFor) }}
              </li>
              <!-- A skipped action is still worth a line: "nothing changed"
                   needs a reason, or the step looks broken. -->
              <li v-for="(skipped, index) in record.skipped" :key="`s${index}`" class="text-muted-foreground">
                {{ actionName(skipped.type) }} skipped — {{ skipLabel(skipped) }}
              </li>
              <li v-if="!record.applied.length && !record.skipped.length" class="text-muted-foreground">
                Nothing changed on the task.
              </li>
              <li v-if="record.recipients.length" class="text-muted-foreground">
                {{ notifiedLabel(record.recipients.length) }}
              </li>
            </ul>
          </li>
        </ol>
        <p v-else class="text-xs text-muted-foreground">No step has fired. Each one applies once, when its trigger comes due.</p>
      </template>
    </CardContent>
  </Card>
</template>
