<script setup lang="ts">
import { computed, ref } from 'vue'
import { UserRoundMinusIcon, UsersRoundIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { TaskDetail } from '~/utils/clientFakeApi'
import { displayName, initials } from '~/utils/task-ui'

const props = defineProps<{
  task: TaskDetail
  /**
   * Whether the viewer may add/remove helpers: leader, admin, or the current
   * assignee — AND the task is not closed. The parent folds the closed-status
   * blacklist in, so a leader on a finished task never sees a form that can
   * only 409. Leaving needs no rank and is offered separately.
   */
  canManage: boolean
}>()

const emit = defineEmits<{ updated: [] }>()

const api = useTasksApi()
const session = useSession()

const addUserId = ref('')
const errorMessage = ref('')
/**
 * One id at a time: every row's button disables the moment any removal is in
 * flight, so two concurrent removals are impossible by construction.
 */
const removingUserId = ref('')
const isAdding = ref(false)

const helpers = computed(() => props.task.collaborators ?? [])
const excluded = computed(() => [
  ...helpers.value.map(h => h.staffId),
  ...(props.task.assignment?.staffId ? [props.task.assignment.staffId] : []),
])

function canLeave(userId: string) {
  return userId === session.userId.value
}

async function add() {
  if (!addUserId.value || isAdding.value) return
  isAdding.value = true
  errorMessage.value = ''
  try {
    await api.addHelper({ taskId: props.task.id, staffId: addUserId.value })
    addUserId.value = ''
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isAdding.value = false
  }
}

async function remove(userId: string) {
  if (removingUserId.value) return
  removingUserId.value = userId
  errorMessage.value = ''
  try {
    await api.removeHelper({ taskId: props.task.id, staffId: userId })
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    removingUserId.value = ''
  }
}
</script>

<template>
  <Card v-if="helpers.length || canManage">
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-sm">
        <UsersRoundIcon class="h-4 w-4" /> Helpers
      </CardTitle>
      <CardDescription class="text-xs">
        Helpers can attach proof and submit the work — the task still belongs to its assignee.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-2">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>That didn't work</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <p v-if="helpers.length === 0" class="py-1 text-xs text-muted-foreground">No helpers.</p>
      <!-- One chip per helper — initials first, so a glance at the row says
           who is on this without reading every name. -->
      <div v-else class="flex flex-wrap gap-2">
        <div
          v-for="helper in helpers"
          :key="helper.staffId"
          class="flex min-h-11 max-w-full items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2"
        >
          <Avatar class="h-7 w-7 shrink-0">
            <AvatarFallback class="bg-primary/10 text-[10px] font-semibold text-primary">
              {{ initials(helper.staffName) }}
            </AvatarFallback>
          </Avatar>
          <span class="min-w-0 truncate text-sm font-medium">{{ displayName(helper.staffName) }}</span>
          <Button
            v-if="canManage || canLeave(helper.staffId)"
            size="sm"
            variant="ghost"
            class="-mr-1 h-9 rounded-full text-muted-foreground hover:text-destructive"
            :disabled="Boolean(removingUserId)"
            :aria-busy="removingUserId === helper.staffId"
            :aria-label="`${canLeave(helper.staffId) && !canManage ? 'Leave' : 'Remove'} ${displayName(helper.staffName)}`"
            @click="remove(helper.staffId)"
          >
            <UserRoundMinusIcon class="h-4 w-4" />
            {{ removingUserId === helper.staffId
              ? (canLeave(helper.staffId) && !canManage ? 'Leaving…' : 'Removing…')
              : (canLeave(helper.staffId) && !canManage ? 'Leave' : 'Remove') }}
          </Button>
        </div>
      </div>

      <div v-if="canManage" class="flex items-end gap-2 pt-1">
        <div class="min-w-0 flex-1">
          <StaffSelect
            v-model="addUserId"
            :exclude="excluded"
            :task-id="task.id"
            placeholder="Add a helper"
            :aria-label="`Staff member to add as a helper on ${task.title}`"
          />
        </div>
        <Button :disabled="!addUserId || isAdding" :aria-busy="isAdding" @click="add">
          {{ isAdding ? 'Adding…' : 'Add' }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
