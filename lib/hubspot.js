// lib/hubspot.js
// All HubSpot calls happen here, server-side only.
// The API key is read from environment variables and never sent to the browser.

const BASE = 'https://api.hubapi.com'

function headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function hs(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() })
  if (!res.ok) {
    throw new Error(`HubSpot API error ${res.status}: ${path}`)
  }
  return res.json()
}

async function hsPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`HubSpot API error ${res.status}: ${path}`)
  }
  return res.json()
}

// Fetch all pages of a CRM object list
async function fetchAll(path, limit = 100) {
  let results = []
  let after = null
  do {
    const url = `${path}${path.includes('?') ? '&' : '?'}limit=${limit}${after ? `&after=${after}` : ''}`
    const data = await hs(url)
    results = results.concat(data.results || [])
    after = data.paging?.next?.after || null
  } while (after)
  return results
}

// ── NZ WORKING DAYS ───────────────────────────────────────────────────────────
const NZ_HOLIDAYS = new Set([
  '2026-01-01','2026-01-02','2026-02-06','2026-04-03','2026-04-06',
  '2026-04-25','2026-06-01','2026-10-26','2026-12-25','2026-12-28',
  '2025-01-01','2025-01-02','2025-02-06','2025-04-18','2025-04-21',
  '2025-04-25','2025-06-02','2025-10-27','2025-12-25','2025-12-26',
])

function isWorkingDay(date) {
  const dow = date.getDay()
  if (dow === 0 || dow === 6) return false
  return !NZ_HOLIDAYS.has(date.toISOString().split('T')[0])
}

function workingDaysBetween(start, end) {
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    if (isWorkingDay(cur)) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

// ── OWNERS ────────────────────────────────────────────────────────────────────
export async function getOwners() {
  const data = await hs('/crm/v3/owners?limit=100')
  return (data.results || []).filter(o => o.firstName || o.lastName)
}

// ── CONNECTED CALLS ───────────────────────────────────────────────────────────
export async function getConnectedCalls(monthStart, monthEnd, ownerIds = null) {
  const startMs = monthStart.getTime()
  const endMs = monthEnd.getTime()

  const body = {
    filterGroups: [{
      filters: [
  { propertyName: 'hs_call_disposition', operator: 'EQ', value: 'f240bbac-87c9-4f6e-bf70-924b57d47db7' },
  { propertyName: 'hs_call_direction', operator: 'EQ', value: 'OUTBOUND' },
  { propertyName: 'hs_createdate', operator: 'GTE', value: String(startMs) },
  { propertyName: 'hs_createdate', operator: 'LTE', value: String(endMs) },
],
    }],
    properties: ['hs_call_status', 'hs_call_direction', 'hs_createdate', 'hubspot_owner_id', 'hs_call_title'],
    limit: 100,
  }

  if (ownerIds && ownerIds.length > 0) {
    body.filterGroups[0].filters.push({
      propertyName: 'hubspot_owner_id',
      operator: 'IN',
      values: ownerIds,
    })
  }

  let calls = []
  let after = null
  do {
    const searchBody = after ? { ...body, after } : body
    const res = await fetch(`${BASE}/crm/v3/objects/calls/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(searchBody),
    })
    const data = await res.json()
    calls = calls.concat(data.results || [])
    after = data.paging?.next?.after || null
  } while (after)

  const daysInMonth = Math.round((monthEnd - monthStart) / 86400000) + 1
  const daily = Array(daysInMonth).fill(0)
  calls.forEach(c => {
    const day = Math.floor((new Date(c.properties.hs_createdate) - monthStart) / 86400000)
    if (day >= 0 && day < daysInMonth) daily[day] += 1
  })

  const today = new Date()
  const todayDay = today >= monthEnd
    ? daysInMonth - 1
    : Math.floor((today - monthStart) / 86400000)

  let cum = 0
  const cumDaily = daily.map((v, i) => {
    if (i > todayDay) return null
    cum += v
    return cum
  })

  const byOwner = {}
  calls.forEach(c => {
    const id = c.properties.hubspot_owner_id
    if (id) byOwner[id] = (byOwner[id] || 0) + 1
  })

const details = calls.map(c => ({
  title: (c.properties.hs_call_title || 'Outbound call').replace('Call with ', ''),
  owner: c.properties.hubspot_owner_id,
  date: c.properties.hs_createdate,
})).sort((a, b) => new Date(b.date) - new Date(a.date))

return { total: calls.length, dailyActuals: cumDaily, byOwner, details }

}

// ── FACE-TO-FACE VISITS (meetings) ────────────────────────────────────────────
export async function getMeetings(monthStart, monthEnd, ownerIds = null) {
  const results = await fetchAll(
    `/crm/v4/objects/meetings?properties=hs_meeting_start_time,hs_createdate,hubspot_owner_id`
  )
  const meetings = results.filter(m => {
    const d = new Date(m.properties.hs_meeting_start_time || m.properties.hs_createdate)
    const inMonth = d >= monthStart && d <= monthEnd
    const ownedBy = ownerIds ? ownerIds.includes(m.properties.hubspot_owner_id) : true
    return inMonth && ownedBy
  })

  const daysInMonth = Math.round((monthEnd - monthStart) / 86400000) + 1
  const daily = Array(daysInMonth).fill(null)
  meetings.forEach(m => {
    const d = new Date(m.properties.hs_meeting_start_time || m.properties.hs_createdate)
    const day = Math.floor((d - monthStart) / 86400000)
    if (day >= 0 && day < daysInMonth) daily[day] = (daily[day] || 0) + 1
  })

  const today = new Date()
  const todayDay = today >= monthEnd
    ? daysInMonth - 1
    : Math.floor((today - monthStart) / 86400000)

  let cum = 0
  const cumDaily = daily.map((v, i) => {
    if (i > todayDay) return null
    cum += v || 0
    return cum
  })

  const byOwner = {}
  meetings.forEach(m => {
    const id = m.properties.hubspot_owner_id
    byOwner[id] = (byOwner[id] || 0) + 1
  })

  return { total: meetings.length, dailyActuals: cumDaily, byOwner }
}

// ── SALES (Bespoke Operations, close date this month) ─────────────────────────
export async function getSales(monthStart, monthEnd, ownerIds = null) {
  const pipeline = process.env.HUBSPOT_BESPOKE_PIPELINE_ID
  const CLOSED_LOST = '2795858408'

  // Fetch all deals with close date this month
  let results = []
  let after = null
  do {
    const searchBody = {
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: pipeline },
          { propertyName: 'closedate', operator: 'GTE', value: String(monthStart.getTime()) },
          { propertyName: 'closedate', operator: 'LTE', value: String(monthEnd.getTime()) },
        ]
      }],
      properties: ['dealname', 'amount', 'dealstage', 'closedate', 'createdate', 'hubspot_owner_id'],
      limit: 100,
      ...(after ? { after } : {}),
    }
    const res = await fetch(`${BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(searchBody),
    })
    const page = await res.json()
    results = results.concat(page.results || [])
    after = page.paging?.next?.after || null
  } while (after)

  // Exclude Closed Lost, filter by owner if needed
  const deals = results.filter(d => {
    const notLost = d.properties.dealstage !== CLOSED_LOST
    const ownedBy = ownerIds ? ownerIds.includes(d.properties.hubspot_owner_id) : true
    return notLost && ownedBy
  })

  // Total = all qualifying deals with close date this month
  const total = Math.round(deals.reduce((sum, d) => sum + (parseFloat(d.properties.amount) || 0), 0))

  // Chart line = cumulative by CREATE date (shows orders building over time)
  const daysInMonth = Math.round((monthEnd - monthStart) / 86400000) + 1
  const daily = Array(daysInMonth).fill(0)
  deals.forEach(d => {
  const created = new Date(d.properties.createdate)
  // If created before this month, plot on day 1 (index 0)
  const day = created < monthStart
    ? 0
    : Math.floor((created - monthStart) / 86400000)
  const clampedDay = Math.min(Math.max(day, 0), daysInMonth - 1)
  daily[clampedDay] += parseFloat(d.properties.amount) || 0
})

  const today = new Date()
  const todayDay = today >= monthEnd
    ? daysInMonth - 1
    : Math.floor((today - monthStart) / 86400000)

  let cum = 0
  const cumDaily = daily.map((v, i) => {
    if (i > todayDay) return null
    cum += v
    return Math.round(cum)
  })

  const byOwner = {}
  deals.forEach(d => {
    const id = d.properties.hubspot_owner_id
    byOwner[id] = (byOwner[id] || 0) + (parseFloat(d.properties.amount) || 0)
  })

  return { total, dailyActuals: cumDaily, byOwner }
}

// ── PIPELINE (Revenue Train, new deals this month) ────────────────────────────
export async function getPipeline(monthStart, monthEnd, ownerIds = null) {
  const pipeline = process.env.HUBSPOT_REVENUE_TRAIN_PIPELINE_ID
  const wonStage = process.env.HUBSPOT_REVENUE_TRAIN_WON_STAGE_ID || ''

  const results = await fetchAll(
    `/crm/v3/objects/deals?properties=amount,dealstage,dealname,createdate,hubspot_owner_id,pipeline`
  )

  const deals = results.filter(d => {
    const created = new Date(d.properties.createdate)
    const inPipeline = d.properties.pipeline === pipeline
    const notWon = d.properties.dealstage !== wonStage
    const inMonth = created >= monthStart && created <= monthEnd
    const ownedBy = ownerIds ? ownerIds.includes(d.properties.hubspot_owner_id) : true
    return inPipeline && notWon && inMonth && ownedBy
  })

  const daysInMonth = Math.round((monthEnd - monthStart) / 86400000) + 1
  const daily = Array(daysInMonth).fill(0)
  deals.forEach(d => {
    const created = new Date(d.properties.createdate)
    const day = Math.floor((created - monthStart) / 86400000)
    if (day >= 0 && day < daysInMonth) {
      daily[day] += parseFloat(d.properties.amount) || 0
    }
  })

  const today = new Date()
  const todayDay = today >= monthEnd
    ? daysInMonth - 1
    : Math.floor((today - monthStart) / 86400000)

  let cum = 0
  const cumDaily = daily.map((v, i) => {
    if (i > todayDay) return null
    cum += v
    return Math.round(cum)
  })

  const total = deals.reduce((sum, d) => sum + (parseFloat(d.properties.amount) || 0), 0)

  const byOwner = {}
  deals.forEach(d => {
    const id = d.properties.hubspot_owner_id
    byOwner[id] = (byOwner[id] || 0) + (parseFloat(d.properties.amount) || 0)
  })

  const details = deals.map(d => ({
  name: d.properties.dealname || 'Unnamed deal',
  amount: parseFloat(d.properties.amount) || 0,
  stage: d.properties.dealstage,
  owner: d.properties.hubspot_owner_id,
  date: d.properties.createdate,
})).sort((a, b) => new Date(b.date) - new Date(a.date))

return { total: Math.round(total), dailyActuals: cumDaily, byOwner, details }
}

// ── DEAL AGE (Bespoke Operations, working days create → Goods Shipped/Invoiced)
export async function getDealAge(monthStart, monthEnd, ownerIds = null) {
  const pipeline = process.env.HUBSPOT_BESPOKE_PIPELINE_ID
  const BACK_ORDER = '2795858404'
  const DONE_STAGES = [
    process.env.HUBSPOT_GOODS_SHIPPED_STAGE_ID,
    process.env.HUBSPOT_INVOICED_STAGE_ID,
    '2795858408', // Closed Lost
  ]

  // Search for active deals with close date this month
  let allDeals = []
  let after = null
  do {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: pipeline },
          { propertyName: 'closedate', operator: 'GTE', value: String(monthStart.getTime()) },
          { propertyName: 'closedate', operator: 'LTE', value: String(monthEnd.getTime()) },
        ]
      }],
      properties: ['dealname', 'dealstage', 'createdate', 'hubspot_owner_id'],
      limit: 100,
      ...(after ? { after } : {}),
    }
    const res = await fetch(`${BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    })
    const page = await res.json()
    allDeals = allDeals.concat(page.results || [])
    after = page.paging?.next?.after || null
  } while (after)

  // Filter to active deals only
  const activeDeals = allDeals.filter(d => {
    const isActive = !DONE_STAGES.includes(d.properties.dealstage)
    const ownedBy = ownerIds ? ownerIds.includes(d.properties.hubspot_owner_id) : true
    return isActive && ownedBy
  })

  // For each active deal, fetch stage history to check if ever in Back Order
  // Batch this to avoid too many requests
  const dealDetails = await Promise.all(
    activeDeals.map(async d => {
      try {
        const res = await fetch(
          `${BASE}/crm/v4/objects/deals/${d.id}?propertiesWithHistory=dealstage`,
          { headers: headers() }
        )
        const detail = await res.json()
        const stageHistory = detail.propertiesWithHistory?.dealstage || []
        const wasInBackOrder = stageHistory.some(h => h.value === BACK_ORDER)
        return { deal: d, wasInBackOrder }
      } catch (e) {
        return { deal: d, wasInBackOrder: false }
      }
    })
  )

  // Exclude deals that were ever in Back Order
  const eligibleDeals = dealDetails
    .filter(({ wasInBackOrder }) => !wasInBackOrder)
    .map(({ deal }) => deal)

  const now = new Date()
  const ages = eligibleDeals.map(d => {
    const created = new Date(d.properties.createdate)
    return Math.round((now - created) / (1000 * 60 * 60 * 24))
  })

  const avg = ages.length > 0
    ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)
    : 0

  const BAND_DEFS = [
    { label: '1–5 days',   min: 1,  max: 5    },
    { label: '6–10 days',  min: 6,  max: 10   },
    { label: '11–20 days', min: 11, max: 20   },
    { label: '21+ days',   min: 21, max: 9999 },
  ]

  const bands = BAND_DEFS.map(b => ({
    ...b,
    count: ages.filter(a => a >= b.min && a <= b.max).length,
    deals: eligibleDeals
      .filter((_, i) => ages[i] >= b.min && ages[i] <= b.max)
      .map((d, _, arr) => {
        const idx = eligibleDeals.indexOf(d)
        return {
          name: d.properties.dealname || 'Unnamed deal',
          days: ages[idx],
          stage: d.properties.dealstage,
          owner: d.properties.hubspot_owner_id,
        }
      }),
  }))

  return { avgDays: avg, total: eligibleDeals.length, bands, history: [avg] }
}