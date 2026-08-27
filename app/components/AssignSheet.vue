<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckIcon, SearchIcon } from '@lucide/vue'
import { useTasksApi, type StaffMember } from '~/composables/useTasksApi'
import { initials } from '~/utils/task-ui'

const props = defineProps<{
  open: boolean
  /** The task's own department. The picker opens scoped to it. */
  departmentId: string | null
  departmentName: string | null
  currentAssigneeId: string | null
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  'assign': [{ userId: string, remark: string | null }]
}>()

const api = useTasksApi()

/**
 * Scope defaults to the task's department.
 *
 * The previous picker listed every person at the property, which is a long
 * scroll on a phone. Cross-department assignment is real but occasional (a duty
 * manager covering), so it lives behind the toggle rather than in the default.
 */
const showAll = ref(false)
const members = ref<StaffMember[]>([])
const isLoading = ref(false)
const errorMessage = ref('')
const search = ref('')
const remark = ref('')

const canScope = computed(() => Boolean(props.departmentId))

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  const rows = members.value.filter(m => m.userId !== props.currentAssigneeId)
  if (!query) return rows
  return rows.filter(m =>
    `${m.firstName} ${m.lastName}`.toLowerCase().includes(query)
    || (m.position ?? '').toLowerCase().includes(query)
    || (m.department?.name ?? '').toLowerCase().includes(query),
  )
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    members.value = await api.listStaff(showAll.value || !props.departmentId ? null : props.departmentId)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  showAll.value = !props.departmentId
  search.value = ''
  remark.value = ''
  load()
})

watch(showAll, () => {
  if (props.open) load()
})

function choose(member: StaffMember) {
  if (props.busy) return
  emit('assign', { userId: member.userId, remark: remark.value.trim() || null })
}
</script>

<template>
  <Drawer :open="open" @update:open="value => emit('update:open', value)">
    <DrawerContent>
      <DrawerHeader class="text-left">
        <DrawerTitle>Assign task</DrawerTitle>
        <DrawerDescription>
          <template v-if="!showAll && departmentName">Showing {{ departmentName }}. Switch to everyone if you need to assign outside the department.</template>
          <template v-else>Showing everyone at this property.</template>
        </DrawerDescription>
      </DrawerHeader>

      <div class="space-y-3 px-4 pb-2">
        <div v-if="canScope" class="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <Label for="assign-show-all" class="cursor-pointer text-sm font-medium">Show everyone</Label>
          <Switch id="assign-show-all" v-model="showAll" />
        </div>

        <div class="relative">
          <SearchIcon class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" placeholder="Search name or role…" class="pl-9" />
        </div>

        <Textarea v-model="remark" placeholder="Note for the assignee (optional)" rows="2" class="resize-none" />

        <Alert v-if="errorMessage" variant="destructive">
          <AlertTitle>Couldn't load the team</AlertTitle>
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>

        <div v-if="isLoading" class="space-y-2">
          <Skeleton v-for="n in 3" :key="n" class="h-14 w-full rounded-lg" />
        </div>

        <p v-else-if="filtered.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          Nobody to show here.
        </p>

        <div v-else class="max-h-[46vh] space-y-1.5 overflow-y-auto">
          <button
            v-for="member in filtered"
            :key="member.userId"
            type="button"
            :disabled="busy"
            class="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors disabled:opacity-60 enabled:active:bg-accent"
            @click="choose(member)"
          >
            <Avatar class="h-9 w-9 shrink-0">
              <AvatarFallback class="bg-primary/10 text-xs font-semibold text-primary">
                {{ initials(member) }}
              </AvatarFallback>
            </Avatar>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ member.firstName }} {{ member.lastName }}</span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ member.position || member.role }}<template v-if="member.department"> · {{ member.department.name }}</template>
              </span>
            </span>
            <!-- Current workload: assigning to whoever is already carrying six
                 open tasks is the mistake this number exists to prevent. -->
            <Badge variant="secondary" class="shrink-0 tabular-nums text-[10px]">{{ member.openTaskCount }} open</Badge>
          </button>
        </div>
      </div>

      <DrawerFooter>
        <DrawerClose as-child>
          <Button variant="outline" class="w-full">Cancel</Button>
        </DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
</template>
