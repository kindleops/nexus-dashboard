# Current State - Nexus Dashboard

## System Status
- **Inbox Mode**: Live Supabase loading is **ENABLED** (`VITE_USE_SUPABASE_DATA=true`).
- **Primary Data Source**: Supabase Project `lcppdrmrdfblstpcbgpf`.
- **Latest Migration**: `20260508030000_inbox_truth_rebuild.sql`.

## Database Schema Status
- **Raw Tables**: `message_events` is the source of truth for all communications.
- **View Hierarchy**:
    1. `deduped_message_events`: Filters duplicate webhook deliveries.
    2. `nexus_inbox_threads_v`: Aggregates messages into threads and applies priority classification.
    3. `inbox_threads_hydrated`: Joins threads with `properties`, `master_owners`, and `prospects` for UI.
- **RLS**: Policies are active on `message_events` and `inbox_thread_state`.

## Environment
- **Development**: Local Vite server with `.env` pointing to Supabase.
- **Production**: Vercel Edge/Serverless functions.
