// app/api/dashboard/route.js
// GET /api/dashboard?month=2026-05&rep=full-team
//
// This runs on the server only. The HubSpot API key is never sent to the browser.

import { NextResponse } from 'next/server'
import {
  getOwners,
  getConnectedCalls,
  getMeetings,
  getSales,
  getPipeline,
  getDealAge,
} from '@/lib/hubspot'

// Monthly sales budgets — move to Supabase later for admin editing
const BUDGETS = {
  sales: 150000,
  calls: 60,
  visits: 20,
  pipeline: 200000,
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7)
    const rep = searchParams.get('rep') || 'full-team'

    // Parse month into date range
    const [year, monthNum] = month.split('-').map(Number)
    const monthStart = new Date(year, monthNum - 1, 1)
    const monthEnd = new Date(year, monthNum, 0, 23, 59, 59)
    const daysInMonth = monthEnd.getDate()
    const now = new Date()
    const daysGone = now > monthEnd
      ? daysInMonth
      : now < monthStart
        ? 0
        : now.getDate()

    // Filter by rep if needed
    let ownerIds = null
    if (rep !== 'full-team') {
      const owners = await getOwners()
      const repNames = {
        'ed': ['Ed', 'Edward'],
        'mark': ['Mark'],
      }
      const names = repNames[rep] || []
      const matched = owners.filter(o =>
        names.some(n => o.firstName?.toLowerCase().includes(n.toLowerCase()))
      )
      ownerIds = matched.map(o => String(o.id))
    }

    // Fetch all data in parallel
    const [calls, visits, sales, pipeline, dealAge] = await Promise.all([
      getConnectedCalls(monthStart, monthEnd, ownerIds),
      getMeetings(monthStart, monthEnd, ownerIds),
      getSales(monthStart, monthEnd, ownerIds),
      getPipeline(monthStart, monthEnd, ownerIds),
      getDealAge(ownerIds),
    ])

    // Build response
    const response = {
      sales: {
        actual: sales.total,
        budget: BUDGETS.sales,
        dailyActuals: sales.dailyActuals,
        byOwner: sales.byOwner,
        lastMonthActual: 0, // TODO: fetch previous month
      },
      calls: {
        actual: calls.total,
        target: BUDGETS.calls,
        dailyActuals: calls.dailyActuals,
        byOwner: calls.byOwner,
        lastMonth: 0,
      },
      visits: {
        actual: visits.total,
        target: BUDGETS.visits,
        dailyActuals: visits.dailyActuals,
        byOwner: visits.byOwner,
        lastMonth: 0,
      },
      pipeline: {
        actual: pipeline.total,
        target: BUDGETS.pipeline,
        dailyActuals: pipeline.dailyActuals,
        byOwner: pipeline.byOwner,
        lastMonth: 0,
      },
      dealAge: {
        avgDays: dealAge.avgDays,
        lastMonthAvg: 0, // TODO: fetch previous month
        bands: dealAge.bands,
        history: dealAge.history,
      },
      meta: {
        month,
        rep,
        daysInMonth,
        daysGone,
        lastSynced: new Date().toLocaleTimeString('en-NZ', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Pacific/Auckland',
        }),
      },
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store', // always fresh from HubSpot
      },
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data', detail: error.message },
      { status: 500 }
    )
  }
}
