<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'

interface Option { id: string, label: string, detail: string | null }

/**
 * A person picker over GET /v1/staff/assignable — leader/admin-only, unless
 * the call names a task the caller holds (`taskId`) or a project they manage
 * (`projectId`): feat/projects widens the route for exactly those two. A
 * plain staff member with neither (delegating, or adding a helper as a
 * helper) gets the real 403, so this control degrades honestly: it falls back
 * to the caller's own teams' member lists (/v1/teams + /v1/teams/{id}/members
 * are open to any actor), which carry ids but no names — the API exposes no
 * staff directory to staff.
 */
const props = defineProps<{
  modelValue: string
  /** Staff ids that must not be offered (the assignee, existing helpers, yourself…). */
  exclude?: string[]
  placeholder?: string
  ariaLabel?: string
  /** Narrow the directory to one department (the API's own filter). */
  departmentId?: string | null
  /** Lets the task's current assignee call the directory. Does not filter. */
  taskId?: string | null
  /** Lets the project's manager call the directory. Does not filter. */
  projectId?: string | null
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const api = useTasksApi()
const session = useSession()
const options = ref<Option[]>([])
const isLoading = ref(false)
const errorMessage = ref('')
/** True when the list is id-only team members rather than the named directory. */
const teamFallback = ref(false)

const offered = computed(() => {
  const excluded = new Set(props.exclude ?? [])
  return options.value.filter(option => !excluded.has(option.id))
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  teamFallback.value = false
  try {
    const rows = await api.listAssignableStaff(props.departmentId ?? null, { taskId: props.taskId, projectId: props.projectId })
    options.value = rows.map(row => ({ id: row.id, label: row.name, detail: row.role }))
  }
  catch {
    // The named directory is leader-only; fall back to the caller's teams.
    try {
      const teams = await api.listTeams()
      const memberLists = await Promise.all(teams.map(team => api.listTeamMembers(team.id).catch(() => [] as string[])))
      const ids = new Set(memberLists.flat())
      ids.delete(session.userId.value ?? '')
      options.value = [...ids].map(id => ({ id, label: `Team member ${id.slice(0, 8).toUpperCase()}`, detail: null }))
      teamFallback.value = true
    }
    catch (e) {
      errorMessage.value = (e as Error).message
    }
  }
  finally {
    isLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-2">
    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Couldn't load the team</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="outline" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>
    <template v-else>
      <Select
        :model-value="modelValue"
        @update:model-value="value => emit('update:modelValue', String(value ?? ''))"
      >
        <SelectTrigger class="w-full" :aria-label="ariaLabel">
          <SelectValue :placeholder="isLoading ? 'Loading…' : placeholder ?? 'Choose a person'" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in offered" :key="option.id" :value="option.id">
            {{ option.label }}
            <span v-if="option.detail" class="text-muted-foreground"> · {{ option.detail }}</span>
          </SelectItem>
        </SelectContent>
      </Select>
      <p v-if="teamFallback" class="text-xs text-muted-foreground">
        Names are visible to leaders only — these are your teammates, listed by id.
      </p>
    </template>
  </div>
</template>
