<script setup lang="ts">
import { ref, watch } from 'vue'
import { CheckIcon } from '@lucide/vue'
import type { BoardColumn } from '~/utils/clientFakeApi'
import { statusSignal } from '~/utils/task-signals'

const props = defineProps<{
  open: boolean
  columns: BoardColumn[]
  currentColumnId: string | null
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  'move': [{ columnId: string, description: string | null }]
}>()

const note = ref('')

// Start each move with an empty note; carrying the previous one over would
// silently attach the wrong explanation to the next transition.
watch(() => props.open, (isOpen) => {
  if (isOpen) note.value = ''
})

function choose(column: BoardColumn) {
  if (props.busy || column.id === props.currentColumnId) return
  emit('move', { columnId: column.id, description: note.value.trim() || null })
}
</script>

<template>
  <Drawer :open="open" @update:open="value => emit('update:open', value)">
    <DrawerContent>
      <DrawerHeader class="text-left">
        <DrawerTitle>Move task</DrawerTitle>
        <DrawerDescription>Pick the column to move this task to. The status follows the column.</DrawerDescription>
      </DrawerHeader>

      <div class="space-y-3 px-4 pb-2">
        <Textarea v-model="note" placeholder="Add a note (optional)" rows="2" class="resize-none" />

        <div class="space-y-2">
          <button
            v-for="column in columns"
            :key="column.id"
            type="button"
            :disabled="busy || column.id === currentColumnId"
            class="flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors disabled:opacity-60 enabled:active:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-tint"
            :class="column.id === currentColumnId ? 'border-primary/40 bg-primary-tint/60' : 'bg-card'"
            @click="choose(column)"
          >
            <!-- The same icon and tone the status pill wears, so the list
                 reads as "where it goes", not a palette. -->
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-full"
              :class="column.status ? statusSignal(column.status).chip : 'bg-neutral-tint text-neutral-tint-foreground'"
            >
              <component :is="column.status ? statusSignal(column.status).icon : undefined" v-if="column.status" class="size-4" aria-hidden="true" />
              <span v-else class="size-2.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-base font-semibold">{{ column.name }}</span>
              <span v-if="column.description" class="block truncate text-xs text-muted-foreground">{{ column.description }}</span>
            </span>
            <CheckIcon v-if="column.id === currentColumnId" class="size-5 shrink-0 text-primary" aria-hidden="true" />
          </button>
        </div>
      </div>

      <DrawerFooter>
        <DrawerClose as-child>
          <Button variant="secondary" class="w-full">Cancel</Button>
        </DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
</template>
