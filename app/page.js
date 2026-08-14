'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import { createClient } from '@/lib/supabase/client'
import styles from './dashboard.module.css'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler
)

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fmt(v) {
  if (!v || v === 0) return '$0'
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'K'
  return '$' + Math.round(v)
}

function pct(a, b) {
  return b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0
}

function paceStatus(actual, target, daysGone, daysInMonth) {
  if (!daysGone || !target) return { diff: 0, diffPct: 0, ahead: false }
  const expected = (daysGone / daysInMonth) * target
  const diff = actual - expected
  const diffPct = expected > 0 ? Math.round(Math.abs(diff) / expected * 100) : 0
  return { diff, diffPct, ahead: diff >= 0 }
}

function dayLabels(daysInMonth, month) {
  const [y, m] = month.split('-')
  return Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1
    return d === 1 || d % 7 === 0 ? `${m}/${d}` : ''
  })
}

function paceArray(target, days) {
  return Array.from({ length: days }, (_, i) => Math.round(target / days * (i + 1)))
}

// Shared month-option list for both the desktop and mobile month selectors, so
// the two can never drift. Descending chronological: most-future first, current
// in the middle, most-past last.
// NB: val is built from LOCAL date parts, not d.toISOString(). toISOString
// converts to UTC, which on an ahead-of-UTC timezone (NZ, UTC+12/13) rolls a
// "1st of month" date back into the previous month for any load before midday,
// leaving val a month behind label. That mismatch could save targets against the
// wrong month, so val and label are both derived from the same local date.
function buildMonthOptions(monthsAhead = 12, monthsBack = 12) {
  const opts = []
  for (let offset = monthsAhead; offset >= -monthsBack; offset--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
    const y = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const val = y + '-' + mo
    const label = d.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })
    opts.push({ val, label })
  }
  return opts
}

function padActuals(actuals, daysInMonth) {
  const padded = Array(daysInMonth).fill(NaN)
  if (!actuals) return padded
  actuals.forEach((v, i) => {
    if (v !== null && v !== undefined) padded[i] = v
  })
  return padded
}

// ── TODAY LINE PLUGIN ─────────────────────────────────────────────────────────
const todayLinePlugin = (daysGone, daysInMonth) => ({
  id: `tl_${daysGone}_${daysInMonth}`,
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !scales.x) return
    const xMin = scales.x.getPixelForValue(0)
    const xMax = scales.x.getPixelForValue(daysInMonth - 1)
    if (isNaN(xMin) || isNaN(xMax)) return
    const todayX = xMin + ((daysGone - 1) / (daysInMonth - 1)) * (xMax - xMin)
    ctx.save()
    ctx.strokeStyle = 'rgba(64,81,79,0.55)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(todayX, chartArea.top + 20)
    ctx.lineTo(todayX, chartArea.bottom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#40514F'
    ctx.fillRect(todayX - 18, chartArea.top, 36, 16)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 9px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Today', todayX, chartArea.top + 8)
    ctx.restore()
  }
})

// ── MAPS ──────────────────────────────────────────────────────────────────────
const RT_STAGES = {
  '2848593377': 'Opportunity Identified',
  '3049815540': 'Quote Required',
  '2848628197': 'Follow Up Required',
  '2848628198': 'Decision Pending',
  '2848628199': 'Closed Won',
  '2848628200': 'Indent',
  '2848628201': 'Closed Lost',
}

const OWNERS = {
  '27034621':  'Ed Beatson',
  '363522625': 'Mark Beatson',
  '363424672': 'Sage Capper',
  '363522561': 'Yvette Devoe',
}

// ── MOCK DATA ─────────────────────────────────────────────────────────────────
const MOCK = {
  sales:    { actual: 0, budget: 150000, dailyActuals: [], lastMonthActual: 0 },
  calls:    { actual: 0, target: 0, details: [], dailyActuals: [], lastMonth: 0 },
  visits:   { actual: 0, target: 0, dailyActuals: [], lastMonth: 0 },
  pipeline: { actual: 0, target: 0, details: [], dailyActuals: [], lastMonth: 0 },
  dealAge:  { avgDays: 0, lastMonthAvg: 0, total: 0, bands: [
    { label: '1–5 days',   min:1,  max:5,    count:0, deals:[] },
    { label: '6–10 days',  min:6,  max:10,   count:0, deals:[] },
    { label: '11–20 days', min:11, max:20,   count:0, deals:[] },
    { label: '21+ days',   min:21, max:9999, count:0, deals:[] },
  ], history: [] },
  targets:  { Ed: { calls: 0, visits: 0, pipeline: 0 }, Mark: { calls: 0, visits: 0, pipeline: 0 } },
  meta:     { month: '2026-05', rep: 'full-team', daysInMonth: 31, daysGone: 0, lastSynced: 'Loading...' },
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData]                             = useState(MOCK)
  const [loading, setLoading]                       = useState(false)
  const [month, setMonth]                           = useState(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') })
  const [rep, setRep]                               = useState('full-team')
  const [drillBand, setDrillBand]                   = useState(null)
  const [drillCalls, setDrillCalls]                 = useState(null)
  const [drillPipeline, setDrillPipeline]           = useState(null)
  const [drillPipelineTotal, setDrillPipelineTotal] = useState(0)
  const [isAdmin, setIsAdmin]                       = useState(false)
  const [userEmail, setUserEmail]                   = useState('')
  const [showTargetModal, setShowTargetModal]       = useState(false)
  const [targetSaving, setTargetSaving]             = useState(false)
  const [targetMsg, setTargetMsg]                   = useState('')
  const [targetMsgType, setTargetMsgType]           = useState('') // 'success' | 'error'
  const [mobileMenuOpen, setMobileMenuOpen]         = useState(false)
  const [editTargets, setEditTargets]               = useState({ Ed: { calls: 0, visits: 0, pipeline: 0 }, Mark: { calls: 0, visits: 0, pipeline: 0 } })
  const [editSalesBudget, setEditSalesBudget]       = useState(60000)
  const [fieldErrors, setFieldErrors]               = useState({})
  const panelRef      = useRef(null)
  const firstFieldRef = useRef(null)
  const editBtnRef    = useRef(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard?month=${month}&rep=${rep}&t=${Date.now()}`, { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) {
      console.log('Using mock data:', e.message)
    } finally {
      setLoading(false)
    }
  }, [month, rep])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    const interval = setInterval(loadData, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadData])

  // Resolve the signed-in user. isAdmin is a COSMETIC flag: it only decides
  // whether to render the admin affordance. The write path is authorised
  // server-side via rpc('is_admin') + RLS, never by this flag.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserEmail(user.email || '')
        setIsAdmin((user.email || '').toLowerCase() === 'edward@spoke.nz')
      }
    })
  }, [])

  // Edit panel: focus the first field on open; restore focus to the trigger on close.
  useEffect(() => {
    if (showTargetModal) {
      firstFieldRef.current?.focus()
    } else {
      editBtnRef.current?.focus()
    }
  }, [showTargetModal])

  const { sales, calls, visits, pipeline, dealAge, meta, targets } = data
  const { daysGone, daysInMonth } = meta
  const todayPct  = Math.round(daysGone / daysInMonth * 100)
  const labels    = dayLabels(daysInMonth, month)
  const salPace   = paceStatus(sales.actual, sales.budget, daysGone, daysInMonth)
  const forecast  = daysGone > 0 ? Math.round(sales.actual / daysGone * daysInMonth) : 0
  const monthPct  = Math.round(daysGone / daysInMonth * 100)
  const tlPlugin  = todayLinePlugin(daysGone, daysInMonth)

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
  }

  const smallScales = {
    x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 3, font: { size: 9 } } },
    y: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 3, font: { size: 9 } } },
  }

  const salesData    = padActuals(sales.dailyActuals,    daysInMonth)
  const callsData    = padActuals(calls.dailyActuals,    daysInMonth)
  const visitsData   = padActuals(visits.dailyActuals,   daysInMonth)
  const pipelineData = padActuals(pipeline.dailyActuals, daysInMonth)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  function openTargetModal() {
    setEditTargets({
      Ed:   { ...(targets?.Ed   || { calls: 0, visits: 0, pipeline: 0 }) },
      Mark: { ...(targets?.Mark || { calls: 0, visits: 0, pipeline: 0 }) },
    })
    setEditSalesBudget(sales?.budget || 60000)
    setFieldErrors({})
    setTargetMsg('')
    setTargetMsgType('')
    setShowTargetModal(true)
  }

  function closeTargetModal() {
    setShowTargetModal(false)
  }

  // Focus trap + Escape for the edit panel.
  function onPanelKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeTargetModal()
      return
    }
    if (e.key === 'Tab' && panelRef.current) {
      const focusable = panelRef.current.querySelectorAll(
        'input, button, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
  }

  // Values must be integers of 0 or more. Blank ('') and negatives are invalid.
  function validateTargets() {
    const errs = {}
    const okInt = v => Number.isInteger(v) && v >= 0
    if (!okInt(editSalesBudget)) errs.salesBudget = true
    for (const r of ['Ed', 'Mark']) {
      if (!okInt(editTargets[r].calls))    errs[`${r}.calls`]    = true
      if (!okInt(editTargets[r].visits))   errs[`${r}.visits`]   = true
      if (!okInt(editTargets[r].pipeline)) errs[`${r}.pipeline`] = true
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function saveTargets() {
    if (!validateTargets()) return
    setTargetSaving(true)
    setTargetMsg('')
    setTargetMsgType('')
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, targets: editTargets, salesBudget: editSalesBudget }),
      })
      if (res.status === 401) { window.location.assign('/login'); return }
      if (res.status === 403) {
        setTargetMsgType('error')
        setTargetMsg('You do not have permission to edit targets.')
        setTargetSaving(false)
        return
      }
      const json = await res.json()
      if (res.ok && json.success) {
        setTargetMsgType('success')
        setTargetMsg('Targets saved')
        setTimeout(() => {
          setShowTargetModal(false)
          setTargetMsg('')
          setTargetMsgType('')
          loadData()
        }, 800)
      } else {
        setTargetMsgType('error')
        setTargetMsg("We couldn't save the targets. Try again.")
      }
    } catch (e) {
      setTargetMsgType('error')
      setTargetMsg("We couldn't save the targets. Try again.")
    } finally {
      setTargetSaving(false)
    }
  }

  function openDrillPipeline() {
    setDrillPipeline(pipeline.details || [])
    setDrillPipelineTotal(pipeline.actual || 0)
  }

  // Rep label for display
  const repLabel = rep === 'ed' ? 'Ed Beatson' : rep === 'mark' ? 'Mark Beatson' : 'Full Team'

  // Edit-panel helpers
  const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })
  const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : 0
  const fmtDollars = v => '$' + num(v).toLocaleString('en-NZ')
  const teamCalls    = num(editTargets.Ed.calls)    + num(editTargets.Mark.calls)
  const teamVisits   = num(editTargets.Ed.visits)   + num(editTargets.Mark.visits)
  const teamPipeline = num(editTargets.Ed.pipeline) + num(editTargets.Mark.pipeline)
  const parseField = val => val === '' ? '' : parseInt(val, 10)

  return (
    <div className={styles.dashboard}>

      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <img src="/spoke-logo.png" alt="Spoke" className={styles.logoImg} />
          <div className={styles.divider} />
          <h1>Sales Performance Dashboard</h1>
        </div>
        <div className={styles.controls}>
          <select value={month} onChange={e => setMonth(e.target.value)}>
  {buildMonthOptions().map(({ val, label }) => (
    <option key={val} value={val}>{label}</option>
  ))}
</select>
          <select value={rep} onChange={e => setRep(e.target.value)}>
            <option value="full-team">Full Team</option>
            <option value="ed">Ed Beatson</option>
            <option value="mark">Mark Beatson</option>
          </select>
          {isAdmin && (
            <button ref={editBtnRef} className={styles.editBtn} onClick={openTargetModal}>
              Edit targets
            </button>
          )}
          <button className={styles.signOutBtn} onClick={handleSignOut}>
            Sign out
          </button>
          <div className={styles.sync}>
            <span>{loading ? 'Syncing HubSpot...' : `Last synced from HubSpot · ${meta.lastSynced}`}</span>
            <i className={`${styles.dot} ${loading ? styles.dotPulse : ''}`} />
          </div>
          <button className={styles.hamburger} onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">
            <span /><span /><span />
          </button>
        </div>
      </header>

      {/* MOBILE MENU */}
      {mobileMenuOpen && (
        <div className={styles.mobileMenu}>
          <div className={styles.mobileMenuRow}>
            <label className={styles.mobileLabel}>Month</label>
            <select value={month} onChange={e => { setMonth(e.target.value); setMobileMenuOpen(false) }}>
              {buildMonthOptions().map(({ val, label }) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className={styles.mobileMenuRow}>
            <label className={styles.mobileLabel}>View</label>
            <select value={rep} onChange={e => { setRep(e.target.value); setMobileMenuOpen(false) }}>
              <option value="full-team">Full Team</option>
              <option value="ed">Ed Beatson</option>
              <option value="mark">Mark Beatson</option>
            </select>
          </div>
          <div className={styles.mobileMenuRow}>
            {isAdmin && (
              <button className={styles.editBtn}
                onClick={() => { openTargetModal(); setMobileMenuOpen(false) }}>
                Edit targets
              </button>
            )}
            <button className={styles.signOutBtn}
              onClick={() => { handleSignOut(); setMobileMenuOpen(false) }}>
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* MAIN */}
      <main className={styles.main}>

        {/* TOP CARD — Sales (always full team) */}
        <section className={`${styles.card} ${styles.topCard}`}>
          <div className={styles.salesLeft}>
            <div>
              <h2 className={styles.sectionLabel}>Actual Sales vs Budget {rep !== 'full-team' && <span style={{fontSize:'11px',fontWeight:400,textTransform:'none',letterSpacing:0}}>· Full team</span>}</h2>
              <div className={styles.bigNumber}>{fmt(sales.actual)}</div>
              <p className={styles.budgetLine}>of {fmt(sales.budget)} budget</p>
              <div className={styles.budgetPill}>
                <strong>{pct(sales.actual, sales.budget)}%</strong>
                <span>of budget</span>
              </div>
              <div className={styles.rule} />
              <div className={styles.paceCopy}>
                <div className={styles.paceIcon}>{salPace.ahead ? '↑' : '↓'}</div>
                <div>
                  <strong>{salPace.diffPct}% {salPace.ahead ? 'ahead of' : 'behind'} pace</strong>
                  <span>{fmt(Math.abs(salPace.diff))} {salPace.ahead ? 'ahead of' : 'behind'} expected</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.chartArea}>
            <div className={styles.legend}>
              <span><i className={styles.legLine} />Actual Sales</span>
              <span><i className={styles.legDash} />Expected (Pace)</span>
            </div>
            <div className={styles.mainChartWrap}>
              <Line
                plugins={[tlPlugin]}
                data={{
                  labels,
                  datasets: [
                    { data: salesData, borderColor: '#40514F', backgroundColor: 'transparent', tension: 0.32, borderWidth: 3, pointRadius: 0, spanGaps: false },
                    { data: paceArray(sales.budget, daysInMonth), borderColor: '#BEDA81', borderDash: [4, 5], tension: 0, borderWidth: 2, pointRadius: 0 },
                  ],
                }}
                options={{
                  ...chartDefaults,
                  plugins: {
                    ...chartDefaults.plugins,
                    tooltip: { callbacks: { label: ctx => ctx.datasetIndex === 0 ? `Actual: ${fmt(ctx.raw)}` : `Pace: ${fmt(ctx.raw)}` } },
                  },
                  scales: {
                    x: { grid: { display: false }, border: { color: 'rgba(64,81,79,.18)' }, ticks: { maxTicksLimit: 6, font: { size: 10 } } },
                    y: { min: 0, grid: { color: 'rgba(64,81,79,.1)', borderDash: [3, 3] }, border: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 10 }, callback: v => fmt(v) } },
                  },
                }}
              />
            </div>
          </div>

          <aside className={styles.sideSummary}>
            <div>
              <small>Month Progress</small>
              <strong>{monthPct}%</strong>
              <span>{daysGone} of {daysInMonth} days</span>
            </div>
            <div className={styles.sideRule} />
            <div>
              <small>Forecast</small>
              <strong>{fmt(forecast)}</strong>
              <span>{pct(forecast, sales.budget)}% of budget</span>
            </div>
          </aside>
        </section>

        {/* BOTTOM GRID */}
        <section className={styles.bottomGrid}>

          {/* CALLS */}
          <MetricCard
            icon={<PhoneIcon />}
            title={`Outbound Calls${rep !== 'full-team' ? ' · ' + repLabel.split(' ')[0] : ''}`}
            actual={calls.actual}
            target={calls.target}
            isMoney={false}
            daysGone={daysGone}
            daysInMonth={daysInMonth}
            todayPct={todayPct}
            onDrill={() => setDrillCalls(calls.details || [])}
          >
            <div className={styles.smallChartWrap}>
              <Line
                plugins={[tlPlugin]}
                data={{
                  labels,
                  datasets: [
                    { data: callsData, borderColor: '#40514F', backgroundColor: 'transparent', borderWidth: 2.5, tension: 0.35, pointRadius: 0, spanGaps: false },
                    { data: paceArray(calls.target, daysInMonth), borderColor: '#BEDA81', borderDash: [4, 5], borderWidth: 1.7, pointRadius: 0 },
                  ],
                }}
                options={{ ...chartDefaults, scales: smallScales }}
              />
            </div>
          </MetricCard>

          {/* VISITS */}
          <MetricCard
            icon={<PeopleIcon />}
            title={`Face to Face Visits${rep !== 'full-team' ? ' · ' + repLabel.split(' ')[0] : ''}`}
            actual={visits.actual}
            target={visits.target}
            isMoney={false}
            daysGone={daysGone}
            daysInMonth={daysInMonth}
            todayPct={todayPct}
          >
            <div className={styles.smallChartWrap}>
              <Line
                plugins={[tlPlugin]}
                data={{
                  labels,
                  datasets: [
                    { data: visitsData, borderColor: '#40514F', backgroundColor: 'transparent', borderWidth: 2.5, tension: 0.35, pointRadius: 0, spanGaps: false },
                    { data: paceArray(visits.target, daysInMonth), borderColor: '#BEDA81', borderDash: [4, 5], borderWidth: 1.7, pointRadius: 0 },
                  ],
                }}
                options={{ ...chartDefaults, scales: smallScales }}
              />
            </div>
          </MetricCard>

          {/* PIPELINE */}
          <MetricCard
            icon={<DollarIcon />}
            title={`New Pipeline${rep !== 'full-team' ? ' · ' + repLabel.split(' ')[0] : ''}`}
            actual={pipeline.actual}
            target={pipeline.target}
            isMoney={true}
            daysGone={daysGone}
            daysInMonth={daysInMonth}
            todayPct={todayPct}
            onDrill={openDrillPipeline}
          >
            <div className={styles.smallChartWrap}>
              <Bar
                plugins={[tlPlugin]}
                data={{
                  labels,
                  datasets: [
                    { data: pipelineData, backgroundColor: '#BEDA81', borderRadius: 3, barThickness: 5 },
                    { data: paceArray(pipeline.target, daysInMonth), type: 'line', borderColor: '#BEDA81', borderDash: [4, 5], borderWidth: 1.7, pointRadius: 0 },
                  ],
                }}
                options={{
                  ...chartDefaults,
                  scales: { ...smallScales, y: { ...smallScales.y, ticks: { ...smallScales.y.ticks, callback: v => fmt(v) } } },
                }}
              />
            </div>
          </MetricCard>

          {/* DEAL AGE */}
          <article className={`${styles.card} ${styles.metricCard}`}>
            <div className={styles.metricHead}>
              <div className={styles.icon}><ClockIcon /></div>
              <h3 className={styles.metricTitle}>Average Deal Age</h3>
            </div>
            <div className={styles.metricMain}>
              <div>
                <div className={styles.metricNumber}>{dealAge.avgDays}</div>
                <div className={styles.daysText}>days · {dealAge.total || 0} deals</div>
              </div>
              <div className={styles.miniPct}>
                <strong>{dealAge.lastMonthAvg > 0 ? (dealAge.lastMonthAvg - dealAge.avgDays >= 0 ? '↓ ' : '↑ ') + Math.abs(dealAge.lastMonthAvg - dealAge.avgDays) : '—'}</strong>
                vs<br />last month
              </div>
            </div>
            <div style={{ fontSize: '9px', color: 'var(--muted)', margin: '6px 0', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              By age band · click to drill
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', flex: 1 }}>
              {dealAge.bands.map((band, i) => (
                <button key={i} onClick={() => setDrillBand(band)} style={{
                  background: i === 3 && band.count > 0 ? 'rgba(198,92,46,0.1)' : 'rgba(64,81,79,0.06)',
                  border: i === 3 && band.count > 0 ? '1px solid rgba(198,92,46,0.2)' : '1px solid transparent',
                  borderRadius: '8px', padding: '6px 8px', cursor: 'pointer', textAlign: 'center', fontFamily: 'var(--font-sans)',
                }}>
                  <div style={{ fontSize: '9px', color: 'var(--muted)' }}>{band.label}</div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', color: i === 3 && band.count > 0 ? 'var(--bad)' : 'var(--mineral)', lineHeight: 1 }}>{band.count}</div>
                  <div style={{ fontSize: '9px', color: 'var(--muted)' }}>deal{band.count !== 1 ? 's' : ''}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '6px' }}>Bespoke Ops · excl. Back Order &amp; Samples</div>
          </article>

        </section>
      </main>

      <footer className={styles.footer}>
        <span>All targets are monthly goals</span>
        <span>Data pulled live from HubSpot</span>
        <span>Times shown in NZT</span>
      </footer>

      {/* DEAL BAND DRILL */}
      {drillBand && (
        <div className={styles.overlay} onClick={() => setDrillBand(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>{drillBand.label} · {drillBand.count} deal{drillBand.count !== 1 ? 's' : ''}</h2>
            <p className={styles.modalSub}>Days from deal creation · Bespoke Operations · close date this month</p>
            <div className={styles.dealList}>
              {drillBand.deals.length === 0
                ? <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>No deals in this range</div>
                : drillBand.deals.map((deal, i) => (
                  <div key={i} className={styles.dealRow}>
                    <div>
                      <div className={styles.dealName}>{deal.name}</div>
                      {deal.stage && <div className={styles.dealMeta}>{deal.stage}</div>}
                    </div>
                    <div className={`${styles.dealBadge} ${deal.days > 15 ? styles.badgeWarn : styles.badgeOk}`}>{deal.days}d</div>
                  </div>
                ))}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={() => setDrillBand(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* CALLS DRILL */}
      {drillCalls && (
        <div className={styles.overlay} onClick={() => setDrillCalls(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>Outbound Calls · {drillCalls.length} connected this month</h2>
            <p className={styles.modalSub}>Connected outbound calls · most recent first</p>
            <div className={styles.dealList}>
              {drillCalls.length === 0
                ? <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>No calls found</div>
                : drillCalls.map((call, i) => {
                  const nzt = new Date(call.date)
                  return (
                    <div key={i} className={styles.dealRow}>
                      <div>
                        <div className={styles.dealName}>{call.title}</div>
                        <div className={styles.dealMeta}>
                          {nzt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' })} · {nzt.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Auckland' })} · {OWNERS[call.owner] || 'Unknown'}
                        </div>
                      </div>
                      <div className={`${styles.dealBadge} ${styles.badgeOk}`}>Connected</div>
                    </div>
                  )
                })}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={() => setDrillCalls(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* PIPELINE DRILL */}
      {drillPipeline && (
        <div className={styles.overlay} onClick={() => setDrillPipeline(null)}>
          <div className={styles.modal} style={{ width: '560px' }} onClick={e => e.stopPropagation()}>
            <h2>New Pipeline · {drillPipeline.length} deals this month</h2>
            <p className={styles.modalSub}>Revenue Train · new deals created this month</p>
            <div className={styles.dealList}>
              {drillPipeline.length === 0
                ? <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>No deals added this month</div>
                : drillPipeline.map((deal, i) => {
                  const nzt = new Date(deal.date)
                  return (
                    <div key={i} className={styles.dealRow}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={styles.dealName}>{deal.name}</div>
                        <div className={styles.dealMeta}>
                          {RT_STAGES[deal.stage] || deal.stage} · {OWNERS[deal.owner] || 'Unknown'} · {nzt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' })}
                        </div>
                      </div>
                      <div className={`${styles.dealBadge} ${styles.badgeOk}`} style={{ marginLeft: '12px', flexShrink: 0 }}>
                        {deal.amount > 0 ? `$${Math.round(deal.amount).toLocaleString()}` : 'No value'}
                      </div>
                    </div>
                  )
                })}
            </div>
            <div style={{ borderTop: '1px solid var(--line)', marginTop: '12px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Total: <strong style={{ color: 'var(--ink)' }}>${drillPipelineTotal.toLocaleString()}</strong></span>
              <button className={styles.btnCancel} onClick={() => setDrillPipeline(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MONTHLY TARGETS PANEL */}
      {showTargetModal && isAdmin && (
        <div className={styles.overlay} onClick={closeTargetModal}>
          <div
            className={styles.editPanel}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="editPanelTitle"
            onKeyDown={onPanelKeyDown}
            onClick={e => e.stopPropagation()}
          >
            <h2 id="editPanelTitle" className={styles.editPanelTitle}>Edit monthly targets</h2>
            <p className={styles.editPanelSub}>
              Set the sales budget and KPI targets for {monthLabel}. Team totals update automatically.
            </p>

            {/* Sales budget */}
            <div className={styles.editPanelSection}>
              <div className={styles.editEyebrow}>Sales budget</div>
              <div className={styles.editField}>
                <label htmlFor="f-salesBudget">Monthly sales budget</label>
                <input
                  id="f-salesBudget"
                  ref={firstFieldRef}
                  type="number"
                  min="0"
                  step="1000"
                  className={styles.editInput}
                  value={editSalesBudget}
                  aria-invalid={!!fieldErrors.salesBudget}
                  aria-describedby={fieldErrors.salesBudget ? 'e-salesBudget' : undefined}
                  onChange={e => setEditSalesBudget(parseField(e.target.value))}
                />
                <span className={styles.editHelper}>{fmtDollars(editSalesBudget)}</span>
                {fieldErrors.salesBudget && (
                  <span id="e-salesBudget" className={styles.editError}>Enter a number of 0 or more</span>
                )}
              </div>
            </div>

            {/* Per-rep KPIs */}
            {['Ed', 'Mark'].map(r => (
              <div key={r} className={styles.editPanelSection}>
                <div className={styles.editEyebrow}>{r} Beatson</div>

                <div className={styles.editField}>
                  <label htmlFor={`f-${r}-calls`}>Connected calls</label>
                  <input
                    id={`f-${r}-calls`}
                    type="number" min="0" step="1"
                    className={styles.editInput}
                    value={editTargets[r].calls}
                    aria-invalid={!!fieldErrors[`${r}.calls`]}
                    aria-describedby={fieldErrors[`${r}.calls`] ? `e-${r}-calls` : undefined}
                    onChange={e => setEditTargets(prev => ({ ...prev, [r]: { ...prev[r], calls: parseField(e.target.value) } }))}
                  />
                  {fieldErrors[`${r}.calls`] && (
                    <span id={`e-${r}-calls`} className={styles.editError}>Enter a number of 0 or more</span>
                  )}
                </div>

                <div className={styles.editField}>
                  <label htmlFor={`f-${r}-visits`}>Face to face visits</label>
                  <input
                    id={`f-${r}-visits`}
                    type="number" min="0" step="1"
                    className={styles.editInput}
                    value={editTargets[r].visits}
                    aria-invalid={!!fieldErrors[`${r}.visits`]}
                    aria-describedby={fieldErrors[`${r}.visits`] ? `e-${r}-visits` : undefined}
                    onChange={e => setEditTargets(prev => ({ ...prev, [r]: { ...prev[r], visits: parseField(e.target.value) } }))}
                  />
                  {fieldErrors[`${r}.visits`] && (
                    <span id={`e-${r}-visits`} className={styles.editError}>Enter a number of 0 or more</span>
                  )}
                </div>

                <div className={styles.editField}>
                  <label htmlFor={`f-${r}-pipeline`}>Pipeline value</label>
                  <input
                    id={`f-${r}-pipeline`}
                    type="number" min="0" step="1000"
                    className={styles.editInput}
                    value={editTargets[r].pipeline}
                    aria-invalid={!!fieldErrors[`${r}.pipeline`]}
                    aria-describedby={fieldErrors[`${r}.pipeline`] ? `e-${r}-pipeline` : undefined}
                    onChange={e => setEditTargets(prev => ({ ...prev, [r]: { ...prev[r], pipeline: parseField(e.target.value) } }))}
                  />
                  <span className={styles.editHelper}>{fmtDollars(editTargets[r].pipeline)}</span>
                  {fieldErrors[`${r}.pipeline`] && (
                    <span id={`e-${r}-pipeline`} className={styles.editError}>Enter a number of 0 or more</span>
                  )}
                </div>
              </div>
            ))}

            {/* Team total */}
            <div className={styles.editTotal}>
              Team total: calls {teamCalls}, visits {teamVisits}, pipeline {fmtDollars(teamPipeline)}
            </div>

            {targetMsg && (
              <div
                className={targetMsgType === 'success' ? styles.editSuccess : styles.editErrorMsg}
                role={targetMsgType === 'success' ? 'status' : 'alert'}
              >
                {targetMsg}
              </div>
            )}

            <div className={styles.editActions}>
              <button className={styles.btnCancel} onClick={closeTargetModal}>Cancel</button>
              <button className={styles.btnSave} onClick={saveTargets} disabled={targetSaving}>
                {targetSaving ? 'Saving...' : 'Save targets'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── METRIC CARD ───────────────────────────────────────────────────────────────
function MetricCard({ icon, title, actual, target, isMoney, daysGone, daysInMonth, todayPct, onDrill, children }) {
  const p = pct(actual, target)
  const pace = paceStatus(actual, target, daysGone, daysInMonth)
  const displayActual = isMoney ? fmt(actual) : actual
  const displayTarget = isMoney ? fmt(target) : (target || '—')
  const daily = daysGone > 0 ? (isMoney ? fmt(actual / daysGone) + '/day' : (actual / daysGone).toFixed(1) + '/day') : '—'

  return (
    <article className={`${styles.card} ${styles.metricCard}`}>
      <div className={styles.metricHead}>
        <div className={styles.icon}>{icon}</div>
        <h3 className={styles.metricTitle}>{title}</h3>
      </div>
      <div className={styles.metricMain}>
        <div>
          <div className={`${styles.metricNumber} ${isMoney ? styles.money : ''}`}
            style={onDrill ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '4px' } : {}}
            onClick={onDrill}>{displayActual}</div>
          <div className={styles.targetLine}>of <em>{displayTarget}</em> target</div>
        </div>
        <div className={styles.miniPct}><strong>{p}%</strong>of target</div>
      </div>
      <div className={styles.progress}>
        <span className={styles.progressFill} style={{ width: `${p}%` }} />
        <span className={styles.progressMarker} style={{ left: `${todayPct}%` }} />
      </div>
      <div className={styles.paceRow}>
        <span className={pace.ahead ? styles.good : styles.bad}>{pace.diffPct}% {pace.ahead ? 'ahead of' : 'behind'} pace</span>
        <span>Daily avg: {daily}</span>
      </div>
      {children}
    </article>
  )
}

const PhoneIcon  = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.45h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>)
const PeopleIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>)
const DollarIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>)
const ClockIcon  = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>)
