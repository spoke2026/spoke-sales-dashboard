// lib/supabase.js
// Supabase client for reading and writing monthly targets
import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── GET TARGETS FOR A MONTH ───────────────────────────────────────────────────
// Returns { Ed: { calls, visits, pipeline }, Mark: { calls, visits, pipeline } }
// and computed team totals
export async function getTargets(month) {
  const { data, error } = await supabase
    .from('targets')
    .select('*')
    .eq('month', month)

  if (error) {
    console.error('Supabase getTargets error:', error)
    return defaultTargets(month)
  }

  // Build rep map
  const repMap = {}
  for (const row of (data || [])) {
    repMap[row.rep] = {
      calls:    row.calls    || 0,
      visits:   row.visits   || 0,
      pipeline: row.pipeline || 0,
    }
  }

  // Ensure Ed and Mark always exist
  if (!repMap.Ed)   repMap.Ed   = { calls: 0, visits: 0, pipeline: 0 }
  if (!repMap.Mark) repMap.Mark = { calls: 0, visits: 0, pipeline: 0 }

  // Team total = Ed + Mark combined
  repMap.total = {
    calls:    repMap.Ed.calls    + repMap.Mark.calls,
    visits:   repMap.Ed.visits   + repMap.Mark.visits,
    pipeline: repMap.Ed.pipeline + repMap.Mark.pipeline,
  }

  return repMap
}

// ── SAVE TARGETS FOR A MONTH / REP ───────────────────────────────────────────
export async function saveTargets(month, rep, calls, visits, pipeline) {
  const { data, error } = await supabase
    .from('targets')
    .upsert(
      { month, rep, calls, visits, pipeline, updated_at: new Date().toISOString() },
      { onConflict: 'month,rep' }
    )

  if (error) {
    console.error('Supabase saveTargets error:', error)
    return false
  }
  return true
}

// ── DEFAULTS (fallback if Supabase unavailable) ───────────────────────────────
function defaultTargets(month) {
  return {
    Ed:    { calls: 35, visits: 12, pipeline: 120000 },
    Mark:  { calls: 25, visits:  8, pipeline:  80000 },
    total: { calls: 60, visits: 20, pipeline: 200000 },
  }
}
