<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useTasksApi, type StaffMember } from '~/composables/useTasksApi'

const props = defineProps<{
  modelValue: string
  /** User ids that must not be offered (the assignee, existing helpers, yourself…). */
  exclude?: string[]
  placeholder?: string
  ariaLabel?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const api = useTasksApi()
const members = ref<StaffMember[]>([])
const isLoading = ref(false)
const errorMessage = ref('')

const options = computed(() => {
  const excluded = new Set(props.exclude ?? [])
  return members.value.filter(member => !excluded.has(member.userId))
})

/**
 * A transient load failure must not leave the control with nothing to choose
 * and no way back — the sibling pickers all offer a Retry, so this one does.
 */
async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    members.value = await api.listStaff()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
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
    <Select
      v-else
      :model-value="modelValue"
      @update:model-value="value => emit('update:modelValue', String(value ?? ''))"
    >
      <SelectTrigger class="w-full" :aria-label="ariaLabel">
        <SelectValue :placeholder="isLoading ? 'Loading…' : placeholder ?? 'Choose a person'" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="member in options" :key="member.userId" :value="member.userId">
          {{ member.firstName }} {{ member.lastName }}
          <span class="text-muted-foreground"> · {{ member.position || member.role }}</span>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
