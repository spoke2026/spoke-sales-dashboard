// lib/supabase.js
// Uses direct fetch to Supabase REST API — avoids any client-side caching

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }
}

export async function getTargets(month) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/targets?month=eq.${month}&select=*`,
      { headers: sbHeaders(), cache: 'no-store' }
    )
    const data = await res.json()

    const repMap = {}
    for (const row of (data || [])) {
      repMap[row.rep] = {
        calls:    row.calls    || 0,
        visits:   row.visits   || 0,
        pipeline: row.pipeline || 0,
      }
    }

    if (!repMap.Ed)   repMap.Ed   = { calls: 0, visits: 0, pipeline: 0 }
    if (!repMap.Mark) repMap.Mark = { calls: 0, visits: 0, pipeline: 0 }

    repMap.total = {
      calls:    repMap.Ed.calls    + repMap.Mark.calls,
      visits:   repMap.Ed.visits   + repMap.Mark.visits,
      pipeline: repMap.Ed.pipeline + repMap.Mark.pipeline,
    }

    return repMap
  } catch (e) {
    console.error('getTargets error:', e)
    return {
      Ed:    { calls: 35, visits: 12, pipeline: 120000 },
      Mark:  { calls: 25, visits:  8, pipeline:  80000 },
      total: { calls: 60, visits: 20, pipeline: 200000 },
    }
  }
}

export async function saveTargets(month, rep, calls, visits, pipeline) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/targets?month=eq.${month}&rep=eq.${rep}`,
      {
        method: 'PATCH',
        headers: sbHeaders(),
        body: JSON.stringify({ calls, visits, pipeline, updated_at: new Date().toISOString() }),
      }
    )
    if (!res.ok) {
      // Row may not exist yet — try INSERT
      const ins = await fetch(
        `${SUPABASE_URL}/rest/v1/targets`,
        {
          method: 'POST',
          headers: sbHeaders(),
          body: JSON.stringify({ month, rep, calls, visits, pipeline }),
        }
      )
      return ins.ok
    }
    return true
  } catch (e) {
    console.error('saveTargets error:', e)
    return false
  }
}