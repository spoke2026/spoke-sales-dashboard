// lib/targets.js
// Reads and writes the monthly targets table THROUGH the caller's authenticated
// Supabase server client, so RLS is exercised: authenticated users may SELECT,
// only the admin (public.is_admin()) may write. Never uses the anon key or a
// service-role key directly. Each function takes the authed client as its first
// argument.

export async function getTargets(supabase, month) {
  try {
    const { data, error } = await supabase
      .from('targets')
      .select('*')
      .eq('month', month)

    if (error) throw error

    const repMap = {}
    let salesBudget = 60000

    for (const row of (data || [])) {
      if (row.rep === 'team' && row.sales_budget) {
        salesBudget = row.sales_budget
      } else {
        repMap[row.rep] = {
          calls:    row.calls    || 0,
          visits:   row.visits   || 0,
          pipeline: row.pipeline || 0,
        }
      }
    }

    if (!repMap.Ed)   repMap.Ed   = { calls: 0, visits: 0, pipeline: 0 }
    if (!repMap.Mark) repMap.Mark = { calls: 0, visits: 0, pipeline: 0 }

    repMap.total = {
      calls:    repMap.Ed.calls    + repMap.Mark.calls,
      visits:   repMap.Ed.visits   + repMap.Mark.visits,
      pipeline: repMap.Ed.pipeline + repMap.Mark.pipeline,
    }

    repMap.salesBudget = salesBudget

    return repMap
  } catch (e) {
    console.error('getTargets error:', e)
    return {
      Ed:    { calls: 35, visits: 12, pipeline: 120000 },
      Mark:  { calls: 25, visits:  8, pipeline:  80000 },
      total: { calls: 60, visits: 20, pipeline: 200000 },
      salesBudget: 60000,
    }
  }
}

export async function saveTargets(supabase, month, rep, calls, visits, pipeline) {
  try {
    // Update first. The query builder does NOT error on zero rows affected, so
    // .select() the affected rows and branch to insert on an empty array — a
    // missing month/rep row would otherwise be silently skipped.
    const { data, error } = await supabase
      .from('targets')
      .update({ calls, visits, pipeline, updated_at: new Date().toISOString() })
      .eq('month', month)
      .eq('rep', rep)
      .select()

    if (error) throw error

    if (!data || data.length === 0) {
      // No existing row — insert it.
      const { error: insErr } = await supabase
        .from('targets')
        .insert({ month, rep, calls, visits, pipeline })
      if (insErr) throw insErr
    }

    return true
  } catch (e) {
    console.error('saveTargets error:', e)
    return false
  }
}

export async function saveSalesBudget(supabase, month, salesBudget) {
  try {
    const { data, error } = await supabase
      .from('targets')
      .update({ sales_budget: salesBudget, updated_at: new Date().toISOString() })
      .eq('month', month)
      .eq('rep', 'team')
      .select()

    if (error) throw error

    if (!data || data.length === 0) {
      const { error: insErr } = await supabase
        .from('targets')
        .insert({ month, rep: 'team', sales_budget: salesBudget })
      if (insErr) throw insErr
    }

    return true
  } catch (e) {
    console.error('saveSalesBudget error:', e)
    return false
  }
}
