#!/usr/bin/env node
/**
 * Verifies the hand-duplicated files are byte-identical with the sibling repo.
 *
 * Both apps deliberately ship their own copies (each repo builds and tests
 * standalone), so nothing structural enforces the "kept in step by hand" rule
 * in the README — this script does. In a standalone clone the sibling is
 * simply not there, and the check skips rather than fails.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sibling = resolve(root, '..', 'sentec-tasks-admin-web')

const SHARED = [
  'app/composables/useSession.ts',
  'app/composables/useTasksApi.ts',
  'app/composables/useCaps.ts',
  'app/composables/useTheme.ts',
  'app/plugins/session.client.ts',
  'app/utils/clientFakeApi.ts',
  'app/utils/task-ui.ts',
  'app/utils/select-empty.ts',
  'tests/mock-api.spec.ts',
  'tests/admin-config.spec.ts',
  'tests/staff-flows.spec.ts',
  'tests/task-ui.spec.ts',
  'tests/overview-compliance.spec.ts',
]

if (!existsSync(sibling)) {
  console.log(`check:shared skipped — sentec-tasks-admin-web is not checked out beside this repo (standalone clone).`)
  process.exit(0)
}

const drifted = []
for (const file of SHARED) {
  const ours = resolve(root, file)
  const theirs = resolve(sibling, file)
  if (!existsSync(ours) || !existsSync(theirs)) {
    drifted.push(`${file} (missing on one side)`)
    continue
  }
  if (!readFileSync(ours).equals(readFileSync(theirs))) drifted.push(file)
}

if (drifted.length) {
  console.error(`check:shared FAILED — ${drifted.length} duplicated file(s) differ from sentec-tasks-admin-web:`)
  for (const file of drifted) console.error(`  - ${file}`)
  console.error('A change to a shared file belongs in both apps in the same change.')
  process.exit(1)
}
console.log(`check:shared OK — ${SHARED.length} duplicated files are identical with sentec-tasks-admin-web.`)
