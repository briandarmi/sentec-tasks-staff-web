<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArchiveIcon, ArrowLeftIcon, PauseIcon, PencilIcon, PlayIcon, RefreshCwIcon, RepeatIcon, TriangleAlertIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import { useTenant } from '~/composables/useTenant'
import type { TaskPriority, TaskTemplate, TaskTemplateContent, TaskTemplateRecurrence } from '~/utils/clientFakeApi'
import { draftToRecurrence, recurrenceSummary, recurrenceToDraft, recurrenceWindowLabel } from '~/utils/recurrence'
import type { RecurrenceDraft } from '~/utils/recurrence'
import { TASK_PRIORITIES, formatDateTime, priorityMeta, taskRef } from '~/utils/task-ui'

definePageMeta({ title: 'Repeats' })

const router = useRouter()
const api = useTasksApi()
const caps = useCaps()
const { tenant } = useTenant()

/**
 * The caller's own recurring tasks — GET /v1/recurring-tasks lists the
 * personal templates they own, active and paused. The worker makes the tasks
 * in the background; when it cannot (the owner lost access or the create-task
 * permission) it pauses the template and fills `lastError`, which is the one
 * thing this screen must never hide.
 */
const templates = ref<TaskTemplate[]>([])
const isLoading = ref(false)
const errorMessage = ref('')
const busyId = ref('')

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    templates.value = await api.listRecurringTasks()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

/** PUT is a full replace: the current content and schedule ride along with the flipped flag. */
async function setActive(template: TaskTemplate, isActive: boolean) {
  if (busyId.value || !template.recurrence) return
  busyId.value = template.id
  errorMessage.value = ''
  try {
    const saved = await api.updateRecurringTask(template.id, { isActive, content: template.content, recurrence: template.recurrence })
    templates.value = templates.value.map(t => (t.id === saved.id ? saved : t))
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    busyId.value = ''
  }
}

// ── archive ──────────────────────────────────────────────────────────────────

const archiving = ref<TaskTemplate | null>(null)
const archiveOpen = computed({ get: () => archiving.value !== null, set: (open: boolean) => { if (!open) archiving.value = null } })

async function archive() {
  const template = archiving.value
  if (!template || busyId.value) return
  archiving.value = null
  busyId.value = template.id
  errorMessage.value = ''
  try {
    await api.archiveRecurringTask(template.id)
    templates.value = templates.value.filter(t => t.id !== template.id)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    busyId.value = ''
  }
}

// ── edit ─────────────────────────────────────────────────────────────────────

const editing = ref<TaskTemplate | null>(null)
const editOpen = computed({ get: () => editing.value !== null, set: (open: boolean) => { if (!open) editing.value = null } })
const editError = ref('')
const isSaving = ref(false)
const editTitle = ref('')
const editDescription = ref('')
const editRoom = ref('')
const editPriority = ref<TaskPriority | ''>('')
const editQuantity = ref<number | undefined>(undefined)
const editChecklist = ref('')
const editRecurrence = ref<RecurrenceDraft>(recurrenceToDraft(null))

function openEdit(template: TaskTemplate) {
  editing.value = template
  editError.value = ''
  editTitle.value = template.content.title
  editDescription.value = template.content.description ?? ''
  editRoom.value = template.content.roomNumber ?? ''
  editPriority.value = template.content.priority ?? ''
  editQuantity.value = template.content.quantity ?? undefined
  editChecklist.value = template.content.checklistLabels.join('\n')
  editRecurrence.value = recurrenceToDraft(template.recurrence)
}

const editRecurrenceResult = computed(() => draftToRecurrence(editRecurrence.value))
const canSaveEdit = computed(() => Boolean(editTitle.value.trim()) && editRecurrenceResult.value.ok && !isSaving.value)

function assigneeLabel(content: TaskTemplateContent) {
  const a = content.assignee
  if (!a || a.assigneeKind === 'UNASSIGNED') return 'Unassigned'
  if (a.assigneeKind === 'TEAM') return 'A team'
  return 'You'
}

async function saveEdit() {
  const template = editing.value
  if (!template || !canSaveEdit.value || !editRecurrenceResult.value.ok) return
  isSaving.value = true
  editError.value = ''
  try {
    // Item, location and assignee are kept as they were: the form edits the
    // text and the schedule; the rest is what the template was made with.
    const content: TaskTemplateContent = {
      ...template.content,
      title: editTitle.value.trim(),
      description: editDescription.value.trim() || null,
      roomNumber: template.content.locationRef ? template.content.roomNumber ?? null : editRoom.value.trim() || null,
      priority: editPriority.value || null,
      quantity: typeof editQuantity.value === 'number' && editQuantity.value > 0 ? Math.trunc(editQuantity.value) : null,
      checklistLabels: editChecklist.value.split('\n').map(line => line.trim()).filter(Boolean),
    }
    const recurrence: TaskTemplateRecurrence = editRecurrenceResult.value.recurrence
    const saved = await api.updateRecurringTask(template.id, { isActive: template.isActive, content, recurrence })
    templates.value = templates.value.map(t => (t.id === saved.id ? saved : t))
    editing.value = null
  }
  catch (e) {
    editError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
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

    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-xl font-bold tracking-tight">Repeats</h2>
        <p class="text-sm text-muted-foreground">
          Tasks you set to repeat. Each run makes a fresh task on the schedule{{ tenant?.timezone ? `, in ${tenant.timezone} time` : '' }}.
        </p>
      </div>
      <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" @click="load">
        <RefreshCwIcon class="size-5" :class="isLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && templates.length === 0" class="space-y-3">
      <Skeleton v-for="n in 2" :key="n" class="h-36 w-full rounded-xl" />
    </div>

    <EmptyState
      v-else-if="templates.length === 0"
      :icon="RepeatIcon"
      title="Nothing repeats yet"
      :description="caps.canCreateTask.value ? 'Turn on Repeat when raising a task and it shows up here.' : 'Repeating tasks need the create-task permission at this property.'"
    >
      <Button v-if="caps.canCreateTask.value" @click="navigateTo('/tasks/new')">New task</Button>
    </EmptyState>

    <div v-else class="space-y-3">
      <Card v-for="template in templates" :key="template.id" :class="template.isActive ? '' : 'opacity-90'">
        <CardHeader class="gap-1.5 pb-2">
          <div class="flex items-start justify-between gap-2">
            <CardTitle class="text-base leading-snug">{{ template.name }}</CardTitle>
            <Badge :variant="template.isActive ? 'secondary' : 'outline'" class="shrink-0 text-xs">{{ template.isActive ? 'Active' : 'Paused' }}</Badge>
          </div>
          <p class="flex items-center gap-1.5 text-sm font-medium text-foreground/85">
            <RepeatIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {{ recurrenceSummary(template.recurrence) }}
          </p>
          <p v-if="recurrenceWindowLabel(template.recurrence)" class="text-xs text-muted-foreground">{{ recurrenceWindowLabel(template.recurrence) }}</p>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <!-- The worker paused it and said why. This is the one line that must not be missed. -->
          <Alert v-if="template.lastError" variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Paused by the scheduler</AlertTitle>
            <AlertDescription>{{ template.lastError }} Fix the cause, then resume.</AlertDescription>
          </Alert>

          <dl class="space-y-1.5">
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Next run</dt>
              <dd class="font-medium tabular-nums">{{ template.isActive && template.nextRunAt ? formatDateTime(template.nextRunAt) : '—' }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Last run</dt>
              <dd class="font-medium tabular-nums">
                <template v-if="template.lastRunAt">
                  {{ formatDateTime(template.lastRunAt) }}
                  <NuxtLink v-if="template.lastTaskId" :to="`/tasks/${template.lastTaskId}`" class="ml-1 text-primary underline-offset-2 hover:underline">{{ taskRef(template.lastTaskId) }}</NuxtLink>
                </template>
                <template v-else>Not yet</template>
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-muted-foreground">Assigned to</dt>
              <dd class="font-medium">{{ assigneeLabel(template.content) }}</dd>
            </div>
            <div v-if="template.content.checklistLabels.length" class="flex justify-between gap-2">
              <dt class="shrink-0 text-muted-foreground">Checklist</dt>
              <dd class="text-right font-medium">{{ template.content.checklistLabels.join(', ') }}</dd>
            </div>
          </dl>

          <div class="flex flex-wrap gap-2">
            <Button
              v-if="template.recurrence"
              variant="secondary"
              class="min-h-11 flex-1"
              :disabled="Boolean(busyId)"
              :aria-busy="busyId === template.id"
              @click="setActive(template, !template.isActive)"
            >
              <component :is="template.isActive ? PauseIcon : PlayIcon" class="h-4 w-4" />
              {{ template.isActive ? 'Pause' : 'Resume' }}
            </Button>
            <Button variant="secondary" class="min-h-11 flex-1" :disabled="Boolean(busyId)" @click="openEdit(template)">
              <PencilIcon class="h-4 w-4" /> Edit
            </Button>
            <Button variant="ghost" class="min-h-11 text-muted-foreground hover:text-destructive" :disabled="Boolean(busyId)" :aria-label="`Archive ${template.name}`" @click="archiving = template">
              <ArchiveIcon class="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <AlertDialog v-model:open="archiveOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop repeating “{{ archiving?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>No more tasks will be made from it. Tasks it already made stay as they are.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction @click="archive">Stop repeating</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog v-model:open="editOpen">
      <DialogContent class="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit repeat</DialogTitle>
          <DialogDescription>Changes apply from the next run. The item, location and assignee stay as they were set.</DialogDescription>
        </DialogHeader>

        <Alert v-if="editError" variant="destructive">
          <AlertTitle>Couldn't save</AlertTitle>
          <AlertDescription>{{ editError }}</AlertDescription>
        </Alert>

        <form v-if="editing" class="space-y-4" @submit.prevent="saveEdit">
          <div class="space-y-2">
            <Label for="rt-title">Title</Label>
            <Input id="rt-title" v-model="editTitle" maxlength="255" class="min-h-11" required />
          </div>
          <div v-if="!editing.content.locationRef" class="space-y-2">
            <Label for="rt-room">Location</Label>
            <Input id="rt-room" v-model="editRoom" maxlength="80" class="min-h-11" placeholder="e.g. Floor 11" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
              <Label for="rt-qty">Quantity</Label>
              <Input id="rt-qty" v-model.number="editQuantity" type="number" min="1" inputmode="numeric" class="min-h-11" placeholder="—" />
            </div>
          </div>
          <div class="space-y-2">
            <Label>Priority</Label>
            <div role="radiogroup" aria-label="Priority" class="grid grid-cols-4 gap-1.5">
              <button
                v-for="option in TASK_PRIORITIES"
                :key="option"
                type="button"
                role="radio"
                :aria-checked="editPriority === option"
                class="min-h-11 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
                :class="editPriority === option ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground active:bg-accent'"
                @click="editPriority = editPriority === option ? '' : option"
              >
                {{ priorityMeta(option).label }}
              </button>
            </div>
            <p v-if="!editPriority" class="text-xs text-muted-foreground">None picked — each run follows the item's default.</p>
          </div>
          <div class="space-y-2">
            <Label for="rt-checklist">Checklist steps (one per line)</Label>
            <Textarea id="rt-checklist" v-model="editChecklist" rows="3" class="resize-none" />
          </div>
          <div class="space-y-2">
            <Label for="rt-desc">Details</Label>
            <Textarea id="rt-desc" v-model="editDescription" rows="3" class="resize-none" />
          </div>

          <Separator />
          <RecurrenceEditor v-model="editRecurrence" :timezone="tenant?.timezone" id-prefix="rt" />

          <DialogFooter>
            <Button type="button" variant="secondary" :disabled="isSaving" @click="editing = null">Cancel</Button>
            <Button type="submit" class="min-h-11" :disabled="!canSaveEdit" :aria-busy="isSaving">{{ isSaving ? 'Saving…' : 'Save' }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
