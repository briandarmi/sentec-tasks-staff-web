<script setup lang="ts">
import { ref, watch } from 'vue'
import { InfoIcon, LinkIcon } from '@lucide/vue'

const props = defineProps<{
  open: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  'attach': [{ url: string }]
}>()

const url = ref('')

watch(() => props.open, (isOpen) => {
  if (isOpen) url.value = ''
})

function submit() {
  const value = url.value.trim()
  if (!value || props.busy) return
  emit('attach', { url: value })
}
</script>

<template>
  <Dialog :open="open" @update:open="value => emit('update:open', value)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Attach a file</DialogTitle>
        <DialogDescription>Link a file that is already hosted somewhere.</DialogDescription>
      </DialogHeader>

      <!--
        Deliberately not a file picker. The API accepts a URL to an
        already-hosted file and nothing else — there is no multipart, presigned
        or base64 path yet, pending a storage decision. Offering a browse button
        that then failed would be worse than saying so plainly, so this says so.
      -->
      <Alert>
        <InfoIcon />
        <AlertTitle>Photo upload isn't available yet</AlertTitle>
        <AlertDescription>
          Taking a photo straight from your phone needs file storage that isn't built yet. For now, paste a link to a file that's already online.
        </AlertDescription>
      </Alert>

      <form class="space-y-2" @submit.prevent="submit">
        <Label for="attach-url">File URL</Label>
        <div class="relative">
          <LinkIcon class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="attach-url"
            v-model="url"
            class="pl-9"
            type="url"
            inputmode="url"
            placeholder="https://…"
            autocomplete="off"
          />
        </div>
        <p class="text-xs text-muted-foreground">Images and PDFs are recognised automatically.</p>
      </form>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">Cancel</Button>
        <Button :disabled="busy || !url.trim()" @click="submit">
          {{ busy ? 'Attaching…' : 'Attach' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
