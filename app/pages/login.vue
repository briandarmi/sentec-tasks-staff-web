<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { WandSparklesIcon } from '@lucide/vue'
import { demoLogins } from '~/utils/clientFakeApi'
import { useSession } from '~/composables/useSession'

definePageMeta({ layout: false })

const route = useRoute()
const session = useSession()

const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

/**
 * The frontline roles this workspace is built for. Everyone else — property
 * admins, the operator, a regional manager — can look at a queue too, so they
 * sit below a divider rather than mixed in.
 */
const FRONTLINE_ROLES = ['staff', 'leader']

type DemoLogin = ReturnType<typeof demoLogins>[number]

const demoGroups = ref<Array<{ key: string, logins: DemoLogin[] }>>([])
onMounted(() => {
  const logins = demoLogins()
  demoGroups.value = [
    { key: 'frontline', logins: logins.filter(d => FRONTLINE_ROLES.includes(d.role) && !d.isOperator) },
    { key: 'management', logins: logins.filter(d => !FRONTLINE_ROLES.includes(d.role) || d.isOperator) },
  ].filter(group => group.logins.length > 0)
})

function autofill(demoEmail: string, pass: string) {
  email.value = demoEmail
  password.value = pass
}

async function submit() {
  if (isSubmitting.value) return
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    const result = await session.login({ email: email.value, password: password.value })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    // Honour a deep link that bounced through the auth gate.
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await navigateTo(redirect)
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center bg-muted/40 p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center">
        <AppLogo class="mb-2 size-12 text-primary" />
        <CardTitle class="text-2xl tracking-tight">Sentec Tasks</CardTitle>
        <CardDescription>Sign in to pick up your work.</CardDescription>
      </CardHeader>

      <CardContent>
        <form class="space-y-5" @submit.prevent="submit">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model="email"
              type="email"
              class="w-full"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="you@property.example"
            />
          </div>

          <div class="space-y-2">
            <Label for="password">Password</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              class="w-full"
              autocomplete="current-password"
              placeholder="Enter password"
            />
          </div>

          <Alert v-if="errorMessage" variant="destructive">
            <AlertTitle>Couldn't sign in</AlertTitle>
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>

          <Button class="min-h-11 w-full" type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? 'Signing in…' : 'Sign In' }}
          </Button>
        </form>
      </CardContent>

      <CardFooter>
        <div class="w-full space-y-2 rounded-lg border bg-muted/50 p-3">
          <p class="text-xs font-semibold text-muted-foreground">Demo accounts</p>
          <template v-for="(group, groupIndex) in demoGroups" :key="group.key">
            <!-- Divider between the two groups only, never leading or trailing —
                 same shape as the console sidebar's group separators. -->
            <Separator v-if="groupIndex > 0" />
            <div class="grid grid-cols-2 gap-2">
              <Button
                v-for="demo in group.logins"
                :key="demo.email"
                type="button"
                variant="outline"
                size="sm"
                class="justify-start text-xs"
                @click="autofill(demo.email, demo.password)"
              >
                <WandSparklesIcon class="size-3" />
                <span class="truncate">{{ demo.name }}</span>
              </Button>
            </div>
          </template>
        </div>
      </CardFooter>
    </Card>
  </div>
</template>
