'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
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
  if (!daysGone) return { diff: 0, diffPct: 0, ahead: false }
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

// ── TODAY LINE PLUGIN ─────────────────────────────────────────────────────────
const todayLinePlugin = (daysGone, daysInMonth) => ({
  id: `todayLine_${daysGone}`,
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !scales.x) return
    // Use the x scale to get the exact pixel for day index (daysGone - 1)
    // The x axis has daysInMonth labels (0 to daysInMonth-1)
    // daysGone-1 is the index of today
    const todayIndex = daysGone - 1
    const todayX = scales.x.getPixelForValue(todayIndex)
    if (!todayX || isNaN(todayX)) return
    ctx.save()
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(64,81,79,0.5)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.moveTo(todayX, chartArea.top)
    ctx.lineTo(todayX, chartArea.bottom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#40514F'
    ctx.beginPath()
    ctx.rect(todayX - 18, chartArea.top, 36, 16)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 9px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Today', todayX, chartArea.top + 8)
    ctx.restore()
  }
})

// ── STAGE / OWNER MAPS ────────────────────────────────────────────────────────
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
  sales: {
    actual: 87400, budget: 150000,
    dailyActuals: [4200,8100,14300,19800,24500,31200,38900,44100,52000,61400,71200,78900,87400,...Array(18).fill(null)],
    lastMonthActual: 76200,
  },
  calls: {
    actual: 38, target: 60, details: [],
    dailyActuals: [2,4,6,7,9,11,14,16,18,21,24,27,30,...Array(18).fill(null)],
    lastMonth: 42,
  },
  visits: {
    actual: 11, target: 20,
    dailyActuals: [1,1,2,2,3,4,5,6,7,8,9,10,11,...Array(18).fill(null)],
    lastMonth: 9,
  },
  pipeline: {
    actual: 124000, target: 200000, details: [],
    dailyActuals: [8000,14000,22000,31000,38000,48000,62000,74000,86000,98000,108000,118000,124000,...Array(18).fill(null)],
    lastMonth: 98000,
  },
  dealAge: {
    avgDays: 17, lastMonthAvg: 22, total: 10,
    bands: [
      { label: '1–5 days',   min:1,  max:5,    count:2, deals:[{name:'Pivot Hort - Oilskins',days:3,stage:'Samples Sent'},{name:'Smedley #SO-00225',days:4,stage:'Waiting Stock'}] },
      { label: '6–10 days',  min:6,  max:10,   count:3, deals:[{name:'BK Developments',days:7},{name:'Seaview #SO-00227',days:8},{name:'Craigmore L FP',days:9}] },
      { label: '11–20 days', min:11, max:20,   count:3, deals:[{name:'Craigmore Colleen',days:12},{name:'Craggy Range FP',days:14},{name:'Waikiwi Vets',days:18}] },
      { label: '21+ days',   min:21, max:9999, count:2, deals:[{name:'Thornfield Estate',days:22},{name:'Alpine Dairy',days:28}] },
    ],
    history: [44,50,43,45,38,36,39,31,28,27,23,20,17],
  },
  meta: { month: '2026-05', rep: 'full-team', daysInMonth: 31, daysGone: 13, lastSynced: '2:28 PM' },
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData]                         = useState(MOCK)
  const [loading, setLoading]                   = useState(false)
  const [month, setMonth]                       = useState('2026-05')
  const [rep, setRep]                           = useState('full-team')
  const [drillBand, setDrillBand]               = useState(null)
  const [drillCalls, setDrillCalls]             = useState(null)
  const [drillPipeline, setDrillPipeline]       = useState(null)
  const [drillPipelineTotal, setDrillPipelineTotal] = useState(0)
  const [adminUnlocked, setAdminUnlocked]       = useState(false)
  const [showPinModal, setShowPinModal]         = useState(false)
  const [pin, setPin]                           = useState(['', '', '', ''])
  const [pinError, setPinError]                 = useState('')
  const pinRefs = [useRef(), useRef(), useRef(), useRef()]

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard?month=${month}&rep=${rep}`, { cache: 'no-store' })
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

  const { sales, calls, visits, pipeline, dealAge, meta } = data
  const { daysGone, daysInMonth } = meta
  const todayPct  = Math.round(daysGone / daysInMonth * 100)
  const labels    = dayLabels(daysInMonth, month)
  const salPace   = paceStatus(sales.actual, sales.budget, daysGone, daysInMonth)
  const forecast  = daysGone > 0 ? Math.round(sales.actual / daysGone * daysInMonth) : 0
  const monthPct  = Math.round(daysGone / daysInMonth * 100)

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

  function handlePinInput(i, val) {
    const next = [...pin]; next[i] = val; setPin(next)
    if (val && i < 3) pinRefs[i + 1].current?.focus()
  }

  function checkPin() {
    const entered = pin.join('')
    const correct = process.env.NEXT_PUBLIC_ADMIN_PIN || '1234'
    if (entered === correct) {
      setAdminUnlocked(true); setShowPinModal(false)
      setPin(['', '', '', '']); setPinError('')
    } else {
      setPinError('Incorrect PIN')
      setPin(['', '', '', '']); pinRefs[0].current?.focus()
    }
  }

  function openDrillPipeline() {
    setDrillPipeline(pipeline.details || [])
    setDrillPipelineTotal(pipeline.actual || 0)
  }

  return (
    <div className={styles.dashboard}>

      {/* ── HEADER ── */}
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <img src="/spoke-logo.png" alt="Spoke" className={styles.logoImg} />
          <div className={styles.divider} />
          <h1>Sales Performance Dashboard</h1>
        </div>
        <div className={styles.controls}>
          <select value={month} onChange={e => setMonth(e.target.value)}>
            <option value="2026-05">May 2026</option>
            <option value="2026-04">April 2026</option>
            <option value="2026-03">March 2026</option>
          </select>
          <select value={rep} onChange={e => setRep(e.target.value)}>
            <option value="full-team">Full Team</option>
            <option value="ed">Ed Beatson</option>
            <option value="mark">Mark Beatson</option>
          </select>
          <button
            className={`${styles.lockBtn} ${adminUnlocked ? styles.unlocked : ''}`}
            onClick={() => adminUnlocked ? setAdminUnlocked(false) : setShowPinModal(true)}
          >
            {adminUnlocked ? '🔓 Admin' : '🔒 Admin'}
          </button>
          <div className={styles.sync}>
            <span>{loading ? 'Syncing HubSpot...' : `Last synced from HubSpot · ${meta.lastSynced}`}</span>
            <i className={`${styles.dot} ${loading ? styles.dotPulse : ''}`} />
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main className={styles.main}>

        {/* TOP CARD — Sales */}
        <section className={`${styles.card} ${styles.topCard}`}>
          <div className={styles.salesLeft}>
            <div>
              <h2 className={styles.sectionLabel}>Actual Sales vs Budget</h2>
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
                plugins={[todayLinePlugin(daysGone, daysInMonth)]}
                data={{
                  labels,
                  datasets: [
                    { data: sales.dailyActuals, borderColor: '#40514F', backgroundColor: 'transparent', tension: 0.32, borderWidth: 3, pointRadius: 0, spanGaps: false },
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
            title="Outbound Phone Calls"
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
                plugins={[todayLinePlugin(daysGone, daysInMonth)]}
                data={{
                  labels,
                  datasets: [
                    { data: calls.dailyActuals, borderColor: '#40514F', backgroundColor: 'transparent', borderWidth: 2.5, tension: 0.35, pointRadius: 0, spanGaps: false },
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
            title="Face to Face Visits"
            actual={visits.actual}
            target={visits.target}
            isMoney={false}
            daysGone={daysGone}
            daysInMonth={daysInMonth}
            todayPct={todayPct}
          >
            <div className={styles.smallChartWrap}>
              <Line
                plugins={[todayLinePlugin(daysGone, daysInMonth)]}
                data={{
                  labels,
                  datasets: [
                    { data: visits.dailyActuals, borderColor: '#40514F', backgroundColor: 'transparent', borderWidth: 2.5, tension: 0.35, pointRadius: 0, spanGaps: false },
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
            title="Added Value to Pipeline"
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
                plugins={[todayLinePlugin(daysGone, daysInMonth)]}
                data={{
                  labels,
                  datasets: [
                    { data: pipeline.dailyActuals, backgroundColor: '#BEDA81', borderRadius: 3, barThickness: 5 },
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
                <div className={styles.daysText}>days · {dealAge.total || 0} active deals</div>
              </div>
              <div className={styles.miniPct}>
                <strong>
                  {dealAge.lastMonthAvg > 0
                    ? (dealAge.lastMonthAvg - dealAge.avgDays >= 0 ? '↓ ' : '↑ ') + Math.abs(dealAge.lastMonthAvg - dealAge.avgDays)
                    : '—'}
                </strong>
                vs<br />last month
              </div>
            </div>
            <div style={{ fontSize: '9px', color: 'var(--muted)', margin: '6px 0', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              By age band · click to drill
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', flex: 1 }}>
              {dealAge.bands.map((band, i) => (
                <button
                  key={i}
                  onClick={() => setDrillBand(band)}
                  style={{
                    background: i === 3 && band.count > 0 ? 'rgba(198,92,46,0.1)' : 'rgba(64,81,79,0.06)',
                    border: i === 3 && band.count > 0 ? '1px solid rgba(198,92,46,0.2)' : '1px solid transparent',
                    borderRadius: '8px', padding: '6px 8px', cursor: 'pointer',
                    textAlign: 'center', fontFamily: 'var(--font-sans)',
                  }}
                >
                  <div style={{ fontSize: '9px', color: 'var(--muted)' }}>{band.label}</div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', color: i === 3 && band.count > 0 ? 'var(--bad)' : 'var(--mineral)', lineHeight: 1 }}>{band.count}</div>
                  <div style={{ fontSize: '9px', color: 'var(--muted)' }}>deal{band.count !== 1 ? 's' : ''}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '6px' }}>
              Bespoke Ops · creation to Goods Shipped/Invoiced
            </div>
          </article>

        </section>
      </main>

      <footer className={styles.footer}>
        <span>All targets are monthly goals</span>
        <span>Data pulled live from HubSpot</span>
        <span>Times shown in NZT</span>
      </footer>

      {/* ── DEAL BAND DRILL MODAL ── */}
      {drillBand && (
        <div className={styles.overlay} onClick={() => setDrillBand(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>{drillBand.label} · {drillBand.count} deal{drillBand.count !== 1 ? 's' : ''}</h2>
            <p className={styles.modalSub}>Days from deal creation · Bespoke Operations · close date this month</p>
            <div className={styles.dealList}>
              {drillBand.deals.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>No deals in this range</div>
              ) : drillBand.deals.map((deal, i) => (
                <div key={i} className={styles.dealRow}>
                  <div>
                    <div className={styles.dealName}>{deal.name}</div>
                    {deal.stage && <div className={styles.dealMeta}>{deal.stage}</div>}
                  </div>
                  <div className={`${styles.dealBadge} ${deal.days > 15 ? styles.badgeWarn : styles.badgeOk}`}>
                    {deal.days}d
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={() => setDrillBand(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CALLS DRILL MODAL ── */}
      {drillCalls && (
        <div className={styles.overlay} onClick={() => setDrillCalls(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2>Outbound Calls · {drillCalls.length} connected this month</h2>
            <p className={styles.modalSub}>Connected outbound calls · most recent first · click outside to close</p>
            <div className={styles.dealList}>
              {drillCalls.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>No calls found</div>
              ) : drillCalls.map((call, i) => {
                const nzt = new Date(new Date(call.date).getTime() + 12 * 60 * 60 * 1000)
                return (
                  <div key={i} className={styles.dealRow}>
                    <div>
                      <div className={styles.dealName}>{call.title}</div>
                      <div className={styles.dealMeta}>
                        {nzt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} · {nzt.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })} · {OWNERS[call.owner] || 'Unknown'}
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

      {/* ── PIPELINE DRILL MODAL ── */}
      {drillPipeline && (
        <div className={styles.overlay} onClick={() => setDrillPipeline(null)}>
          <div className={styles.modal} style={{ width: '560px' }} onClick={e => e.stopPropagation()}>
            <h2>New Pipeline · {drillPipeline.length} deals added this month</h2>
            <p className={styles.modalSub}>Revenue Train pipeline · new deals created this month · click outside to close</p>
            <div className={styles.dealList}>
              {drillPipeline.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>No deals added this month</div>
              ) : drillPipeline.map((deal, i) => {
                const nzt = new Date(new Date(deal.date).getTime() + 12 * 60 * 60 * 1000)
                return (
                  <div key={i} className={styles.dealRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.dealName}>{deal.name}</div>
                      <div className={styles.dealMeta}>
                        {RT_STAGES[deal.stage] || deal.stage} · {OWNERS[deal.owner] || 'Unknown'} · {nzt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
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
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Total: <strong style={{ color: 'var(--ink)' }}>${drillPipelineTotal.toLocaleString()}</strong>
              </span>
              <button className={styles.btnCancel} onClick={() => setDrillPipeline(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PIN MODAL ── */}
      {showPinModal && (
        <div className={styles.overlay} onClick={() => setShowPinModal(false)}>
          <div className={styles.modal} style={{ width: '300px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <h2>Admin access</h2>
            <p className={styles.modalSub}>Enter your 4-digit PIN to edit targets</p>
            <div className={styles.pinRow}>
              {[0, 1, 2, 3].map(i => (
                <input
                  key={i}
                  ref={pinRefs[i]}
                  type="password"
                  maxLength={1}
                  value={pin[i]}
                  className={styles.pinDigit}
                  onChange={e => handlePinInput(i, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && checkPin()}
                />
              ))}
            </div>
            {pinError && <div className={styles.pinError}>{pinError}</div>}
            <div className={styles.modalActions} style={{ justifyContent: 'center' }}>
              <button className={styles.btnCancel} onClick={() => setShowPinModal(false)}>Cancel</button>
              <button className={styles.btnSave} onClick={checkPin}>Unlock</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── METRIC CARD COMPONENT ─────────────────────────────────────────────────────
function MetricCard({ icon, title, actual, target, isMoney, daysGone, daysInMonth, todayPct, onDrill, children }) {
  const p = pct(actual, target)
  const pace = paceStatus(actual, target, daysGone, daysInMonth)
  const displayActual = isMoney ? fmt(actual) : actual
  const displayTarget = isMoney ? fmt(target) : target
  const daily = daysGone > 0
    ? isMoney ? fmt(actual / daysGone) + '/day' : (actual / daysGone).toFixed(1) + '/day'
    : '—'

  return (
    <article className={`${styles.card} ${styles.metricCard}`}>
      <div className={styles.metricHead}>
        <div className={styles.icon}>{icon}</div>
        <h3 className={styles.metricTitle}>{title}</h3>
      </div>
      <div className={styles.metricMain}>
        <div>
          <div
            className={`${styles.metricNumber} ${isMoney ? styles.money : ''}`}
            style={onDrill ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '4px' } : {}}
            onClick={onDrill}
          >{displayActual}</div>
          <div className={styles.targetLine}>of <em>{displayTarget}</em> target</div>
        </div>
        <div className={styles.miniPct}>
          <strong>{p}%</strong>of target
        </div>
      </div>
      <div className={styles.progress}>
        <span className={styles.progressFill} style={{ width: `${p}%` }} />
        <span className={styles.progressMarker} style={{ left: `${todayPct}%` }} />
      </div>
      <div className={styles.paceRow}>
        <span className={pace.ahead ? styles.good : styles.bad}>
          {pace.diffPct}% {pace.ahead ? 'ahead of' : 'behind'} pace
        </span>
        <span>Daily avg: {daily}</span>
      </div>
      {children}
    </article>
  )
}

// ── ICONS ─────────────────────────────────────────────────────────────────────
const PhoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.45h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
)
const PeopleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)
const DollarIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
)
const ClockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)
