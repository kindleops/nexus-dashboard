-- Proof Queries for Inbox Thread State

-- 1. Count by inbox_bucket
SELECT metadata->>'inbox_bucket' as inbox_bucket, COUNT(*) 
FROM public.inbox_thread_state 
GROUP BY metadata->>'inbox_bucket'
ORDER BY count DESC;

-- 2. Count by current_status
SELECT status, COUNT(*) 
FROM public.inbox_thread_state 
GROUP BY status
ORDER BY count DESC;

-- 3. Count by current_stage
SELECT stage, COUNT(*) 
FROM public.inbox_thread_state 
GROUP BY stage
ORDER BY count DESC;

-- 4. Count by temperature
SELECT metadata->>'temperature' as temperature, COUNT(*) 
FROM public.inbox_thread_state 
GROUP BY metadata->>'temperature'
ORDER BY count DESC;

-- 5. Sample 25 threads for visual inspection
SELECT 
  thread_key, 
  status, 
  stage, 
  metadata->>'inbox_bucket' as bucket, 
  metadata->>'temperature' as temperature,
  last_intent,
  is_suppressed
FROM public.inbox_thread_state 
ORDER BY updated_at DESC
LIMIT 25;