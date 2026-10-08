<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FolderKanbanIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import type { AssignableStaff, Project, ProjectStatus } from '~/utils/clientFakeApi'
import { PROJECT_STATUSES, projectStatusMeta } from '~/utils/project-ui'

definePageMeta({ title: 'Projects' })

const route = useRoute()
const router = useRouter()
const api = useTasksApi()
const caps = useCaps()

/**
 * One status per call — GET /v1/projects?status= takes exactly one and is
 * not paginated. The chip lives in the URL so a filtered view survives a
 * refresh and the back button from a project page. Admins see every project
 * at the hotel; everyone else sees the ones they belong to.
 */
const status = computed<ProjectStatus>(() => {
  const value = String(route.query.status ?? 'ACTIVE').toUpperCase()
  return (PROJECT_STATUSES as string[]).includes(value) ? value as ProjectStatus : 'ACTIVE'
})

const projects = ref<Project[]>([])
const isLoading = ref(false)
const errorMessage = ref('')

function setStatus(next: ProjectStatus) {
  router.replace({ query: next === 'ACTIVE' ? {} : { status: next } })
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    projects.value = await api.listProjects(status.value)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

watch(status, load, { immediate: true })

const emptyCopy = computed(() => {
  const which = status.value === 'ACTIVE' ? 'active' : status.value === 'COMPLETED' ? 'completed' : 'cancelled'
  if (caps.isAdmin.value) return { title: `No ${which} projects`, description: `Nothing ${which} at this property. Leaders and admins can open one.` }
  if (caps.canCreateProject.value) return { title: `No ${which} projects`, description: `You are not on any ${which} project. Open one, or ask to be added.` }
  return { title: `No ${which} projects`, description: `You are not on any ${which} project. A leader adds you, or hands you one of its tasks.` }
})

// ── new project ──────────────────────────────────────────────────────────────

const createOpen = ref(false)
const isCreating = ref(false)
const createError = ref('')
const draftName = ref('')
const draftDescription = ref('')
const draftStart = ref('')
const draftEnd = ref('')
type Level = 'MEMBER' | 'VIEWER'
const draftMembers = ref<Array<{ staffId: string, name: string, level: Level }>>([])
const memberPick = ref('')
const memberLevel = ref<Level>('MEMBER')
const people = ref<AssignableStaff[]>([])
const peopleError = ref('')

const NAME_MAX = 120

const canCreate = computed(() => Boolean(draftName.value.trim()) && !isCreating.value && (!draftStart.value || !draftEnd.value || draftEnd.value >= draftStart.value))

function openCreate() {
  createOpen.value = true
  createError.value = ''
  draftName.value = ''
  draftDescription.value = ''
  draftStart.value = ''
  draftEnd.value = ''
  draftMembers.value = []
  memberPick.value = ''
  memberLevel.value = 'MEMBER'
  void loadPeople()
}

/** Anyone at the property may be a first member; the creator becomes manager. */
async function loadPeople() {
  peopleError.value = ''
  try {
    people.value = await api.listAssignableStaff(null, {})
  }
  catch (e) {
    people.value = []
    peopleError.value = (e as Error).message
  }
}

const pickable = computed(() => people.value.filter(p => !draftMembers.value.some(m => m.staffId === p.id)))

function addDraftMember() {
  const person = people.value.find(p => p.id === memberPick.value)
  if (!person) return
  draftMembers.value = [...draftMembers.value, { staffId: person.id, name: person.name, level: memberLevel.value }]
  memberPick.value = ''
}

function removeDraftMember(staffId: string) {
  draftMembers.value = draftMembers.value.filter(m => m.staffId !== staffId)
}

async function create() {
  if (!canCreate.value) return
  isCreating.value = true
  createError.value = ''
  try {
    const created = await api.createProject({
      name: draftName.value.trim(),
      description: draftDescription.value.trim() || null,
      startDate: draftStart.value || null,
      endDate: draftEnd.value || null,
      ...(draftMembers.value.length ? { members: draftMembers.value.map(m => ({ staffId: m.staffId, level: m.level })) } : {}),
    })
    createOpen.value = false
    await navigateTo(`/projects/${created.id}`)
  }
  catch (e) {
    // 409: the name is taken at this property — the message says so.
    createError.value = (e as Error).message
  }
  finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-xl font-bold tracking-tight">Projects</h2>
        <p class="text-sm text-muted-foreground">
          {{ caps.isAdmin.value ? 'Every project at this property.' : 'The projects you are part of.' }}
          Their tasks live here, not on the hotel board.
        </p>
      </div>
      <div class="flex items-center gap-1">
        <Button v-if="caps.canCreateProject.value" @click="openCreate">
          <PlusIcon class="h-4 w-4" /> New
        </Button>
        <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" @click="load">
          <RefreshCwIcon class="size-5" :class="isLoading ? 'animate-spin' : ''" />
        </Button>
      </div>
    </div>

    <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <FilterChip
        v-for="option in PROJECT_STATUSES"
        :key="option"
        :active="status === option"
        :aria-pressed="status === option"
        :icon="projectStatusMeta(option).icon"
        :label="projectStatusMeta(option).label"
        @click="setStatus(option)"
      />
    </div>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && projects.length === 0" class="space-y-3">
      <Skeleton v-for="n in 3" :key="n" class="h-40 w-full rounded-2xl" />
    </div>

    <EmptyState
      v-else-if="projects.length === 0"
      :icon="FolderKanbanIcon"
      :title="emptyCopy.title"
      :description="emptyCopy.description"
    >
      <Button v-if="caps.canCreateProject.value && status === 'ACTIVE'" @click="openCreate">
        <PlusIcon class="h-4 w-4" /> New project
      </Button>
    </EmptyState>

    <div v-else class="space-y-3">
      <ProjectCard v-for="project in projects" :key="project.id" :project="project" />
    </div>

    <Dialog v-model:open="createOpen">
      <DialogContent class="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>You become its manager. Members can be added now or later; anyone handed one of its tasks joins automatically.</DialogDescription>
        </DialogHeader>

        <Alert v-if="createError" variant="destructive">
          <AlertTitle>Couldn't create the project</AlertTitle>
          <AlertDescription>{{ createError }}</AlertDescription>
        </Alert>

        <form class="space-y-4" @submit.prevent="create">
          <div class="space-y-2">
            <Label for="project-name">Name</Label>
            <Input id="project-name" v-model="draftName" :maxlength="NAME_MAX" class="min-h-11" placeholder="e.g. Lobby refurbishment" required />
          </div>
          <div class="space-y-2">
            <Label for="project-description">Description (optional)</Label>
            <Textarea id="project-description" v-model="draftDescription" rows="3" class="resize-none" placeholder="What done looks like" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
              <Label for="project-start">Starts (optional)</Label>
              <Input id="project-start" v-model="draftStart" type="date" class="min-h-11" />
            </div>
            <div class="space-y-2">
              <Label for="project-end">Ends (optional)</Label>
              <Input id="project-end" v-model="draftEnd" type="date" class="min-h-11" />
            </div>
          </div>
          <p v-if="draftStart && draftEnd && draftEnd < draftStart" class="text-xs text-destructive">The end date is before the start date.</p>

          <div class="space-y-2 rounded-lg border px-3 py-3">
            <p class="text-sm font-semibold text-foreground">First members (optional)</p>
            <Alert v-if="peopleError" variant="destructive">
              <AlertTitle>Couldn't load the team</AlertTitle>
              <AlertDescription>{{ peopleError }}</AlertDescription>
            </Alert>
            <template v-else>
              <div class="flex items-end gap-2">
                <Select v-model="memberPick">
                  <SelectTrigger class="min-w-0 flex-1" aria-label="Person to add">
                    <SelectValue placeholder="Choose a person" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="person in pickable" :key="person.id" :value="person.id">
                      {{ person.name }}<span class="text-muted-foreground"> · {{ person.role }}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select v-model="memberLevel">
                  <SelectTrigger class="w-28 shrink-0" aria-label="Level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">Member</SelectItem>
                    <SelectItem value="VIEWER">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="secondary" :disabled="!memberPick" @click="addDraftMember">Add</Button>
              </div>
              <ul v-if="draftMembers.length" class="space-y-1">
                <li v-for="member in draftMembers" :key="member.staffId" class="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm">
                  <span class="min-w-0 flex-1 truncate font-medium">{{ member.name }}</span>
                  <Badge variant="secondary" class="text-xs">{{ member.level === 'MEMBER' ? 'Member' : 'Viewer' }}</Badge>
                  <Button type="button" size="icon" variant="ghost" class="size-11 text-muted-foreground hover:text-destructive" :aria-label="`Remove ${member.name}`" @click="removeDraftMember(member.staffId)">
                    <Trash2Icon class="h-4 w-4" />
                  </Button>
                </li>
              </ul>
              <p class="text-xs text-muted-foreground">Members work and comment on the project's tasks; viewers only look.</p>
            </template>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" :disabled="isCreating" @click="createOpen = false">Cancel</Button>
            <Button type="submit" class="min-h-11" :disabled="!canCreate" :aria-busy="isCreating">
              {{ isCreating ? 'Creating…' : 'Create project' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
