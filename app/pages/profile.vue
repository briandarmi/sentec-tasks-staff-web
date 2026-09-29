<script setup lang="ts">
import { computed } from 'vue'
import { CheckIcon, Building2Icon, ChevronRightIcon, ClockIcon, LogOutIcon, RepeatIcon } from '@lucide/vue'
import { useSession } from '~/composables/useSession'
import { useCaps } from '~/composables/useCaps'
import { useTenant } from '~/composables/useTenant'

definePageMeta({ title: 'Profile' })

const session = useSession()
const caps = useCaps()
/** The hotel's zone — every clock time in the app is shown in it (GET /v1/tenant). */
const { tenant } = useTenant()

const name = computed(() => session.displayName.value || 'Signed in')
const initials = computed(() =>
  name.value.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase(),
)
const properties = computed(() => session.hotels.value)

async function logout() {
  await session.logout()
  await navigateTo('/login')
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center gap-3">
      <Avatar class="h-14 w-14">
        <AvatarFallback class="bg-primary/10 text-lg font-bold text-primary">{{ initials }}</AvatarFallback>
      </Avatar>
      <div class="min-w-0">
        <p class="truncate text-lg font-bold leading-tight">{{ name }}</p>
        <p class="truncate text-sm text-muted-foreground">{{ session.email.value }}</p>
        <div class="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" class="text-[10px]">{{ caps.roleLabel.value }}</Badge>
          <Badge v-if="caps.canAssign.value" variant="outline" class="text-[10px]">Can assign</Badge>
        </div>
      </div>
    </div>

    <Card>
      <CardHeader class="pb-2">
        <CardTitle class="flex items-center gap-2 text-sm">
          <Building2Icon class="h-4 w-4" /> Your properties
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-1.5">
        <button
          v-for="property in properties"
          :key="property.id"
          type="button"
          class="flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="property.id === session.hotelId.value ? 'border-primary/40 bg-primary/5' : 'bg-card'"
          @click="session.setHotelId(property.id)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ property.name }}</span>
          </span>
          <CheckIcon v-if="property.id === session.hotelId.value" class="h-4 w-4 shrink-0 text-primary" />
        </button>
        <p v-if="properties.length === 0" class="px-1 py-2 text-sm text-muted-foreground">No property assignments.</p>
        <!-- Said once, here: a phone left on another zone still reads the corridor clock. -->
        <p v-if="tenant?.timezone" class="flex items-center gap-1.5 px-1 pt-1 text-xs text-muted-foreground">
          <ClockIcon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Times are shown in {{ tenant.timezone }}.
        </p>
      </CardContent>
    </Card>

    <NuxtLink
      v-if="caps.canCreateTask.value"
      to="/recurring"
      class="flex min-h-11 items-center gap-3 rounded-xl border bg-card px-3.5 py-3 transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RepeatIcon class="h-4 w-4 shrink-0 text-primary" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium">Repeats</span>
        <span class="block text-xs text-muted-foreground">Tasks you set to repeat on a schedule.</span>
      </span>
      <ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </NuxtLink>

    <Card>
      <CardContent class="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div>
          <p class="text-sm font-medium">Appearance</p>
          <p class="text-xs text-muted-foreground">Follow your device, or pin light or dark.</p>
        </div>
        <ThemeModeSelect />
      </CardContent>
    </Card>

    <div class="space-y-2">
      <Button variant="outline" class="min-h-11 w-full text-destructive" @click="logout">
        <LogOutIcon class="h-4 w-4" /> Sign out
      </Button>
      <!-- Signing out clears the selected property too. That is deliberate on a
           shared device, and surprising enough to warrant saying. -->
      <p class="px-1 text-center text-xs text-muted-foreground">
        Signing out clears everything on this device, including your property choice.
      </p>
    </div>
  </div>
</template>
