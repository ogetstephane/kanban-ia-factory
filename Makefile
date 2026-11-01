.DEFAULT_GOAL := help
.PHONY: help install env setup dev storybook build-storybook test-storybook build start preview test test-agent-live lint check \
	db-generate db-migrate db-dev db-studio db-reset clean

NPM ?= npm
BUN ?= npx --yes bun
NODE_VERSION := $(shell node -p 'process.versions.node' 2>/dev/null)
# Vite 8 and the Copilot runtime require a modern Node; use Node 22 when the local one is older.
NODE_OK := $(shell printf '22.12.0\n$(NODE_VERSION)\n' | sort -V -C && echo ok)
ifeq ($(NODE_OK),ok)
vite_run = $(NPM) run $(1)
else
vite_run = npx --yes --package=node@22 -c '$(NPM) run $(1)'
endif

help: ## List available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies from bun.lock and generate the Prisma client
	$(BUN) install

env: ## Create .env from .env.example if it does not exist
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")

setup: install env db-migrate ## First-time setup: install, create .env, apply migrations

dev: ## Start the dev server with hot reload (http://localhost:3000)
	$(call vite_run,dev)

storybook: ## Start standalone Storybook with mock API data (http://localhost:6006)
	$(call vite_run,storybook)

build-storybook: ## Build the Storybook static site
	$(call vite_run,build-storybook)

test-storybook: ## Test standalone Storybook API mocks
	$(call vite_run,test:storybook)

build: ## Build the frontend into dist/
	$(call vite_run,build)

start: build ## Build, then serve the production app
	NODE_ENV=production $(call vite_run,start)

preview: ## Preview the built frontend only (no API or database)
	$(call vite_run,preview)

test: ## Run unit and database integration tests
	$(NPM) test

test-agent-live: ## Test real Copilot on disposable files (requires authentication; uses AI quota)
	$(call vite_run,test:agent:live)

lint: ## Type-check the project
	$(NPM) run lint

check: lint test build ## Run lint, tests, and build

db-generate: ## Regenerate the typed Prisma client
	$(NPM) run db:generate

db-migrate: ## Apply committed migrations
	$(NPM) run db:migrate

db-dev: ## Create and apply a migration: make db-dev NAME=add_due_date
	@test -n "$(NAME)" || (echo "Usage: make db-dev NAME=migration_name" && exit 1)
	$(NPM) run db:dev -- --name $(NAME)

db-studio: ## Open Prisma Studio to browse and edit entities
	$(NPM) run db:studio

db-reset: ## DESTRUCTIVE: drop the local database and re-apply all migrations
	npx prisma migrate reset --force --skip-seed

clean: ## Remove build output
	$(NPM) run clean
