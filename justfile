set shell := ["zsh", "-eu", "-o", "pipefail", "-c"]

lint:
    node scripts/lint.mjs

test:
    node --test

ci: lint test

package: ci
    node scripts/package.mjs
