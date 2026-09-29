<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ListChecksIcon, MoreHorizontalIcon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { AssignableStaff, ChecklistItem, ProjectLevel, TaskDetail } from '~/utils/clientFakeApi'
import { checklistAccess, checklistProgress } from '~/utils/checklist-access'
import { displayName, formatDateTime } from '~/utils/task-ui'

/**
 * The task's checklist steps (feat/projects). `TaskDetail.checklist` is the
 * only read — there is no GET of its own — so every write here asks the
 * parent to refetch. Who may do what follows the API's rules, mirrored in
 * `checklistAccess` for what to SHOW; the server's message wins on any
 * disagreement, and all four routes 409 once the task is closed.
 */
const props = defineProps<{
  task: TaskDetail
  /** The viewer holds the task personally. */
  isAssignee: boolean
  /** The viewer is an active helper. */
  isHelper: boolean
  /** The viewer's level in the task's project, when it has one and it is known. */
  projectLevel: ProjectLevel | null
}>()

const emit = defineEmits<{ updated: [] }>()

const api = useTasksApi()
const session = useSession()

const items = computed(() => props.task.checklist ?? [])
const progress = computed(() => checklistProgress(items.value))
const access = computed(() => checklistAccess(props.task.status, {
  userId: session.userId.value,
  role: session.role.value,
  isAssignee: props.isAssignee,
  isHelper: props.isHelper,
  projectLevel: props.projectLevel,
}))
const readOnly = computed(() => !access.value.canEditAny(items.value))
/** Assigning a step needs a claimed task — the API 409s otherwise; said up front, still allowed. */
const isClaimed = computed(() => props.task.assignment?.kind === 'STAFF')

const errorMessage = ref('')
/** One in-flight write at a time, per the rest of the detail screen. */
const busyItemId = ref('')

// ── who did it ───────────────────────────────────────────────────────────────

/**
 * `doneBy` is an id. The detail carries names for the people around the task
 * — assignee, helpers, commenters, step assignees — so most ids resolve; an
 * unknown one is shown as done without a name rather than a made-up one.
 */
const nameById = computed(() => {
  const map = new Map<string, string>()
  const put = (id: string | null | undefined, name: string | null | undefined) => {
    if (id && name && !map.has(id)) map.set(id, name)
  }
  const a = props.task.assignment
  if (a?.kind === 'STAFF') put(a.staffId, a.staffName)
  for (const helper of props.task.collaborators ?? []) put(helper.staffId, helper.staffName)
  for (const comment of props.task.comments ?? []) put(comment.staffId, comment.staffName)
  for (const item of items.value) put(item.assignedStaffId, item.assignedStaffName)
  return map
})

function whoIs(id: string | null): string | null {
  if (!id) return null
  if (id === session.userId.value) return 'you'
  return nameById.value.get(id) ?? null
}

// ── tick ─────────────────────────────────────────────────────────────────────

async function toggle(item: ChecklistItem, isDone: boolean) {
  if (busyItemId.value || !access.value.canTick(item)) return
  busyItemId.value = item.id
  errorMessage.value = ''
  try {
    // No `note` key: absent keeps whatever is there (unticking keeps it too).
    await api.setChecklistDone({ taskId: props.task.id, itemId: item.id, isDone })
    emit('updated')
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    busyItemId.value = ''
  }
}

// ── step sheet: note, assignee, remove ───────────────────────────────────────

const openItem = ref<ChecklistItem | null>(null)
const noteDraft = ref('')
const assigneeDraft = ref('')
const stepError = ref('')
const stepBusy = ref<'' | 'note' | 'assign' | 'remove'>('')
const candidates = ref<AssignableStaff[]>([])
const candidatesError = ref('')

const NOTE_MAX = 2000

function openStep(item: ChecklistItem) {
  openItem.value = item
  noteDraft.value = item.note ?? ''
  assigneeDraft.value = item.assignedStaffId ?? ''
  stepError.value = ''
  if (access.value.canManage) void loadCandidates()
}

// The sheet shows a snapshot; after a refetch, point it at the fresh row so a
// saved note or assignee does not look like it was lost.
watch(items, (rows) => {
  if (!openItem.value) return
  openItem.value = rows.find(row => row.id === openItem.value!.id) ?? null
})

/**
 * Who a step may go to: the task's department (any member when it has none),
 * through the directory widened by `taskId` so the assignee — not only a
 * leader — may ask.
 */
async function loadCandidates() {
  candidatesError.value = ''
  try {
    candidates.value = await api.listAssignableStaff(props.task.hotelDepartmentId, { taskId: props.task.id })
  }
  catch (e) {
    candidates.value = []
    candidatesError.value = (e as Error).message
  }
}

const noteChanged = computed(() => (openItem.value?.note ?? '') !== noteDraft.value.trim())

async function saveNote() {
  const item = openItem.value
  if (!item || stepBusy.value) return
  stepBusy.value = 'note'
  stepError.value = ''
  try {
    const text = noteDraft.value.trim()
    // Empty → null clears; text keeps the done state as it is.
    await api.setChecklistDone({ taskId: props.task.id, itemId: item.id, isDone: item.isDone, note: text || null })
    emit('updated')
  }
  catch (e) {
    stepError.value = (e as Error).message
  }
  finally {
    stepBusy.value = ''
  }
}

async function assign(staffId: string | null) {
  const item = openItem.value
  if (!item || stepBusy.value) return
  stepBusy.value = 'assign'
  stepError.value = ''
  try {
    await api.assignChecklistStep(props.task.id, item.id, staffId)
    emit('updated')
  }
  catch (e) {
    stepError.value = (e as Error).message
  }
  finally {
    stepBusy.value = ''
  }
}

async function remove() {
  const item = openItem.value
  if (!item || stepBusy.value) return
  stepBusy.value = 'remove'
  stepError.value = ''
  try {
    await api.removeChecklistStep(props.task.id, item.id)
    openItem.value = null
    emit('updated')
  }
  catch (e) {
    stepError.value = (e as Error).message
  }
  finally {
    stepBusy.value = ''
  }
}

// ── add steps ────────────────────────────────────────────────────────────────

const addOpen = ref(false)
const addDraft = ref('')
const isAdding = ref(false)
const addError = ref('')

const LABEL_MAX = 200
const LABELS_MAX = 50

/** One step per line; blank lines dropped. */
const addLabels = computed(() => addDraft.value.split('\n').map(line => line.trim()).filter(Boolean))
const addProblem = computed(() => {
  if (addLabels.value.length > LABELS_MAX) return `At most ${LABELS_MAX} steps at a time.`
  if (addLabels.value.some(label => label.length > LABEL_MAX)) return `Each step is at most ${LABEL_MAX} characters.`
  return ''
})

async function addSteps() {
  if (!addLabels.value.length || addProblem.value || isAdding.value) return
  isAdding.value = true
  addError.value = ''
  try {
    await api.addChecklistSteps(props.task.id, addLabels.value)
    addDraft.value = ''
    addOpen.value = false
    emit('updated')
  }
  catch (e) {
    addError.value = (e as Error).message
  }
  finally {
    isAdding.value = false
  }
}
</script>

<template>
  <Card v-if="items.length || access.canManage">
    <CardHeader class="pb-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <CardTitle class="flex items-center gap-2 text-sm">
            <ListChecksIcon class="h-4 w-4" /> Checklist
            <span v-if="items.length" class="text-xs font-medium tabular-nums text-muted-foreground">{{ progress.done }} of {{ progress.total }} done</span>
          </CardTitle>
          <CardDescription class="text-xs">
            <template v-if="access.closed">The task is closed, so the steps are as they were left.</template>
            <template v-else-if="readOnly">You can see the steps; the assignee, a helper or a leader ticks them off.</template>
            <template v-else-if="!access.canManage">Tick off what you have done. Steps handed to you are yours to tick and annotate.</template>
            <template v-else>Tick steps off, hand one to a colleague, or add what the item's own list missed.</template>
          </CardDescription>
        </div>
        <Button v-if="access.canManage" size="sm" variant="outline" type="button" class="shrink-0" @click="addOpen = true">
          <PlusIcon class="h-4 w-4" /> Add
        </Button>
      </div>
    </CardHeader>
    <CardContent class="space-y-2">
      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>That didn't work</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <p v-if="items.length === 0" class="py-1 text-xs text-muted-foreground">No steps yet.</p>

      <ul v-else class="space-y-1">
        <li
          v-for="item in items"
          :key="item.id"
          class="flex items-start gap-3 rounded-lg px-1 py-1.5"
          :class="access.canTick(item) ? '' : 'opacity-90'"
        >
          <!-- The whole label is the hit area, not just the 20px box. -->
          <label class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3" :class="access.canTick(item) ? '' : 'cursor-default'">
            <Checkbox
              class="mt-0.5"
              :model-value="item.isDone"
              :disabled="!access.canTick(item) || busyItemId === item.id"
              :aria-label="`${item.isDone ? 'Untick' : 'Tick'} ${item.label}`"
              @update:model-value="value => toggle(item, value === true)"
            />
            <span class="min-w-0 flex-1">
              <span class="block text-sm leading-snug" :class="item.isDone ? 'text-muted-foreground line-through decoration-muted-foreground/60' : 'text-foreground'">{{ item.label }}</span>
              <!-- Meta line: who did it, who holds it, the note — only what is set. -->
              <span class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span v-if="item.isDone && item.doneAt">
                  Done<template v-if="whoIs(item.doneBy)"> by {{ whoIs(item.doneBy) }}</template> · {{ formatDateTime(item.doneAt) }}
                </span>
                <span v-if="item.assignedStaffId" class="font-medium" :class="item.assignedStaffId === session.userId.value ? 'text-primary' : ''">
                  {{ item.assignedStaffId === session.userId.value ? 'Yours' : displayName(item.assignedStaffName) }}
                </span>
              </span>
              <span v-if="item.note" class="mt-1 block rounded-md bg-muted/60 px-2 py-1 text-xs text-foreground/85">“{{ item.note }}”</span>
            </span>
          </label>
          <Button
            v-if="access.canTick(item)"
            size="icon"
            variant="ghost"
            type="button"
            class="mt-0.5 h-9 w-9 shrink-0 text-muted-foreground"
            :aria-label="`Options for ${item.label}`"
            @click="openStep(item)"
          >
            <MoreHorizontalIcon class="h-4 w-4" />
          </Button>
        </li>
      </ul>
    </CardContent>

    <!-- One step: annotate; and for those who manage, hand over or remove. -->
    <Drawer :open="openItem !== null" @update:open="value => { if (!value) openItem = null }">
      <DrawerContent>
        <DrawerHeader class="text-left">
          <DrawerTitle class="leading-snug">{{ openItem?.label }}</DrawerTitle>
          <DrawerDescription>
            <template v-if="openItem?.isDone">Done<template v-if="whoIs(openItem.doneBy)"> by {{ whoIs(openItem.doneBy) }}</template>.</template>
            <template v-else>Not done yet.</template>
          </DrawerDescription>
        </DrawerHeader>

        <div v-if="openItem" class="space-y-4 px-4 pb-2">
          <Alert v-if="stepError" variant="destructive">
            <AlertTitle>That didn't work</AlertTitle>
            <AlertDescription>{{ stepError }}</AlertDescription>
          </Alert>

          <div class="space-y-2">
            <Label for="step-note">Note</Label>
            <Textarea id="step-note" v-model="noteDraft" rows="3" :maxlength="NOTE_MAX" class="resize-none" placeholder="What was found, what is left…" />
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] tabular-nums text-muted-foreground">{{ noteDraft.length }} / {{ NOTE_MAX }}</span>
              <Button size="sm" :disabled="!noteChanged || Boolean(stepBusy)" :aria-busy="stepBusy === 'note'" @click="saveNote">
                {{ stepBusy === 'note' ? 'Saving…' : noteDraft.trim() ? 'Save note' : 'Clear note' }}
              </Button>
            </div>
          </div>

          <template v-if="access.canManage">
            <Separator />
            <div class="space-y-2">
              <Label for="step-assignee">Handed to</Label>
              <p v-if="!isClaimed" class="text-xs text-muted-foreground">A step can be handed over once someone has claimed the task.</p>
              <Alert v-if="candidatesError" variant="destructive">
                <AlertTitle>Couldn't load the team</AlertTitle>
                <AlertDescription>{{ candidatesError }}</AlertDescription>
              </Alert>
              <div v-else class="flex items-end gap-2">
                <Select :model-value="toSelectValue(assigneeDraft)" @update:model-value="value => assigneeDraft = fromSelectValue(value)">
                  <SelectTrigger id="step-assignee" class="min-w-0 flex-1" aria-label="Who this step is handed to">
                    <SelectValue placeholder="Nobody" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="SELECT_EMPTY">Nobody</SelectItem>
                    <SelectItem v-for="person in candidates" :key="person.id" :value="person.id">
                      {{ person.name }}<span class="text-muted-foreground"> · {{ person.role }}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  :disabled="Boolean(stepBusy) || assigneeDraft === (openItem.assignedStaffId ?? '')"
                  :aria-busy="stepBusy === 'assign'"
                  @click="assign(assigneeDraft || null)"
                >
                  {{ stepBusy === 'assign' ? 'Saving…' : assigneeDraft ? 'Hand over' : 'Unassign' }}
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ task.department ? `Someone in ${task.department.name}.` : 'Anyone at this property.' }} They get read-only access to the task and become a project member if it is in one.
              </p>
            </div>

            <Separator />
            <Button variant="outline" class="min-h-11 w-full text-destructive" :disabled="Boolean(stepBusy)" :aria-busy="stepBusy === 'remove'" @click="remove">
              {{ stepBusy === 'remove' ? 'Removing…' : 'Remove this step' }}
            </Button>
          </template>
        </div>

        <DrawerFooter>
          <DrawerClose as-child>
            <Button variant="ghost" class="w-full">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>

    <!-- Add steps: one per line, appended after the existing ones. -->
    <Dialog v-model:open="addOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add steps</DialogTitle>
          <DialogDescription>One step per line. They are added after the existing ones; the task does not need to be claimed.</DialogDescription>
        </DialogHeader>

        <Alert v-if="addError" variant="destructive">
          <AlertTitle>Couldn't add the steps</AlertTitle>
          <AlertDescription>{{ addError }}</AlertDescription>
        </Alert>

        <div class="space-y-2">
          <Label for="add-steps">Steps</Label>
          <Textarea id="add-steps" v-model="addDraft" rows="5" class="resize-none" placeholder="Check the seals&#10;Replace the filter&#10;Log the reading" />
          <p class="text-xs" :class="addProblem ? 'text-destructive' : 'text-muted-foreground'">
            {{ addProblem || `${addLabels.length} ${addLabels.length === 1 ? 'step' : 'steps'} · up to ${LABELS_MAX} at a time, ${LABEL_MAX} characters each` }}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isAdding" @click="addOpen = false">Cancel</Button>
          <Button :disabled="!addLabels.length || Boolean(addProblem) || isAdding" :aria-busy="isAdding" @click="addSteps">
            {{ isAdding ? 'Adding…' : 'Add steps' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>
