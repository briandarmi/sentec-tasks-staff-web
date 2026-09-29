<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ArrowRightLeftIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SearchIcon,
  SquareKanbanIcon,
  UserRoundCogIcon,
  UsersRoundIcon,
  XCircleIcon,
  LayoutListIcon,
} from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import type { AssignableStaff, Board, BoardColumn, Project, ProjectMember, TaskListItem } from '~/utils/clientFakeApi'
import { formatLocalDate } from '~/utils/recurrence'
import { projectLevelLabel, projectRights, projectStatusMeta } from '~/utils/project-ui'
import { displayName, formatDateTime, initials, statusMeta } from '~/utils/task-ui'

definePageMeta({ title: 'Project' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()
const session = useSession()
const caps = useCaps()

const id = computed(() => String(route.params.id))
const project = ref<Project | null>(null)
const members = ref<ProjectMember[]>([])
const tasks = ref<TaskListItem[]>([])
const board = ref<(Board & { columns: BoardColumn[] }) | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const loadFailed = ref(false)
/** A green line after complete / reopen / hand over — the one place a success is said out loud. */
const notice = ref('')
const acting = ref(false)
const tab = ref<'board' | 'tasks' | 'members'>('board')

const status = computed(() => (project.value ? projectStatusMeta(project.value.status) : null))
const isActive = computed(() => project.value?.status === 'ACTIVE')
const rights = computed(() => projectRights({
  myLevel: project.value?.myLevel ?? null,
  isAdmin: caps.isAdmin.value,
  canCreateTask: session.createTask.value,
  status: project.value?.status ?? 'ACTIVE',
}))
const manager = computed(() => members.value.find(m => m.level === 'MANAGER') ?? null)
const dates = computed(() => {
  const from = project.value?.startDate ? formatLocalDate(project.value.startDate) : ''
  const until = project.value?.endDate ? formatLocalDate(project.value.endDate) : ''
  if (from && until) return `${from} – ${until}`
  if (from) return `From ${from}`
  if (until) return `Until ${until}`
  return ''
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    // People who cannot see a project get 404, not 403 — same as a missing one.
    project.value = await api.getProject(id.value)
    await Promise.all([loadMembers(), loadTasks(), loadBoard()])
  }
  catch (e) {
    errorMessage.value = (e as Error).message
    loadFailed.value = true
  }
  finally {
    isLoading.value = false
  }
}

async function loadMembers() {
  try {
    members.value = await api.listProjectMembers(id.value)
  }
  catch {
    members.value = []
  }
}

/** Cards for both the board and the list: the API caps a page at 100. */
async function loadTasks() {
  try {
    tasks.value = (await api.listTasks({ projectId: id.value, limit: 100 })).data
  }
  catch {
    tasks.value = []
  }
}

async function loadBoard() {
  try {
    const res = await api.getProjectBoard(id.value)
    board.value = { ...res, columns: res.columns ?? [] }
    if (board.value.columns.length && !board.value.columns.some(c => c.id === activeColumnId.value)) activeColumnId.value = board.value.columns[0]!.id
  }
  catch {
    // A property without a provisioned board still has the list and members.
    board.value = null
  }
}

/** Run a mutation, then refetch so progress and status stay truthful. */
async function act(fn: () => Promise<unknown>, then?: () => Promise<unknown>) {
  if (acting.value) return false
  acting.value = true
  errorMessage.value = ''
  try {
    await fn()
    await (then ? then() : load())
    return true
  }
  catch (e) {
    errorMessage.value = (e as Error).message
    return false
  }
  finally {
    acting.value = false
  }
}

// ── board ────────────────────────────────────────────────────────────────────

const activeColumnId = ref('')
const columns = computed(() => board.value?.columns ?? [])
const countByColumn = computed(() => {
  const counts = new Map<string, number>()
  for (const task of tasks.value) if (task.columnId) counts.set(task.columnId, (counts.get(task.columnId) ?? 0) + 1)
  return counts
})
const columnTasks = computed(() => tasks.value.filter(t => t.columnId === activeColumnId.value))

const movingTask = ref<TaskListItem | null>(null)
const moveOpen = computed({ get: () => movingTask.value !== null, set: (open: boolean) => { if (!open) movingTask.value = null } })

/**
 * The same guards as the task detail: NEW is unreachable, SUBMITTED only via
 * submission, VERIFIED is sign-off (leader, admin — and here the manager, who
 * passes every leader check on the project's tasks); a SUBMITTED task offers
 * only park/cancel.
 */
function moveColumnsFor(task: TaskListItem) {
  return columns.value.filter((column) => {
    if (!column.status || column.status === 'NEW' || column.status === 'SUBMITTED') return false
    if (column.status === 'VERIFIED' && !(caps.isLeader.value || rights.value.manages)) return false
    if (task.status === 'SUBMITTED' && !['PENDING', 'CANCELLED'].includes(column.status)) return false
    return true
  })
}
const moveColumns = computed(() => (movingTask.value ? moveColumnsFor(movingTask.value) : []))

function canMoveCard(task: TaskListItem) {
  const mine = task.assignment?.kind === 'STAFF' && task.assignment.staffId === session.userId.value
  return moveColumnsFor(task).length > 0 && (caps.isLeader.value || rights.value.manages || (mine && task.status !== 'SUBMITTED'))
}

function move(payload: { columnId: string, description: string | null }) {
  const task = movingTask.value
  if (!task) return
  void act(async () => {
    await api.moveTask({ taskId: task.id, ...payload })
    movingTask.value = null
  }, async () => {
    await Promise.all([loadTasks(), refreshProject()])
  })
}

async function refreshProject() {
  try {
    project.value = await api.getProject(id.value)
  }
  catch { /* the header keeps its last state */ }
}

// ── edit ─────────────────────────────────────────────────────────────────────

const editOpen = ref(false)
const editError = ref('')
const isSaving = ref(false)
const editName = ref('')
const editDescription = ref('')
const editStart = ref('')
const editEnd = ref('')

function openEdit() {
  if (!project.value) return
  editName.value = project.value.name
  editDescription.value = project.value.description ?? ''
  editStart.value = project.value.startDate ?? ''
  editEnd.value = project.value.endDate ?? ''
  editError.value = ''
  editOpen.value = true
}

const canSaveEdit = computed(() => Boolean(editName.value.trim()) && !isSaving.value && (!editStart.value || !editEnd.value || editEnd.value >= editStart.value))

async function saveEdit() {
  if (!canSaveEdit.value) return
  isSaving.value = true
  editError.value = ''
  try {
    // Every key sent: an emptied field clears (null); name can only change.
    project.value = await api.updateProject(id.value, {
      name: editName.value.trim(),
      description: editDescription.value.trim() || null,
      startDate: editStart.value || null,
      endDate: editEnd.value || null,
    })
    editOpen.value = false
  }
  catch (e) {
    editError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

// ── complete / cancel / reopen ───────────────────────────────────────────────

const completeOpen = ref(false)
const cancelOpen = ref(false)
const openCount = computed(() => {
  const p = project.value?.progress
  return p ? Math.max(0, p.total - p.done) : 0
})

async function complete() {
  completeOpen.value = false
  await act(async () => {
    const res = await api.completeProject(id.value)
    // The complete response is the ONLY one that carries openTasks.
    notice.value = res.openTasks && res.openTasks > 0
      ? `Completed with ${res.openTasks} open ${res.openTasks === 1 ? 'task' : 'tasks'}. They stay visible here and under Mine.`
      : 'Project completed.'
  })
}

async function cancelProject() {
  cancelOpen.value = false
  await act(async () => {
    await api.cancelProject(id.value)
    notice.value = 'Project cancelled.'
  })
}

async function reopen() {
  // 409 when another active project took the name meanwhile — the message says so.
  await act(async () => {
    await api.reopenProject(id.value)
    notice.value = 'Project reopened.'
  })
}

// ── hand over ────────────────────────────────────────────────────────────────

const handOverOpen = ref(false)
const handOverTo = ref('')
const handOverError = ref('')
const isHandingOver = ref(false)
const handOverCandidates = computed(() => members.value.filter(m => m.level !== 'MANAGER'))

async function handOver() {
  if (!handOverTo.value || isHandingOver.value) return
  isHandingOver.value = true
  handOverError.value = ''
  try {
    project.value = await api.handOverProject(id.value, handOverTo.value)
    await loadMembers()
    handOverOpen.value = false
    handOverTo.value = ''
    notice.value = `${displayName(manager.value?.name)} now manages this project.`
  }
  catch (e) {
    handOverError.value = (e as Error).message
  }
  finally {
    isHandingOver.value = false
  }
}

// ── tasks tab ────────────────────────────────────────────────────────────────

const addTaskOpen = ref(false)
const addTaskError = ref('')
const addTaskLoading = ref(false)
const addingTaskId = ref('')
const addTaskSearch = ref('')
const candidatesForAdd = ref<TaskListItem[]>([])

/**
 * Only staff-created tasks may join a project (a guest request 422s), and
 * the default list already leaves project tasks out — so what comes back
 * is exactly the pool to pick from, minus anything that somehow carries a
 * project label.
 */
async function openAddTask() {
  addTaskOpen.value = true
  addTaskError.value = ''
  addTaskSearch.value = ''
  addTaskLoading.value = true
  try {
    const res = await api.listTasks({ limit: 100 })
    candidatesForAdd.value = res.data.filter(t => t.sourceProduct === 'sentec-tasks' && !t.project && !['FINISHED', 'VERIFIED', 'CANCELLED'].includes(t.status))
  }
  catch (e) {
    addTaskError.value = (e as Error).message
    candidatesForAdd.value = []
  }
  finally {
    addTaskLoading.value = false
  }
}

const filteredCandidates = computed(() => {
  const q = addTaskSearch.value.trim().toLowerCase()
  if (!q) return candidatesForAdd.value
  return candidatesForAdd.value.filter(t => t.title.toLowerCase().includes(q) || (t.roomNumber ?? '').toLowerCase().includes(q))
})

async function addExisting(task: TaskListItem) {
  if (addingTaskId.value) return
  addingTaskId.value = task.id
  addTaskError.value = ''
  try {
    await api.addTaskToProject(id.value, task.id)
    addTaskOpen.value = false
    await Promise.all([loadTasks(), refreshProject()])
  }
  catch (e) {
    addTaskError.value = (e as Error).message
  }
  finally {
    addingTaskId.value = ''
  }
}

const removingTaskId = ref('')
async function removeFromProject(task: TaskListItem) {
  if (removingTaskId.value) return
  removingTaskId.value = task.id
  errorMessage.value = ''
  try {
    await api.removeTaskFromProject(id.value, task.id)
    await Promise.all([loadTasks(), refreshProject()])
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    removingTaskId.value = ''
  }
}

// ── members tab ──────────────────────────────────────────────────────────────

type Level = 'MEMBER' | 'VIEWER'
const memberError = ref('')
const memberBusyId = ref('')
const addMemberId = ref('')
const addMemberLevel = ref<Level>('MEMBER')
const people = ref<AssignableStaff[]>([])
const peopleLoaded = ref(false)
const peopleError = ref('')

/** The directory, widened by `projectId` so the manager may ask, not only leaders. */
async function loadPeople() {
  if (peopleLoaded.value) return
  peopleError.value = ''
  try {
    people.value = await api.listAssignableStaff(null, { projectId: id.value })
    peopleLoaded.value = true
  }
  catch (e) {
    peopleError.value = (e as Error).message
  }
}

const pickablePeople = computed(() => people.value.filter(p => !members.value.some(m => m.staffId === p.id)))

async function addMember() {
  if (!addMemberId.value || memberBusyId.value) return
  memberBusyId.value = addMemberId.value
  memberError.value = ''
  try {
    members.value = await api.setProjectMember(id.value, addMemberId.value, addMemberLevel.value)
    addMemberId.value = ''
  }
  catch (e) {
    memberError.value = (e as Error).message
  }
  finally {
    memberBusyId.value = ''
  }
}

async function setLevel(member: ProjectMember, level: Level) {
  if (memberBusyId.value || member.level === level) return
  memberBusyId.value = member.staffId
  memberError.value = ''
  try {
    members.value = await api.setProjectMember(id.value, member.staffId, level)
  }
  catch (e) {
    memberError.value = (e as Error).message
  }
  finally {
    memberBusyId.value = ''
  }
}

async function removeMember(member: ProjectMember) {
  if (memberBusyId.value) return
  memberBusyId.value = member.staffId
  memberError.value = ''
  try {
    members.value = await api.removeProjectMember(id.value, member.staffId)
  }
  catch (e) {
    memberError.value = (e as Error).message
  }
  finally {
    memberBusyId.value = ''
  }
}

function onTab(value: string | number) {
  tab.value = value as typeof tab.value
  if (tab.value === 'members' && rights.value.canEditMembers) void loadPeople()
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <button
      type="button"
      class="flex min-h-11 items-center gap-1 rounded text-sm font-medium text-muted-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="router.back()"
    >
      <ArrowLeftIcon class="h-4 w-4" /> Back
    </button>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>{{ loadFailed ? 'Can\'t open this project' : 'That didn\'t work' }}</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !project" class="space-y-3">
      <Skeleton class="h-40 w-full rounded-xl" />
      <Skeleton class="h-9 w-full rounded-lg" />
      <Skeleton class="h-32 w-full rounded-xl" />
    </div>

    <template v-else-if="project && status">
      <Card>
        <CardHeader class="gap-2">
          <div class="flex items-start justify-between gap-2">
            <CardTitle class="text-lg leading-snug">{{ project.name }}</CardTitle>
            <Button size="icon" variant="ghost" class="-mr-2 -mt-1 shrink-0" :disabled="isLoading" aria-label="Refresh" @click="load">
              <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
            </Button>
          </div>
          <p v-if="project.description" class="text-sm leading-relaxed text-foreground/85">{{ project.description }}</p>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="status.badge">
              <span class="h-1.5 w-1.5 rounded-full" :class="status.dot" />
              {{ status.label }}
            </span>
            <Badge v-if="project.late" variant="destructive" class="text-[10px]">Late</Badge>
            <Badge v-if="project.needsManager" variant="outline" class="border-warning/50 text-[10px] text-warning-tint-foreground">Needs manager</Badge>
            <Badge v-if="project.myLevel" variant="secondary" class="text-[10px]">You · {{ projectLevelLabel(project.myLevel) }}</Badge>
            <Badge v-else-if="caps.isAdmin.value" variant="secondary" class="text-[10px]">You · Admin, not a member</Badge>
          </div>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span class="tabular-nums">{{ project.progress.percent }}% · {{ project.progress.done }} of {{ project.progress.total }} done</span>
              <span class="flex items-center gap-2 tabular-nums">
                <span v-if="project.progress.overdue" class="text-destructive">{{ project.progress.overdue }} overdue</span>
                <span v-if="project.progress.unassigned">{{ project.progress.unassigned }} unassigned</span>
              </span>
            </div>
            <Progress :model-value="project.progress.percent" :aria-label="`${project.progress.percent}% done`" />
          </div>
          <div class="flex items-center gap-2">
            <UserRoundCogIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="text-muted-foreground">Manager</span>
            <span class="ml-auto flex min-w-0 items-center gap-2 font-medium">
              <template v-if="manager">
                <Avatar class="h-5 w-5">
                  <AvatarFallback class="bg-primary/10 text-[9px] font-semibold text-primary">{{ initials(manager.name) }}</AvatarFallback>
                </Avatar>
                <span class="truncate">{{ displayName(manager.name) }}</span>
                <span v-if="manager.staffId === session.userId.value" class="text-xs text-muted-foreground">(you)</span>
              </template>
              <span v-else class="text-muted-foreground">Nobody yet</span>
            </span>
          </div>
          <div v-if="dates" class="flex items-center gap-2">
            <CalendarDaysIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="text-muted-foreground">Dates</span>
            <span class="ml-auto font-medium tabular-nums">{{ dates }}</span>
          </div>
          <div v-if="project.completedAt" class="flex items-center gap-2">
            <span class="h-4 w-4" />
            <span class="text-muted-foreground">Completed</span>
            <span class="ml-auto font-medium tabular-nums">{{ formatDateTime(project.completedAt) }}</span>
          </div>
        </CardContent>
      </Card>

      <Alert v-if="notice">
        <InfoIcon />
        <AlertTitle>{{ notice }}</AlertTitle>
      </Alert>

      <!-- Viewers see the work; they do not comment on it. Said once, here. -->
      <Alert v-if="project.myLevel === 'VIEWER'">
        <InfoIcon />
        <AlertTitle>You are a viewer here</AlertTitle>
        <AlertDescription>You can follow this project's tasks but not comment on them or take them on.</AlertDescription>
      </Alert>

      <div v-if="rights.manages" class="flex flex-wrap gap-2">
        <Button variant="outline" class="min-h-11 flex-1" :disabled="acting" @click="openEdit">
          <PencilIcon class="h-4 w-4" /> Edit
        </Button>
        <template v-if="isActive">
          <Button class="min-h-11 flex-1" :disabled="acting" @click="completeOpen = true">
            <CheckCircle2Icon class="h-4 w-4" /> Complete
          </Button>
          <Button variant="outline" class="min-h-11 flex-1" :disabled="acting || handOverCandidates.length === 0" @click="handOverOpen = true">
            <ArrowLeftRightIcon class="h-4 w-4" /> Hand over
          </Button>
          <Button variant="outline" class="min-h-11 flex-1 text-destructive" :disabled="acting" @click="cancelOpen = true">
            <XCircleIcon class="h-4 w-4" /> Cancel
          </Button>
        </template>
        <Button v-else class="min-h-11 flex-1" :disabled="acting" @click="reopen">
          <RotateCwIcon class="h-4 w-4" /> Reopen
        </Button>
      </div>

      <Tabs :model-value="tab" @update:model-value="onTab">
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({{ tasks.length }})</TabsTrigger>
          <TabsTrigger value="members">Members ({{ members.length }})</TabsTrigger>
        </TabsList>
      </Tabs>

      <!-- Board: the property's columns, this project's cards. -->
      <template v-if="tab === 'board'">
        <EmptyState
          v-if="!board"
          :icon="SquareKanbanIcon"
          title="No board for this property"
          description="Boards are provisioned per property. The Tasks tab still lists everything."
        />
        <template v-else>
          <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button
              v-for="column in columns"
              :key="column.id"
              type="button"
              class="flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="column.id === activeColumnId ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
              @click="activeColumnId = column.id"
            >
              <span class="h-2 w-2 rounded-full" :class="column.status ? statusMeta(column.status).dot : 'bg-muted-foreground/40'" />
              {{ column.name }}
              <span class="rounded-full bg-background/70 px-1.5 tabular-nums">{{ countByColumn.get(column.id) ?? 0 }}</span>
            </button>
          </div>
          <div v-if="columnTasks.length" class="space-y-3">
            <div v-for="task in columnTasks" :key="task.id" class="space-y-2">
              <TaskCard :task="task" :mine="task.assignment?.kind === 'STAFF' && task.assignment.staffId === session.userId.value" />
              <Button
                v-if="canMoveCard(task)"
                variant="outline"
                size="sm"
                class="min-h-11 w-full"
                :disabled="acting"
                @click="movingTask = task"
              >
                <ArrowRightLeftIcon class="h-4 w-4" /> Move
              </Button>
            </div>
          </div>
          <p v-else class="select-none py-12 text-center text-sm text-muted-foreground/60">Nothing in this column</p>
        </template>
      </template>

      <!-- Tasks: the flat list, plus the two ways work gets into a project. -->
      <template v-else-if="tab === 'tasks'">
        <div v-if="rights.canCreateTask || (rights.manages && isActive)" class="flex flex-wrap gap-2">
          <Button v-if="rights.canCreateTask" class="min-h-11 flex-1" @click="navigateTo({ path: '/tasks/new', query: { projectId: id } })">
            <PlusIcon class="h-4 w-4" /> New task
          </Button>
          <Button v-if="rights.manages && isActive" variant="outline" class="min-h-11 flex-1" @click="openAddTask">
            <LayoutListIcon class="h-4 w-4" /> Add existing task
          </Button>
        </div>
        <EmptyState
          v-if="tasks.length === 0"
          :icon="LayoutListIcon"
          title="No tasks in this project"
          :description="rights.canCreateTask ? 'Raise one here, or move an existing staff-created task in.' : 'Tasks added to this project will show here.'"
        />
        <div v-else class="space-y-3">
          <div v-for="task in tasks" :key="task.id" class="space-y-1">
            <TaskCard :task="task" :mine="task.assignment?.kind === 'STAFF' && task.assignment.staffId === session.userId.value" />
            <div v-if="rights.manages" class="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                class="h-9 text-muted-foreground hover:text-destructive"
                :disabled="Boolean(removingTaskId)"
                :aria-busy="removingTaskId === task.id"
                @click="removeFromProject(task)"
              >
                {{ removingTaskId === task.id ? 'Removing…' : 'Remove from project' }}
              </Button>
            </div>
          </div>
          <p v-if="tasks.length >= 100" class="pb-2 text-center text-xs text-muted-foreground">Showing the first 100.</p>
        </div>
      </template>

      <!-- Members: manager first (the API orders it so); AUTO = joined by being handed a task. -->
      <template v-else>
        <Alert v-if="memberError" variant="destructive">
          <AlertTitle>That didn't work</AlertTitle>
          <AlertDescription>{{ memberError }}</AlertDescription>
        </Alert>

        <div v-if="rights.canEditMembers" class="space-y-2 rounded-lg border px-3 py-3">
          <p class="text-sm font-semibold text-foreground">Add a member</p>
          <Alert v-if="peopleError" variant="destructive">
            <AlertTitle>Couldn't load the team</AlertTitle>
            <AlertDescription class="space-y-2">
              <p>{{ peopleError }}</p>
              <Button size="sm" variant="outline" @click="peopleLoaded = false; loadPeople()">Retry</Button>
            </AlertDescription>
          </Alert>
          <div v-else class="flex items-end gap-2">
            <Select v-model="addMemberId">
              <SelectTrigger class="min-w-0 flex-1" aria-label="Person to add">
                <SelectValue :placeholder="peopleLoaded ? 'Choose a person' : 'Loading…'" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="person in pickablePeople" :key="person.id" :value="person.id">
                  {{ person.name }}<span class="text-muted-foreground"> · {{ person.role }}</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="addMemberLevel">
              <SelectTrigger class="w-28 shrink-0" aria-label="Level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="VIEWER">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button :disabled="!addMemberId || Boolean(memberBusyId)" :aria-busy="memberBusyId === addMemberId" @click="addMember">Add</Button>
          </div>
        </div>

        <EmptyState v-if="members.length === 0" :icon="UsersRoundIcon" title="No members" description="Nobody is on this project yet." />
        <ul v-else class="space-y-1.5">
          <li
            v-for="member in members"
            :key="member.staffId"
            class="flex min-h-11 items-center gap-3 rounded-lg border bg-card px-3 py-2"
          >
            <Avatar class="h-8 w-8 shrink-0">
              <AvatarFallback class="bg-primary/10 text-[10px] font-semibold text-primary">{{ initials(member.name) }}</AvatarFallback>
            </Avatar>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">
                {{ displayName(member.name) }}
                <span v-if="member.staffId === session.userId.value" class="text-xs font-normal text-muted-foreground">(you)</span>
              </span>
              <span class="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                <span>{{ projectLevelLabel(member.level) }}</span>
                <span v-if="member.source === 'AUTO'" class="rounded-full bg-muted px-1.5 font-medium">auto</span>
                <span>· since {{ formatDateTime(member.addedAt) }}</span>
              </span>
            </span>
            <template v-if="rights.canEditMembers">
              <span v-if="member.level === 'MANAGER'" class="shrink-0 text-[11px] text-muted-foreground">Use Hand over</span>
              <template v-else>
                <Select :model-value="member.level" :disabled="Boolean(memberBusyId)" @update:model-value="value => setLevel(member, value as Level)">
                  <SelectTrigger class="h-9 w-26 shrink-0" :aria-label="`Level for ${displayName(member.name)}`">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">Member</SelectItem>
                    <SelectItem value="VIEWER">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-9 shrink-0 text-muted-foreground hover:text-destructive"
                  :disabled="Boolean(memberBusyId)"
                  :aria-busy="memberBusyId === member.staffId"
                  :aria-label="`Remove ${displayName(member.name)}`"
                  @click="removeMember(member)"
                >
                  Remove
                </Button>
              </template>
            </template>
          </li>
        </ul>
        <p v-if="rights.manages && !isActive" class="px-1 text-xs text-muted-foreground">Membership is fixed while the project is closed. Reopen it to change who is on it.</p>
      </template>

      <StatusMoveSheet
        v-model:open="moveOpen"
        :columns="moveColumns"
        :current-column-id="movingTask?.columnId ?? null"
        :busy="acting"
        @move="move"
      />

      <Dialog v-model:open="editOpen">
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Clearing a field clears it on the project. The name cannot be blank.</DialogDescription>
          </DialogHeader>
          <Alert v-if="editError" variant="destructive">
            <AlertTitle>Couldn't save</AlertTitle>
            <AlertDescription>{{ editError }}</AlertDescription>
          </Alert>
          <form class="space-y-4" @submit.prevent="saveEdit">
            <div class="space-y-2">
              <Label for="edit-name">Name</Label>
              <Input id="edit-name" v-model="editName" maxlength="120" class="min-h-11" required />
            </div>
            <div class="space-y-2">
              <Label for="edit-description">Description</Label>
              <Textarea id="edit-description" v-model="editDescription" rows="3" class="resize-none" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-2">
                <Label for="edit-start">Starts</Label>
                <Input id="edit-start" v-model="editStart" type="date" class="min-h-11" />
              </div>
              <div class="space-y-2">
                <Label for="edit-end">Ends</Label>
                <Input id="edit-end" v-model="editEnd" type="date" class="min-h-11" />
              </div>
            </div>
            <p v-if="editStart && editEnd && editEnd < editStart" class="text-xs text-destructive">The end date is before the start date.</p>
            <DialogFooter>
              <Button type="button" variant="outline" :disabled="isSaving" @click="editOpen = false">Cancel</Button>
              <Button type="submit" :disabled="!canSaveEdit" :aria-busy="isSaving">{{ isSaving ? 'Saving…' : 'Save' }}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog v-model:open="completeOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              <template v-if="openCount > 0">{{ openCount }} {{ openCount === 1 ? 'task is' : 'tasks are' }} still open. Completing is allowed anyway; the open tasks keep their state.</template>
              <template v-else>Every task is done. The project moves to Completed and can be reopened later.</template>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction @click="complete">Complete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog v-model:open="cancelOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this project?</AlertDialogTitle>
            <AlertDialogDescription>The project moves to Cancelled. Its tasks are not cancelled with it, and it can be reopened later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction @click="cancelProject">Cancel project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog v-model:open="handOverOpen">
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Hand over</DialogTitle>
            <DialogDescription>The new manager must already be a member. {{ manager && manager.staffId === session.userId.value ? 'You become' : 'The current manager becomes' }} a member.</DialogDescription>
          </DialogHeader>
          <Alert v-if="handOverError" variant="destructive">
            <AlertTitle>Couldn't hand over</AlertTitle>
            <AlertDescription>{{ handOverError }}</AlertDescription>
          </Alert>
          <div class="space-y-2">
            <Label for="hand-over-to">New manager</Label>
            <Select v-model="handOverTo">
              <SelectTrigger id="hand-over-to" class="w-full">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="member in handOverCandidates" :key="member.staffId" :value="member.staffId">
                  {{ displayName(member.name) }}<span class="text-muted-foreground"> · {{ projectLevelLabel(member.level) }}</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" :disabled="isHandingOver" @click="handOverOpen = false">Cancel</Button>
            <Button :disabled="!handOverTo || isHandingOver" :aria-busy="isHandingOver" @click="handOver">{{ isHandingOver ? 'Handing over…' : 'Hand over' }}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog v-model:open="addTaskOpen">
        <DialogContent class="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add an existing task</DialogTitle>
            <DialogDescription>Open, staff-created tasks that are not in a project yet. A guest request cannot join a project.</DialogDescription>
          </DialogHeader>
          <Alert v-if="addTaskError" variant="destructive">
            <AlertTitle>That didn't work</AlertTitle>
            <AlertDescription>{{ addTaskError }}</AlertDescription>
          </Alert>
          <div class="relative">
            <SearchIcon class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="addTaskSearch" placeholder="Filter by title or room…" class="pl-9" />
          </div>
          <div v-if="addTaskLoading" class="space-y-2">
            <Skeleton v-for="n in 3" :key="n" class="h-14 w-full rounded-lg" />
          </div>
          <p v-else-if="filteredCandidates.length === 0" class="py-8 text-center text-sm text-muted-foreground">Nothing to add.</p>
          <div v-else class="max-h-[50vh] space-y-1.5 overflow-y-auto">
            <button
              v-for="task in filteredCandidates"
              :key="task.id"
              type="button"
              :disabled="Boolean(addingTaskId)"
              class="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors disabled:opacity-60 enabled:active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="addExisting(task)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ task.title }}</span>
                <span class="block truncate text-xs text-muted-foreground">
                  {{ task.roomNumber ?? task.locationTypeName ?? 'No room' }} · {{ statusMeta(task.status).label }}<template v-if="task.department"> · {{ task.department.name }}</template>
                </span>
              </span>
              <span v-if="addingTaskId === task.id" class="text-xs text-muted-foreground">Adding…</span>
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" :disabled="Boolean(addingTaskId)" @click="addTaskOpen = false">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </template>
  </div>
</template>
