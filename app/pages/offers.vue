<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeftIcon, InboxIcon, RefreshCwIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { InboxOffer } from '~/utils/clientFakeApi'
import { displayName, relativeTime } from '~/utils/task-ui'

definePageMeta({ title: 'Offers' })

type OfferRow = InboxOffer

const router = useRouter()
const api = useTasksApi()

const offers = ref<OfferRow[]>([])
const isLoading = ref(false)
const loadError = ref('')
const actionError = ref('')
/** One id per action: any in-flight decision disables every row's buttons. */
const acceptingId = ref('')
const decliningId = ref('')

function fromName(offer: OfferRow) {
  return displayName(offer.fromStaffName)
}

async function load() {
  isLoading.value = true
  loadError.value = ''
  try {
    offers.value = await api.listOffers()
  }
  catch (e) {
    loadError.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

async function accept(offer: OfferRow) {
  if (acceptingId.value || decliningId.value) return
  acceptingId.value = offer.id
  actionError.value = ''
  try {
    await api.acceptOffer(offer.id)
    await router.push(`/tasks/${offer.taskId}`)
  }
  catch (e) {
    // A stale offer was cancelled server-side the moment we asked — reload the
    // inbox rather than dropping one row on a guess.
    actionError.value = (e as Error).message
    await load()
  }
  finally {
    acceptingId.value = ''
  }
}

async function decline(offer: OfferRow) {
  if (acceptingId.value || decliningId.value) return
  decliningId.value = offer.id
  actionError.value = ''
  try {
    await api.declineOffer(offer.id)
    // Declining changes nothing about the task: drop the row, no reload needed.
    offers.value = offers.value.filter(o => o.id !== offer.id)
  }
  catch (e) {
    actionError.value = (e as Error).message
    await load()
  }
  finally {
    decliningId.value = ''
  }
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

    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-lg font-bold tracking-tight">
          Offers<template v-if="offers.length"> ({{ offers.length }})</template>
        </h2>
        <p class="text-xs text-muted-foreground">Tasks colleagues want to hand to you. They move only if you accept.</p>
      </div>
      <Button size="icon" variant="ghost" :disabled="isLoading" aria-label="Refresh" @click="load">
        <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
      </Button>
    </div>

    <Alert v-if="loadError" variant="destructive">
      <AlertTitle>Could not load offers</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ loadError }}</p>
        <Button size="sm" variant="outline" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <Alert v-if="actionError" variant="destructive">
      <AlertTitle>That didn't work</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && offers.length === 0 && !loadError" class="space-y-3" aria-hidden="true">
      <Skeleton v-for="n in 3" :key="n" class="h-28 w-full rounded-xl" />
    </div>

    <EmptyState
      v-else-if="offers.length === 0 && !loadError"
      :icon="InboxIcon"
      title="No pending offers"
      description="When a colleague offers you a task, it lands here."
    />

    <div v-else class="space-y-3">
      <Card v-for="offer in offers" :key="offer.id">
        <CardContent class="space-y-2 pt-6">
          <NuxtLink :to="`/tasks/${offer.taskId}`" class="block text-sm font-semibold text-foreground underline-offset-2 active:text-primary">
            {{ offer.taskTitle }}
          </NuxtLink>
          <!-- One docket line: who, and how long it has been waiting on you. -->
          <p class="text-xs text-muted-foreground">From {{ fromName(offer) }} · {{ relativeTime(offer.createdAt) }}</p>
          <p v-if="offer.note" class="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">“{{ offer.note }}”</p>
          <div class="flex gap-2 pt-1">
            <Button
              class="min-h-11 flex-1"
              :disabled="Boolean(acceptingId || decliningId)"
              :aria-busy="acceptingId === offer.id"
              @click="accept(offer)"
            >
              {{ acceptingId === offer.id ? 'Accepting…' : 'Accept' }}
            </Button>
            <Button
              variant="outline"
              class="min-h-11 flex-1"
              :disabled="Boolean(acceptingId || decliningId)"
              :aria-busy="decliningId === offer.id"
              @click="decline(offer)"
            >
              {{ decliningId === offer.id ? 'Declining…' : 'Decline' }}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
