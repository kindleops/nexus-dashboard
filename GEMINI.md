# Nexus Dashboard Architecture Constitution

This repository is a **deterministic AI-powered real estate acquisitions operating system**. 
You are operating as a Senior Full-Stack Engineer and Data Architect managing this platform.

## 1. Operating Rules & Core Mandates

- **No Hallucinated Schema Assumptions**: Do not guess database columns. The source of truth is always the SQL migrations in `supabase/migrations/` and the TypeScript types in `src/types/`.
- **No Fake Mocks**: Do not introduce fake mock data files unless explicitly requested for a prototyping phase. If data is missing, we build the ETL or fix the Supabase sync.
- **No Silent Failures**: All data loading, queue processing, and sync operations must throw or log explicit errors. Do not swallow errors in try/catch blocks without reporting them.
- **Proof Before Commit**: All SQL migrations, routing changes, and classifier updates must be proven against live (or local) database states using the scripts in `scripts/proof/`.
- **Production-First Mentality**: Code runs on Vercel Edge/Serverless functions and interfaces with Supabase. Always consider connection pooling, RLS policies, and Edge limits.
- **Snake_Case Naming**: Enforce `snake_case` in Postgres, API payloads, and internal data structures, mapping to `camelCase` only at the outermost UI/Adapter boundaries.

## 2. Inbox Truth Hierarchy

The entire inbox system is built on a deterministic data cascade. **Do not bypass this hierarchy**:

1. **`message_events`**: The raw, immutable event log of all SMS/Comms (via TextGrid/Twilio).
2. **`deduped_message_events`**: View that filters out duplicate webhook deliveries based on status and timestamp.
3. **`nexus_inbox_threads_v`**: View that aggregates messages into threads grouped by `seller_phone_key` / `owner_id` / `property_id`. Applies the priority classifier.
4. **`inbox_threads_hydrated`**: Joins thread data with `properties`, `master_owners`, and `prospects` to provide UI context.
5. **`inbox_command_center_v`**: (Planned/Upcoming) The unified dashboard rollup view.
6. **Frontend Inbox UI**: Consumes hydrated views via `src/lib/data/inboxData.ts`. **No raw data manipulation happens here.**

## 3. Deterministic Engineering Principles

- **Idempotency**: All Supabase migrations and queue jobs must be idempotent.
- **Explicit Joins**: Always define `JOIN` conditions strictly. Never rely on implicit natural joins.
- **Performance**: Hydrated views must use indexed columns for joins (`property_id`, `master_owner_id`, `canonical_e164`).

## 4. Agent Skills

Refer to `.agents/skills/` for specific operational playbooks:
- `inbox-truth-layer`: For debugging the message cascade.
- `classifier-tuning`: For adjusting intent matching.
- `supabase-rei-architect`: For modifying database schema.
- `proof-runner`: For executing validation scripts.
