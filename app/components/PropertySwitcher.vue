<script setup lang="ts">
import { computed } from 'vue'
import { CheckIcon, UsersIcon } from '@lucide/vue'
import { useSession } from '~/composables/useSession'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const session = useSession()

const properties = computed(() => session.tenants.value)
const activeId = computed(() => session.tenantId.value)

function pick(id: string) {
  session.setTenantId(id)
  emit('update:open', false)
}
</script>

<template>
  <Drawer :open="props.open" @update:open="value => emit('update:open', value)">
    <DrawerContent>
      <DrawerHeader class="text-left">
        <DrawerTitle>Switch property</DrawerTitle>
        <DrawerDescription>Your board and task list follow the selected property.</DrawerDescription>
      </DrawerHeader>

      <div class="max-h-[60vh] space-y-1.5 overflow-y-auto px-4 pb-4">
        <button
          v-for="property in properties"
          :key="property.id"
          type="button"
          class="flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm active:bg-accent"
          :class="property.id === activeId ? 'border-primary/40 bg-primary/5' : 'bg-card'"
          @click="pick(property.id)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ property.name }}</span>
            <!-- Reach via a group grant is worth showing: it explains why a
                 property the user has no posting at is on this list at all. -->
            <span v-if="property.viaGroupGrant" class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <UsersIcon class="h-3 w-3" />
              via group access
            </span>
          </span>
          <CheckIcon v-if="property.id === activeId" class="h-4 w-4 shrink-0 text-primary" />
        </button>
      </div>
    </DrawerContent>
  </Drawer>
</template>
