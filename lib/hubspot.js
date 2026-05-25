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
  const results = await fetchAll(
    `/crm/v4/objects/calls?properties=hs_call_status,hs_call_direction,hs_createdate,hubspot_owner_id,hs_timestamp`
  )

  const calls = results.filter(c => {
    const callDate = new Date(c.properties.hs_timestamp || c.properties.hs_createdate)
    const isConnected = c.properties.hs_call_status === 'CONNECTED'
    const inMonth = callDate >= monthStart && callDate <= monthEnd
    const ownedBy = ownerIds ? ownerIds.includes(c.properties.hubspot_owner_id) : true
    return isConnected && inMonth && ownedBy
  })

  const daysInMonth = Math.round((monthEnd - monthStart) / 86400000) + 1
  const daily = Array(daysInMonth).fill(0)
  calls.forEach(c => {
    const callDate = new Date(c.properties.hs_timestamp || c.properties.hs_createdate)
    const day = Math.floor((callDate - monthStart) / 86400000)
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
    byOwner[id] = (byOwner[id] || 0) + 1
  })

  return { total: calls.length, dailyActuals: cumDaily, byOwner }
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
  const results = await fetchAll(
    `/crm/v3/objects/deals?properties=amount,dealstage,closedate,createdate,hubspot_owner_id,pipeline`
  )

  const deals = results.filter(d => {
    const close = d.properties.closedate ? new Date(d.properties.closedate) : null
    const inPipeline = d.properties.pipeline === pipeline
    const inMonth = close && close >= monthStart && close <= monthEnd
    const ownedBy = ownerIds ? ownerIds.includes(d.properties.hubspot_owner_id) : true
    return inPipeline && inMonth && ownedBy
  })

  const daysInMonth = Math.round((monthEnd - monthStart) / 86400000) + 1
  const daily = Array(daysInMonth).fill(0)
  deals.forEach(d => {
    const close = new Date(d.properties.closedate)
    const day = Math.floor((close - monthStart) / 86400000)
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

  return { total: Math.round(total), dailyActuals: cumDaily, byOwner }
}

// ── PIPELINE (Revenue Train, new deals this month) ────────────────────────────
export async function getPipeline(monthStart, monthEnd, ownerIds = null) {
  const pipeline = process.env.HUBSPOT_REVENUE_TRAIN_PIPELINE_ID
  const wonStage = process.env.HUBSPOT_REVENUE_TRAIN_WON_STAGE_ID || ''

  const results = await fetchAll(
    `/crm/v3/objects/deals?properties=amount,dealstage,createdate,hubspot_owner_id,pipeline`
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

  return { total: Math.round(total), dailyActuals: cumDaily, byOwner }
}

// ── DEAL AGE (Bespoke Operations, working days create → Goods Shipped/Invoiced)
export async function getDealAge(ownerIds = null) {
  const pipeline = process.env.HUBSPOT_BESPOKE_PIPELINE_ID
  const goodsShipped = process.env.HUBSPOT_GOODS_SHIPPED_STAGE_ID
  const invoiced = process.env.HUBSPOT_INVOICED_STAGE_ID

  const results = await fetchAll(
    `/crm/v3/objects/deals?properties=amount,dealstage,createdate,hubspot_owner_id,pipeline`
  )

  const completed = results.filter(d => {
    const inPipeline = d.properties.pipeline === pipeline
    const isComplete = [goodsShipped, invoiced].includes(d.properties.dealstage)
    const ownedBy = ownerIds ? ownerIds.includes(d.properties.hubspot_owner_id) : true
    return inPipeline && isComplete && ownedBy
  })

  const now = new Date()
  const ages = completed.map(d => {
    const created = new Date(d.properties.createdate)
    return workingDaysBetween(created, now)
  })

  const avg = ages.length > 0
    ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)
    : 0

  // Band breakdown
  const bands = [
    { label: '1–5 days', min: 1, max: 5 },
    { label: '6–10 days', min: 6, max: 10 },
    { label: '11–20 days', min: 11, max: 20 },
    { label: '21+ days', min: 21, max: 9999 },
  ]
  const bandData = bands.map(b => ({
    ...b,
    count: ages.filter(a => a >= b.min && a <= b.max).length,
    deals: completed
      .filter((d, i) => ages[i] >= b.min && ages[i] <= b.max)
      .map(d => ({
        name: d.properties.dealname || 'Unnamed deal',
        days: ages[completed.indexOf(d)],
        stage: d.properties.dealstage,
        owner: d.properties.hubspot_owner_id,
      })),
  }))

  // Rolling 30-day history (last 13 data points for chart)
  // In production this would query historical snapshots
  // For now we return current avg as the latest point
  const history = [avg]

  return { avgDays: avg, bands: bandData, history }
}
