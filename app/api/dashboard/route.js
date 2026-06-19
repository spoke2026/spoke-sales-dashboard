// app/api/dashboard/route.js
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  getConnectedCalls,
  getMeetings,
  getSales,
  getPipeline,
  getDealAge,
} from '@/lib/hubspot'
import { getTargets } from '@/lib/supabase'

// Hardcoded owner IDs — avoids needing owners API scope
const REP_OWNER_IDS = {
  'ed':   ['27034621'],
  'mark': ['363522625'],
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const rep   = searchParams.get('rep')   || 'full-team'

    const [year, monthNum] = month.split('-').map(Number)
    const monthStart  = new Date(year, monthNum - 1, 1)
    const monthEnd    = new Date(year, monthNum, 0, 23, 59, 59)
    const daysInMonth = monthEnd.getDate()
    const now         = new Date()
    const daysGone    = now > monthEnd ? daysInMonth : now < monthStart ? 0 : now.getDate()

    // Get targets from Supabase (includes salesBudget)
    const targets = await getTargets(month)
    const salesBudget = targets.salesBudget || 60000

    // Determine which rep key to use for targets
    const repKey     = rep === 'ed' ? 'Ed' : rep === 'mark' ? 'Mark' : 'total'
    const repTargets = targets[repKey] || targets.total

    // Owner IDs for filtering — null means full team
    const ownerIds = rep !== 'full-team' ? (REP_OWNER_IDS[rep] || null) : null

    // Fetch all data in parallel
    const [calls, visits, sales, pipeline, dealAge] = await Promise.all([
      getConnectedCalls(monthStart, monthEnd, ownerIds),
      getMeetings(monthStart, monthEnd, ownerIds),
      getSales(monthStart, monthEnd, null),
      getPipeline(monthStart, monthEnd, ownerIds),
      getDealAge(monthStart, monthEnd, ownerIds),
    ])

    const response = {
      sales: {
        actual:          sales.total,
        budget:          salesBudget,
        dailyActuals:    sales.dailyActuals,
        byOwner:         sales.byOwner,
        lastMonthActual: 0,
      },
      calls: {
        actual:       calls.total,
        target:       repTargets.calls,
        dailyActuals: calls.dailyActuals,
        byOwner:      calls.byOwner,
        details:      calls.details || [],
        lastMonth:    0,
      },
      visits: {
        actual:       visits.total,
        target:       repTargets.visits,
        dailyActuals: visits.dailyActuals,
        byOwner:      visits.byOwner,
        lastMonth:    0,
      },
      pipeline: {
        actual:       pipeline.total,
        target:       repTargets.pipeline,
        dailyActuals: pipeline.dailyActuals,
        byOwner:      pipeline.byOwner,
        details:      pipeline.details || [],
        lastMonth:    0,
      },
      dealAge: {
        avgDays:      dealAge.avgDays,
        total:        dealAge.total,
        lastMonthAvg: 0,
        bands:        dealAge.bands,
        history:      dealAge.history,
      },
      targets: {
        Ed:   targets.Ed,
        Mark: targets.Mark,
      },
      meta: {
        month,
        rep,
        daysInMonth,
        daysGone,
        lastSynced: new Date().toLocaleTimeString('en-NZ', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Auckland',
        }),
      },
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data', detail: error.message },
      { status: 500 }
    )
  }
}
