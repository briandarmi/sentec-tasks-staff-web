<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeftIcon, CircleDashedIcon, FolderKanbanIcon, LockIcon, MinusIcon, PlusIcon, RepeatIcon, Trash2Icon, UserRoundIcon, UsersIcon, WandSparklesIcon } from '@lucide/vue'
import { useTasksApi, type StaffCreateTaskPayload, type TaskPreview } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import { useSession } from '~/composables/useSession'
import { useTenant } from '~/composables/useTenant'
import type { Category, CatalogItem, HotelDepartment, Location, LocationType, Project, TaskPriority, TaskTemplate, TaskTemplateContent, Team } from '~/utils/clientFakeApi'
import { draftToRecurrence, emptyRecurrenceDraft } from '~/utils/recurrence'
import type { RecurrenceDraft } from '~/utils/recurrence'
import { TASK_PRIORITIES, formatDateTime, priorityMeta } from '~/utils/task-ui'
import { HEAT_TONE, prioritySignal } from '~/utils/task-signals'

definePageMeta({ title: 'New task' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()
const caps = useCaps()
const session = useSession()
const { tenant } = useTenant()

// ── in a project ─────────────────────────────────────────────────────────────

/**
 * `?projectId=` from a project's Tasks tab: the task is created through
 * POST /v1/projects/{id}/tasks (manager, admin, or a member with create-task)
 * and belongs to the project from the start. The preview is the same
 * resolver either way.
 */
const projectId = computed(() => (typeof route.query.projectId === 'string' ? route.query.projectId : ''))
const project = ref<Project | null>(null)
const projectError = ref('')

async function loadProject() {
  if (!projectId.value) return
  try {
    project.value = await api.getProject(projectId.value)
  }
  catch (e) {
    projectError.value = (e as Error).message
  }
}

// ── start from a template ────────────────────────────────────────────────────

/** Shared, active templates — the property's standing jobs. Empty or refused: the picker hides. */
const templates = ref<TaskTemplate[]>([])
const templateId = ref('')

async function loadTemplates() {
  try {
    templates.value = await api.listTaskTemplates({ scope: 'shared', active: true })
  }
  catch {
    templates.value = []
  }
}

/**
 * Prefill from the template's content. The item is set first and the title
 * after the watcher has had its turn, or the item's name would overwrite the
 * template's own title. A template's priority counts as a deliberate pick.
 */
async function applyTemplate(id: string) {
  templateId.value = id
  const template = templates.value.find(t => t.id === id)
  if (!template) return
  const content = template.content
  itemRef.value = content.itemRef ?? ''
  await nextTick()
  title.value = content.title
  description.value = content.description ?? ''
  if (content.roomNumber) {
    freeTextLocation.value = true
    roomNumber.value = content.roomNumber
    locationRef.value = ''
  }
  else {
    freeTextLocation.value = false
    roomNumber.value = ''
    locationRef.value = content.locationRef ?? ''
  }
  if (content.priority) {
    priority.value = content.priority
    priorityTouched.value = true
  }
  quantity.value = content.quantity && content.quantity > 0 ? content.quantity : 1
  checklist.value = [...content.checklistLabels]
  const assignee = content.assignee
  if (assignee?.assigneeKind === 'STAFF' && assignee.assigneeStaffId) {
    assigneeKind.value = 'STAFF'
    assigneeStaffId.value = caps.role.value === 'staff' ? session.userId.value ?? '' : assignee.assigneeStaffId
    assigneeTeamId.value = ''
  }
  else if (assignee?.assigneeKind === 'TEAM' && assignee.assigneeTeamId) {
    assigneeKind.value = 'TEAM'
    assigneeTeamId.value = assignee.assigneeTeamId
    assigneeStaffId.value = ''
    void loadTeams()
  }
  else {
    assigneeKind.value = 'UNASSIGNED'
    assigneeStaffId.value = ''
    assigneeTeamId.value = ''
  }
}

// ── repeat ───────────────────────────────────────────────────────────────────

/**
 * With Repeat on, submit goes to POST /v1/recurring-tasks: the API creates a
 * personal template AND the first task now, then the worker makes the rest
 * on the schedule. Template content carries no due date, activation date or
 * requester, so those controls fold away while Repeat is on.
 */
const repeat = ref(false)
const recurrence = ref<RecurrenceDraft>(emptyRecurrenceDraft())
const recurrenceResult = computed(() => draftToRecurrence(recurrence.value))

const categories = ref<Category[]>([])
const items = ref<CatalogItem[]>([])
const locations = ref<Location[]>([])
const locationTypes = ref<LocationType[]>([])
/** Department names for the preview — an admin-only read, so possibly empty. */
const departments = ref<HotelDepartment[]>([])
const isLoading = ref(false)
const isSubmitting = ref(false)
const errorMessage = ref('')

const itemRef = ref('')
const title = ref('')
/** Registry location vs free-text room label: mutually exclusive, toggled explicitly. */
const locationRef = ref('')
const freeTextLocation = ref(false)
const roomNumber = ref('')
const quantity = ref(1)
const description = ref('')
const requesterName = ref('')
/**
 * Touched-flags, not emptiness checks: a field the user deliberately cleared
 * is still theirs. While untouched, the value is display-only and never sent —
 * which is what lets the server own the resolution (item default priority, PMS
 * requester lookup). Echoing a displayed value back would silently short-circuit
 * both.
 */
const priorityTouched = ref(false)
const requesterTouched = ref(false)
const priority = ref<TaskPriority>('NORMAL')
const checklist = ref<string[]>([])
const showSchedule = ref(false)
const activationDate = ref('')
const dueAt = ref('')

type AssigneeKind = 'UNASSIGNED' | 'STAFF' | 'TEAM'
const assigneeKind = ref<AssigneeKind>('UNASSIGNED')
const assigneeStaffId = ref('')
const assigneeTeamId = ref('')
const teams = ref<Team[]>([])
const teamsLoaded = ref(false)
const teamsError = ref('')

const activeItems = computed(() => items.value.filter(item => item.isActive))
const selectedItem = computed(() => activeItems.value.find(item => item.id === itemRef.value) ?? null)

/** Group the catalog by category so the picker is scannable, not one long list. */
const groups = computed(() =>
  categories.value
    .map(category => ({ category, items: activeItems.value.filter(item => item.categoryId === category.id) }))
    .filter(group => group.items.length > 0),
)

/** Active locations grouped by type, for the registry picker. */
const locationGroups = computed(() => {
  const typeName = new Map(locationTypes.value.map(type => [type.id, type.name]))
  const groupsByType = new Map<string, Location[]>()
  for (const loc of locations.value) {
    if (!loc.isActive) continue
    const name = typeName.get(loc.locationTypeId) ?? 'Other'
    groupsByType.set(name, [...(groupsByType.get(name) ?? []), loc])
  }
  return [...groupsByType.entries()].map(([name, rows]) => ({ name, rows }))
})

const canSubmit = computed(() => Boolean(title.value.trim() || selectedItem.value) && !isSubmitting.value && (!repeat.value || recurrenceResult.value.ok))

// Selecting an item overwrites the title with the item name (never appends);
// it stays editable, because when it is wrong the person typing knows better.
watch(selectedItem, (item) => {
  if (item) title.value = item.name
  // An untouched priority control mirrors the item default. Touch it once and
  // it is yours, even back on the same value.
  if (!priorityTouched.value) priority.value = item?.defaultPriority ?? 'NORMAL'
})

/**
 * The picker wears the same flag and tint the card will: amber for High, red
 * for Urgent, grey for Low, Sentinel Blue for the default. So the colour a
 * task gets is chosen by seeing it, not by reading about it afterwards.
 */
function priorityIcon(option: TaskPriority) {
  return prioritySignal(option)?.icon ?? MinusIcon
}

function priorityClass(option: TaskPriority) {
  if (priority.value !== option) return 'border-border bg-card text-muted-foreground active:bg-accent'
  const signal = prioritySignal(option)
  return signal ? `border-transparent ${HEAT_TONE[signal.heat].chip}` : 'border-primary/40 bg-primary-tint text-primary-tint-foreground'
}

const ASSIGNEE_ICON = { UNASSIGNED: CircleDashedIcon, STAFF: UserRoundIcon, TEAM: UsersIcon } as const

function pickPriority(value: TaskPriority) {
  priority.value = value
  priorityTouched.value = true
}

function toggleFreeText() {
  freeTextLocation.value = !freeTextLocation.value
  // Mutually exclusive in both directions: no half-cleared leftovers.
  if (freeTextLocation.value) locationRef.value = ''
  else roomNumber.value = ''
}

function addChecklistStep() {
  checklist.value.push('')
}

function removeChecklistStep(index: number) {
  checklist.value.splice(index, 1)
}

function pickAssigneeKind(kind: AssigneeKind) {
  assigneeKind.value = kind
  // A stale id alongside a new kind is exactly the incomplete-assignee case.
  if (kind !== 'STAFF') assigneeStaffId.value = ''
  if (kind !== 'TEAM') assigneeTeamId.value = ''
  if (kind === 'STAFF' && caps.role.value === 'staff') {
    // Staff can only self-assign at creation — one option, pre-picked.
    assigneeStaffId.value = session.userId.value ?? ''
  }
  if (kind === 'TEAM') void loadTeams()
}

/** Lazy: the common case (an unassigned task) costs zero extra requests. */
async function loadTeams() {
  if (teamsLoaded.value) return
  teamsError.value = ''
  try {
    teams.value = (await api.listTeams()).filter(team => team.isActive)
    teamsLoaded.value = true
  }
  catch (e) {
    teamsError.value = (e as Error).message
  }
}

function toIso(value: string): string | null {
  return value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null
}

function buildPayload(): StaffCreateTaskPayload {
  const assignee = assigneeKind.value === 'STAFF' && assigneeStaffId.value
    ? { assigneeKind: 'STAFF' as const, assigneeStaffId: assigneeStaffId.value }
    : assigneeKind.value === 'TEAM' && assigneeTeamId.value
      ? { assigneeKind: 'TEAM' as const, assigneeTeamId: assigneeTeamId.value }
      : null
  return {
    itemRef: itemRef.value || null,
    title: title.value.trim(),
    roomNumber: freeTextLocation.value ? roomNumber.value.trim() || null : null,
    locationRef: freeTextLocation.value ? null : locationRef.value || null,
    description: description.value.trim() || null,
    // Untouched → null → the server resolves it. That is the whole point.
    requesterName: requesterTouched.value ? requesterName.value.trim() || null : null,
    priority: priorityTouched.value ? priority.value : null,
    quantity: selectedItem.value?.itemQuantity ? quantity.value : null,
    checklistLabels: checklist.value.map(step => step.trim()).filter(Boolean),
    activationDate: showSchedule.value && !repeat.value ? toIso(activationDate.value) : null,
    dueAt: showSchedule.value && !repeat.value ? toIso(dueAt.value) : null,
    // Sent only when complete: half an assignee previews a 400 the real
    // create would never see.
    ...(assignee ? { assignee } : {}),
  }
}

/** The same form as template content: no due date, activation date or requester. */
function buildTemplateContent(): TaskTemplateContent {
  const payload = buildPayload()
  return {
    title: payload.title,
    description: payload.description ?? null,
    itemRef: payload.itemRef ?? null,
    locationRef: payload.locationRef ?? null,
    roomNumber: payload.roomNumber ?? null,
    priority: payload.priority ?? null,
    quantity: payload.quantity ?? null,
    checklistLabels: payload.checklistLabels ?? [],
    assignee: payload.assignee ?? null,
  }
}

// ── live routing preview ──────────────────────────────────────────────────────

const PREVIEW_DEBOUNCE_MS = 300
const preview = ref<TaskPreview | null>(null)
const previewWarnings = ref<string[]>([])
const previewLoading = ref(false)
const previewError = ref('')
let previewTimer: ReturnType<typeof setTimeout> | undefined
/**
 * In-flight token: every run captures an id and bails at each resume point if
 * a newer run started. An AbortController would stop the request but not this
 * race — a response already in flight can still resolve after abort.
 */
let previewRequestId = 0

const canPreview = computed(() => Boolean(title.value.trim()) || Boolean(selectedItem.value))

async function runPreview() {
  if (!canPreview.value) {
    previewRequestId += 1
    preview.value = null
    previewWarnings.value = []
    previewError.value = ''
    previewLoading.value = false
    return
  }
  const requestId = ++previewRequestId
  previewLoading.value = true
  previewError.value = ''
  try {
    const res = await api.previewTask(buildPayload())
    if (requestId !== previewRequestId) return
    preview.value = res.data
    // Warnings ride in the envelope's meta (null on the happy path).
    previewWarnings.value = res.warnings ?? []
  }
  catch (e) {
    if (requestId !== previewRequestId) return
    preview.value = null
    previewWarnings.value = []
    previewError.value = (e as Error).message
  }
  finally {
    if (requestId === previewRequestId) previewLoading.value = false
  }
}

watch(
  // The details note never affects resolution, so it is deliberately not watched.
  [title, itemRef, locationRef, roomNumber, freeTextLocation, quantity, priority, priorityTouched, requesterName, showSchedule, activationDate, dueAt, checklist, assigneeKind, assigneeStaffId, assigneeTeamId, repeat],
  () => {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => void runPreview(), PREVIEW_DEBOUNCE_MS)
  },
  { deep: true },
)

/**
 * Autofill mirrors the resolution, it never accumulates: a resolution with no
 * guest BLANKS a previously autofilled name, while a null preview (error or
 * empty panel) says nothing about the guest, so the last value stands. Once
 * touched, the field is the user's — even cleared.
 */
watch(preview, (resolved) => {
  if (requesterTouched.value || !resolved) return
  requesterName.value = resolved.task.requesterName ?? ''
})

const requesterAutofilled = computed(() => !requesterTouched.value && requesterName.value !== '')

onBeforeUnmount(() => {
  clearTimeout(previewTimer)
  previewRequestId += 1
})

const formatAbsolute = formatDateTime

/**
 * The preview task carries only hotelDepartmentId — names are an admin read.
 * A retired department can still be the routing target of an old rule; say
 * so rather than show a name nobody can pick any more.
 */
const departmentName = computed(() => {
  const id = preview.value?.task.hotelDepartmentId
  if (!id) return null
  const row = departments.value.find(d => d.id === id)
  if (!row) return 'Assigned automatically'
  return row.isActive === false ? `${row.departmentName} (inactive)` : row.departmentName
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [cats, catalogItems, locs, types] = await Promise.all([
      api.listCategories(),
      api.listCatalogItems(),
      api.listLocations(),
      api.listLocationTypes(),
    ])
    categories.value = cats
    items.value = catalogItems
    locations.value = locs
    locationTypes.value = types
    // Department names are admin-only; staff previews fall back to a generic label.
    try {
      departments.value = await api.listHotelDepartments()
    }
    catch {
      departments.value = []
    }
    await Promise.all([loadTemplates(), loadProject()])
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

async function submit() {
  if (!canSubmit.value) return
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    if (repeat.value) {
      if (!recurrenceResult.value.ok) throw new Error(recurrenceResult.value.error)
      const created = await api.createRecurringTask({ content: buildTemplateContent(), recurrence: recurrenceResult.value.recurrence })
      // The first task exists now; land on it with the "this repeats" notice.
      await navigateTo(created.taskId ? { path: `/tasks/${created.taskId}`, query: { repeats: '1' } } : '/recurring')
      return
    }
    const created = projectId.value
      ? (await api.createProjectTask(projectId.value, buildPayload())).data
      : await api.createTask(buildPayload())
    await navigateTo(`/tasks/${created.id}`)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
    isSubmitting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <button
      type="button"
      class="flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-muted-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
      @click="router.back()"
    >
      <ArrowLeftIcon class="size-5" aria-hidden="true" /> Back
    </button>

    <EmptyState
      v-if="!caps.canCreateTask.value"
      :icon="LockIcon"
      title="Not permitted"
      description="Your account can't raise tasks here — that needs the create-task permission, or a leader. Ask yours."
    />

    <template v-else>
      <div>
        <h2 class="text-xl font-bold tracking-tight">New task</h2>
        <p class="text-sm text-muted-foreground">Routing, deadlines, priority and requester are worked out for you — the preview below shows the outcome before you commit.</p>
      </div>

      <!-- Raised from a project: the task belongs to it from the start and
           will not appear on the hotel board. -->
      <Alert v-if="projectId" :variant="projectError ? 'destructive' : 'default'">
        <FolderKanbanIcon />
        <AlertTitle>{{ projectError ? 'Can\'t open that project' : `In project: ${project?.name ?? '…'}` }}</AlertTitle>
        <AlertDescription>
          {{ projectError || 'The task joins the project when it is created and shows on the project\'s board rather than the hotel board.' }}
        </AlertDescription>
      </Alert>

      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Couldn't create the task</AlertTitle>
        <AlertDescription class="space-y-2">
          <p>{{ errorMessage }}</p>
          <Button v-if="isLoading === false && items.length === 0" variant="secondary" @click="load">Retry</Button>
        </AlertDescription>
      </Alert>

      <div v-if="isLoading" class="space-y-3">
        <Skeleton class="h-11 w-full rounded-lg" />
        <Skeleton class="h-11 w-full rounded-lg" />
        <Skeleton class="h-24 w-full rounded-lg" />
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <!-- The property's standing jobs, as a starting point: everything below
             stays editable once filled in. -->
        <div v-if="templates.length" class="space-y-2 rounded-lg border border-dashed px-3 py-3">
          <Label for="template" class="flex items-center gap-1.5"><WandSparklesIcon class="h-3.5 w-3.5" /> Start from a template</Label>
          <Select :model-value="templateId" @update:model-value="value => applyTemplate(String(value ?? ''))">
            <SelectTrigger id="template" class="w-full">
              <SelectValue placeholder="Pick a template (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">Fills in the form below. Change anything before you create the task.</p>
        </div>

        <div class="space-y-2">
          <Label for="item">Catalog item</Label>
          <Select v-model="itemRef">
            <SelectTrigger id="item" class="w-full">
              <SelectValue placeholder="Pick an item (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup v-for="group in groups" :key="group.category.id">
                <SelectLabel>{{ group.category.name }}</SelectLabel>
                <SelectItem v-for="item in group.items" :key="item.id" :value="item.id">{{ item.name }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            <template v-if="groups.length === 0">
              No catalog items at this property yet — the task will use the default routing.
            </template>
            <template v-else>
              Picking an item routes the task, sets its default priority and seeds its checklist.
            </template>
          </p>
        </div>

        <div class="space-y-2">
          <Label for="title">Title</Label>
          <Input id="title" v-model="title" placeholder="Short summary" maxlength="255" class="min-h-11" />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label :for="freeTextLocation ? 'room-number' : undefined">Location</Label>
            <!-- Named for what it will do next, not for its current state. -->
            <button type="button" class="min-h-8 rounded text-sm font-semibold text-primary-tint-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint" @click="toggleFreeText">
              {{ freeTextLocation ? 'Choose from the location list instead' : 'Not in the list? Type it in' }}
            </button>
          </div>
          <Input
            v-if="freeTextLocation"
            id="room-number"
            v-model="roomNumber"
            placeholder="e.g. 1204"
            maxlength="80"
            class="min-h-11"
          />
          <Select v-else :model-value="toSelectValue(locationRef)" @update:model-value="value => locationRef = fromSelectValue(value) ?? ''">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Pick a location (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="SELECT_EMPTY">No location</SelectItem>
              <SelectGroup v-for="group in locationGroups" :key="group.name">
                <SelectLabel>{{ group.name }}</SelectLabel>
                <SelectItem v-for="loc in group.rows" :key="loc.id" :value="loc.id">{{ loc.name }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p v-if="selectedItem?.requiresLocation" class="text-xs text-muted-foreground">This item needs a location from the list.</p>
        </div>

        <div class="grid gap-3" :class="selectedItem?.itemQuantity && !repeat ? 'grid-cols-2' : 'grid-cols-1'">
          <div v-if="!repeat" class="space-y-2">
            <Label for="requester-name">Requester</Label>
            <Input
              id="requester-name"
              v-model="requesterName"
              placeholder="Guest or requester name"
              maxlength="120"
              class="min-h-11"
              @input="requesterTouched = true"
            />
            <p v-if="requesterAutofilled" class="text-xs text-muted-foreground">
              Filled in from the guest at this location. You can change it.
            </p>
          </div>
          <div v-if="selectedItem?.itemQuantity" class="space-y-2">
            <Label for="qty">Quantity</Label>
            <Input id="qty" v-model.number="quantity" type="number" min="1" inputmode="numeric" class="min-h-11" />
          </div>
        </div>

        <div class="space-y-2">
          <Label>Priority</Label>
          <div role="radiogroup" aria-label="Priority" class="grid grid-cols-4 gap-2">
            <button
              v-for="option in TASK_PRIORITIES"
              :key="option"
              type="button"
              role="radio"
              :aria-checked="priority === option"
              class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
              :class="priorityClass(option)"
              @click="pickPriority(option)"
            >
              <component :is="priorityIcon(option)" class="size-5" aria-hidden="true" />
              {{ priorityMeta(option).label }}
            </button>
          </div>
          <p v-if="!priorityTouched" class="text-xs text-muted-foreground">
            Follows the item's default until you pick one yourself.
          </p>
        </div>

        <div class="space-y-2">
          <Label>Assign to</Label>
          <div role="radiogroup" aria-label="Assign to" class="grid grid-cols-3 gap-2">
            <button
              v-for="option in ([['UNASSIGNED', 'Unassigned'], ['STAFF', caps.role.value === 'staff' ? 'Me' : 'Staff'], ['TEAM', 'Team']] as const)"
              :key="option[0]"
              type="button"
              role="radio"
              :aria-checked="assigneeKind === option[0]"
              class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
              :class="assigneeKind === option[0] ? 'border-primary/40 bg-primary-tint text-primary-tint-foreground' : 'border-border bg-card text-muted-foreground active:bg-accent'"
              @click="pickAssigneeKind(option[0])"
            >
              <component :is="ASSIGNEE_ICON[option[0]]" class="size-5" aria-hidden="true" />
              {{ option[1] }}
            </button>
          </div>
          <p v-if="assigneeKind === 'STAFF' && caps.role.value === 'staff'" class="text-xs text-muted-foreground">
            You can only assign a new task to yourself.
          </p>
          <StaffSelect
            v-if="assigneeKind === 'STAFF' && caps.role.value !== 'staff'"
            v-model="assigneeStaffId"
            placeholder="Choose a person"
            aria-label="Staff member to assign"
          />
          <template v-if="assigneeKind === 'TEAM'">
            <Alert v-if="teamsError" variant="destructive">
              <AlertTitle>Couldn't load teams</AlertTitle>
              <AlertDescription class="space-y-2">
                <p>{{ teamsError }}</p>
                <Button variant="secondary" @click="loadTeams">Retry</Button>
              </AlertDescription>
            </Alert>
            <Select v-else v-model="assigneeTeamId">
              <SelectTrigger class="w-full" aria-label="Team to assign">
                <SelectValue placeholder="Choose a team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="team in teams" :key="team.id" :value="team.id">
                  {{ team.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">The task waits in the team's pool until a member claims it.</p>
          </template>
        </div>

        <!-- Repeat: a schedule instead of a one-off start. Template content has
             no due date, activation date or requester, so those fold away. -->
        <div v-if="!projectId" class="space-y-3 rounded-lg border px-3 py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <Label for="repeat" class="flex items-center gap-1.5 text-sm font-semibold"><RepeatIcon class="h-3.5 w-3.5" /> Repeat</Label>
              <p class="text-xs text-muted-foreground">Make this task again on a schedule. The first one is created now.</p>
            </div>
            <Switch id="repeat" v-model="repeat" />
          </div>
          <template v-if="repeat">
            <Separator />
            <RecurrenceEditor v-model="recurrence" :timezone="tenant?.timezone" id-prefix="new-repeat" />
            <p class="text-xs text-muted-foreground">Manage or pause it later under Repeats on your profile.</p>
          </template>
        </div>

        <div v-if="!repeat" class="space-y-2">
          <button
            v-if="!showSchedule"
            type="button"
            class="min-h-11 rounded text-sm font-semibold text-primary-tint-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
            @click="showSchedule = true"
          >
            Schedule for later
          </button>
          <template v-else>
            <div class="flex items-center justify-between">
              <Label for="start-from">Start from</Label>
              <button type="button" class="min-h-8 rounded text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint" @click="showSchedule = false; activationDate = ''; dueAt = ''">
                Start now instead
              </button>
            </div>
            <Input id="start-from" v-model="activationDate" type="datetime-local" class="min-h-11" />
            <p class="text-xs text-muted-foreground">The deadlines count from the scheduled start, not from now.</p>
            <Label for="due-at">Due (optional)</Label>
            <Input id="due-at" v-model="dueAt" type="datetime-local" class="min-h-11" />
            <p class="text-xs text-muted-foreground">A hard due date on top of the deadlines — it can't be before the start.</p>
          </template>
        </div>

        <div class="space-y-2 rounded-lg border px-3 py-3">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold text-foreground">Extra checklist steps</p>
              <p class="text-xs text-muted-foreground">The item's own checklist is added automatically — list only what you're adding.</p>
            </div>
            <Button variant="secondary" type="button" @click="addChecklistStep">
              <PlusIcon class="h-4 w-4" /> Add
            </Button>
          </div>
          <div v-for="(step, index) in checklist" :key="index" class="flex items-center gap-2">
            <Input
              v-model="checklist[index]"
              :aria-label="`Checklist item ${index + 1}`"
              placeholder="Describe a step…"
              maxlength="100"
              class="min-h-11"
            />
            <Button
              size="icon"
              variant="ghost"
              type="button"
              class="shrink-0 text-muted-foreground hover:text-destructive"
              :aria-label="`Remove checklist item ${index + 1}`"
              @click="removeChecklistStep(index)"
            >
              <Trash2Icon class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="desc">Details</Label>
          <Textarea id="desc" v-model="description" rows="3" placeholder="Anything the team should know" class="resize-none" />
        </div>

        <!-- The live outcome: where this task will land, before it exists. It
             carries no assignment row and gives no green light on the assignee —
             only the resolution, and its errors. -->
        <Card aria-live="polite">
          <CardHeader class="pb-2">
            <CardTitle class="text-sm">Routing preview</CardTitle>
          </CardHeader>
          <CardContent class="text-sm">
            <p v-if="previewError" class="text-destructive">{{ previewError }}</p>
            <p v-else-if="previewLoading" class="text-muted-foreground">Resolving…</p>
            <template v-else-if="preview">
              <dl class="space-y-1.5">
                <div class="flex justify-between gap-2">
                  <dt class="text-muted-foreground">Priority</dt>
                  <dd class="font-medium">{{ priorityMeta(preview.task.priority).label }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-muted-foreground">Department</dt>
                  <dd class="font-medium">{{ departmentName ?? 'No department matched' }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-muted-foreground">Requester</dt>
                  <dd class="font-medium">{{ preview.task.requesterName ?? 'No guest matched' }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-muted-foreground">Pick up by</dt>
                  <dd class="font-medium tabular-nums">{{ formatAbsolute(preview.task.responseDueAt) }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-muted-foreground">Finish by</dt>
                  <dd class="font-medium tabular-nums">{{ formatAbsolute(preview.task.resolutionDueAt) }}</dd>
                </div>
                <!-- Preview-only: the API names the policy the task would get
                     (rule's, else SLA's, else the hotel default); absent when none. -->
                <div v-if="preview.task.escalationPolicyName" class="flex justify-between gap-2">
                  <dt class="shrink-0 text-muted-foreground">Escalates by</dt>
                  <dd class="text-right font-medium">{{ preview.task.escalationPolicyName }}</dd>
                </div>
                <div v-if="preview.checklistLabels.length" class="flex justify-between gap-2">
                  <dt class="shrink-0 text-muted-foreground">Checklist</dt>
                  <dd class="text-right font-medium">{{ preview.checklistLabels.join(', ') }}</dd>
                </div>
              </dl>
              <div v-if="previewWarnings.length" class="mt-2 space-y-1 rounded-lg bg-destructive/5 px-3 py-2">
                <p class="text-xs font-semibold uppercase tracking-wide text-destructive">Warnings</p>
                <ul class="list-disc pl-4 text-xs text-destructive">
                  <li v-for="warning in previewWarnings" :key="warning">{{ warning }}</li>
                </ul>
              </div>
            </template>
            <p v-else class="text-muted-foreground">Pick an item or enter a title to see how this task will be routed.</p>
          </CardContent>
        </Card>

        <Button type="submit" class="min-h-12 w-full" :disabled="!canSubmit">
          {{ isSubmitting ? 'Creating…' : repeat ? 'Create and repeat' : projectId ? 'Create in project' : 'Create task' }}
        </Button>
      </form>
    </template>
  </div>
</template>
