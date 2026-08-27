<script setup lang="ts">
import { ref, watch } from 'vue'
import { CheckIcon } from '@lucide/vue'
import type { BoardColumn } from '~/utils/clientFakeApi'
import { statusMeta } from '~/utils/task-ui'

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

        <div class="space-y-1.5">
          <button
            v-for="column in columns"
            :key="column.id"
            type="button"
            :disabled="busy || column.id === currentColumnId"
            class="flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm transition-colors disabled:opacity-60 enabled:active:bg-accent"
            :class="column.id === currentColumnId ? 'border-primary/40 bg-primary/5' : 'bg-card'"
            @click="choose(column)"
          >
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="statusMeta(column.status).dot" />
            <span class="min-w-0 flex-1">
              <span class="block font-medium">{{ column.name }}</span>
              <span v-if="column.description" class="block truncate text-xs text-muted-foreground">{{ column.description }}</span>
            </span>
            <CheckIcon v-if="column.id === currentColumnId" class="h-4 w-4 shrink-0 text-primary" />
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
