<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowLeftIcon, LockIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useCaps } from '~/composables/useCaps'
import type { CatalogCategory, CatalogItem } from '~/utils/clientFakeApi'

definePageMeta({ title: 'New task' })

const router = useRouter()
const api = useTasksApi()
const caps = useCaps()

const categories = ref<CatalogCategory[]>([])
const items = ref<CatalogItem[]>([])
const isLoading = ref(false)
const isSubmitting = ref(false)
const errorMessage = ref('')

const itemId = ref('')
const title = ref('')
const location = ref('')
const quantity = ref(1)
const description = ref('')
const requestedFor = ref('')

const activeItems = computed(() => items.value.filter(item => item.isActive))
const selectedItem = computed(() => activeItems.value.find(item => item.id === itemId.value) ?? null)

/** Group the catalog by category so the picker is scannable, not one long list. */
const groups = computed(() =>
  categories.value
    .map(category => ({ category, items: activeItems.value.filter(item => item.categoryId === category.id) }))
    .filter(group => group.items.length > 0),
)

const canSubmit = computed(() => Boolean(title.value.trim()) && !isSubmitting.value)

// Prefill the title from the catalog item, but leave it editable — "Extra
// towels" is usually right, and when it is not the person typing knows better.
watch(selectedItem, (item) => {
  if (item && !title.value.trim()) title.value = item.name
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [cats, catalogItems] = await Promise.all([api.listCatalogCategories(), api.listCatalogItems()])
    categories.value = cats
    items.value = catalogItems
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
    const created = await api.createTask({
      itemId: itemId.value || null,
      title: title.value.trim(),
      location: location.value.trim() || null,
      description: description.value.trim() || null,
      requestedFor: requestedFor.value.trim() || null,
      quantity: selectedItem.value?.quantityEnabled ? quantity.value : null,
    })
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
      class="flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground active:text-foreground"
      @click="router.back()"
    >
      <ArrowLeftIcon class="h-4 w-4" /> Back
    </button>

    <EmptyState
      v-if="!caps.canCreateTask.value"
      :icon="LockIcon"
      title="Not permitted"
      description="Your role at this property can't raise tasks. Ask a team leader, or switch to a property where you can."
    />

    <template v-else>
      <div>
        <h2 class="text-lg font-bold tracking-tight">New task</h2>
        <p class="text-xs text-muted-foreground">Routing and SLA are applied automatically from the property's rules.</p>
      </div>

      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Couldn't create the task</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div v-if="isLoading" class="space-y-3">
        <Skeleton class="h-11 w-full rounded-lg" />
        <Skeleton class="h-11 w-full rounded-lg" />
        <Skeleton class="h-24 w-full rounded-lg" />
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <div class="space-y-2">
          <Label for="item">Catalog item</Label>
          <Select v-model="itemId">
            <SelectTrigger id="item" class="w-full">
              <SelectValue placeholder="Pick an item (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup v-for="group in groups" :key="group.category.id">
                <SelectLabel>{{ group.category.icon }} {{ group.category.name }}</SelectLabel>
                <SelectItem v-for="item in group.items" :key="item.id" :value="item.id">{{ item.name }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <!-- The catalog drives routing, so choosing an item is how a task
               reaches the right department. Free-form is allowed but lands on
               the fallback rule, and saying so beats a surprise later. -->
          <p class="text-xs text-muted-foreground">
            <template v-if="groups.length === 0">
              No catalog items at this property yet — the task will use the default routing.
            </template>
            <template v-else>
              Picking an item routes the task to the right department automatically.
            </template>
          </p>
        </div>

        <div class="space-y-2">
          <Label for="title">Title</Label>
          <Input id="title" v-model="title" placeholder="Short summary" maxlength="255" class="min-h-11" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <Label for="location">Location</Label>
            <Input id="location" v-model="location" placeholder="e.g. 1204" maxlength="80" class="min-h-11" />
          </div>
          <div v-if="selectedItem?.quantityEnabled" class="space-y-2">
            <Label for="qty">Quantity</Label>
            <Input id="qty" v-model.number="quantity" type="number" min="1" inputmode="numeric" class="min-h-11" />
          </div>
        </div>

        <div class="space-y-2">
          <Label for="requested-for">Requested for</Label>
          <Input id="requested-for" v-model="requestedFor" placeholder="Guest or requester name (optional)" maxlength="120" class="min-h-11" />
        </div>

        <div class="space-y-2">
          <Label for="desc">Details</Label>
          <Textarea id="desc" v-model="description" rows="3" placeholder="Anything the team should know" class="resize-none" />
        </div>

        <Button type="submit" class="min-h-11 w-full" :disabled="!canSubmit">
          {{ isSubmitting ? 'Creating…' : 'Create task' }}
        </Button>
      </form>
    </template>
  </div>
</template>
