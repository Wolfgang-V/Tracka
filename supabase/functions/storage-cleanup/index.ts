// Processes storage_cleanup_queue: admin_delete_user queues file paths
// there instead of touching Storage directly, since Storage deletes need
// the service role and a Postgres function can't reach that API. This is
// the piece that actually calls it — meant to run on its own pg_cron
// schedule, same pattern as send-reminders (see that function's
// MANUAL STEP block for how the schedule itself gets wired up).

import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'

  const { data: pending, error } = await supabase
    .from('storage_cleanup_queue')
    .select('id, bucket_id, path')
    .is('deleted_at', null)
    .limit(100)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!pending?.length) {
    return new Response(JSON.stringify({ processed: 0, failed: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (dryRun) {
    return new Response(JSON.stringify({ wouldProcess: pending.length, pending }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // storage.remove() operates on one bucket per call, so group first —
  // the queue isn't guaranteed to be single-bucket forever even if
  // progress-photos is the only one today.
  const byBucket = new Map<string, typeof pending>()
  for (const row of pending) {
    const list = byBucket.get(row.bucket_id) ?? []
    list.push(row)
    byBucket.set(row.bucket_id, list)
  }

  let processed = 0
  const succeededIds: (string | number)[] = []
  const failed: any[] = []

  for (const [bucketId, rows] of byBucket) {
    const { error: removeError } = await supabase.storage
      .from(bucketId)
      .remove(rows.map((row) => row.path))

    if (removeError) {
      failed.push({ bucket: bucketId, count: rows.length, message: removeError.message })
      continue
    }

    processed += rows.length
    succeededIds.push(...rows.map((row) => row.id))
  }

  if (succeededIds.length > 0) {
    const { error: updateError } = await supabase
      .from('storage_cleanup_queue')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', succeededIds)

    if (updateError) {
      // Files are already gone from Storage at this point — a failure
      // here just means these rows get re-attempted next run, which is
      // harmless: storage.remove() on an already-missing path doesn't error.
      failed.push({ stage: 'marking deleted_at', message: updateError.message })
    }
  }

  return new Response(JSON.stringify({ processed, failed }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
