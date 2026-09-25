// 0006_rest_test.mjs
// LOCAL TEST ONLY. Never point this at Supabase.
//
// Node 18+, no dependencies. Reads PGRST_URL (default http://127.0.0.1:54340)
// and PGRST_JWT_SECRET from env, signs HS256 JWTs with node:crypto for each
// persona, and runs the REST behaviour criteria against a local PostgREST
// sitting in front of the same local database that 0005_local_seed.sql,
// 0006_local_seed.sql, 0005_rls_test.sql, and 0006_rls_test.sql already ran
// against. Prints PASS or FAIL per check and exits 1 on any failure.
//
// Run PostgREST with supabase/test/local_postgrest_roles.sql already applied
// and a config pointing db-uri at postgres://authenticator:local-authenticator@
// localhost:54329/<the seeded database>, db-schemas "public", db-anon-role
// "anon", and jwt-secret matching PGRST_JWT_SECRET below.

import crypto from 'node:crypto'

const PGRST_URL = process.env.PGRST_URL || 'http://127.0.0.1:54340'
const SECRET = process.env.PGRST_JWT_SECRET || 'local-streamA-jwt-secret-0123456789-abcdefgh'

const b64 = s => Buffer.from(s).toString('base64url')
function sign(claims) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(claims))
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

const NOW = Math.floor(Date.now() / 1000)
const EXP = NOW + 3600

const ADMIN_SUB = '00000000-0000-0000-0000-000000000001'
const MANAGER_SUB = '00000000-0000-0000-0000-000000000002'
const TIA_SUB = '00000000-0000-0000-0000-000000000006'
const UNLINKED_SUB = '00000000-0000-0000-0000-000000000004'

const ADMIN_EMAIL = 'edward@spoke.nz'
const MANAGER_EMAIL = 'user1@example.test'
const TIA_EMAIL = 'user5@example.test'
const UNLINKED_EMAIL = 'user3@example.test'

function personaToken(sub, email, extra = {}) {
  return sign({ sub, email, role: 'authenticated', iat: NOW, exp: EXP, ...extra })
}

const ADMIN = personaToken(ADMIN_SUB, ADMIN_EMAIL)
const MANAGER = personaToken(MANAGER_SUB, MANAGER_EMAIL)
const TIA = personaToken(TIA_SUB, TIA_EMAIL)
const UNLINKED = personaToken(UNLINKED_SUB, UNLINKED_EMAIL)

const TIA_PERSON = '10000000-0000-0000-0000-000000000008'
const M_SUM = '20000000-0000-0000-0000-000000000010'

let passed = 0
let failed = 0
const failures = []

async function rest(path, { method = 'GET', token, body, headers = {}, prefer } = {}) {
  const h = { 'content-type': 'application/json', ...headers }
  if (token) h.authorization = `Bearer ${token}`
  if (prefer) h.prefer = prefer
  const res = await fetch(`${PGRST_URL}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}

function check(name, condition, detail) {
  if (condition) {
    passed++
    console.log(`PASS: ${name}${detail ? ' -- ' + detail : ''}`)
  } else {
    failed++
    failures.push(name)
    console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`)
  }
}

async function nzDateToday() {
  // Read the same Auckland "today" the database uses, through the RPC, so
  // this test works on any run date.
  const r = await rest('/rpc/kpi_nz_date', { method: 'POST', token: ADMIN, body: { p_at: new Date().toISOString() } })
  return r.json
}

async function main() {
  const today = await nzDateToday()
  check('setup: read today (Auckland) through kpi_nz_date', typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today),
    `today=${today}`)

  // ══════════════════════════════════════════════════════════════════════
  // Merge-duplicates upsert as the owner, twice with different values.
  // ══════════════════════════════════════════════════════════════════════
  {
    const first = await rest('/kpi_manual_entry', {
      method: 'POST', token: TIA,
      prefer: 'resolution=merge-duplicates,return=representation',
      headers: {},
      body: { person_id: TIA_PERSON, kpi_definition_id: M_SUM, date: today, value: 4 },
    })
    check('POST /kpi_manual_entry with merge-duplicates, first value, succeeds (201)',
      first.status === 201, `status=${first.status} body=${JSON.stringify(first.json)}`)

    const withOnConflict = `/kpi_manual_entry?on_conflict=person_id,kpi_definition_id,date`
    const second = await rest(withOnConflict, {
      method: 'POST', token: TIA,
      prefer: 'resolution=merge-duplicates,return=representation',
      body: { person_id: TIA_PERSON, kpi_definition_id: M_SUM, date: today, value: 12 },
    })
    check('POST /kpi_manual_entry with merge-duplicates, second value, succeeds (200 or 201)',
      second.status === 200 || second.status === 201, `status=${second.status} body=${JSON.stringify(second.json)}`)

    const rows = await rest(`/kpi_manual_entry?person_id=eq.${TIA_PERSON}&kpi_definition_id=eq.${M_SUM}&date=eq.${today}`,
      { token: TIA })
    check('exactly one kpi_manual_entry row for that key, holding the second value',
      Array.isArray(rows.json) && rows.json.length === 1 && Number(rows.json[0].value) === 12,
      `rows=${JSON.stringify(rows.json)}`)

    const actual = await rest(`/kpi_actual_daily?person_id=eq.${TIA_PERSON}&kpi_definition_id=eq.${M_SUM}&date=eq.${today}`,
      { token: TIA })
    check('GET /kpi_actual_daily for that key shows the same value with source manual',
      Array.isArray(actual.json) && actual.json.length === 1
        && Number(actual.json[0].value) === 12 && actual.json[0].source === 'manual',
      `rows=${JSON.stringify(actual.json)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // The same POST for today - 8 -> 400 KS017.
  // ══════════════════════════════════════════════════════════════════════
  {
    const d = new Date(today + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - 8)
    const eightDaysAgo = d.toISOString().slice(0, 10)

    const r = await rest('/kpi_manual_entry', {
      method: 'POST', token: TIA, prefer: 'return=representation',
      body: { person_id: TIA_PERSON, kpi_definition_id: M_SUM, date: eightDaysAgo, value: 3 },
    })
    check('POST /kpi_manual_entry for today - 8 is 400 KS017',
      r.status === 400 && r.json && r.json.code === 'KS017',
      `status=${r.status} code=${r.json && r.json.code}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Forged writes to kpi_actual_daily as Tia.
  // ══════════════════════════════════════════════════════════════════════
  {
    const d = new Date(today + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - 50)
    const oldDay = d.toISOString().slice(0, 10)

    const forge = await rest('/kpi_actual_daily', {
      method: 'POST', token: TIA,
      body: { person_id: TIA_PERSON, kpi_definition_id: M_SUM, kpi_version: 1, date: oldDay, value: 77, source: 'manual' },
    })
    check('POST /kpi_actual_daily as Tia with a forged manual row (no matching entry) is 403 42501',
      forge.status === 403 && forge.json && forge.json.code === '42501',
      `status=${forge.status} code=${forge.json && forge.json.code}`)

    const patch = await rest(`/kpi_actual_daily?person_id=eq.${TIA_PERSON}&kpi_definition_id=eq.${M_SUM}&date=eq.${today}`, {
      method: 'PATCH', token: TIA, body: { value: 999 },
    })
    check('PATCH /kpi_actual_daily on Tia\'s manual row (to a different value) is 403 42501',
      patch.status === 403 && patch.json && patch.json.code === '42501',
      `status=${patch.status} code=${patch.json && patch.json.code}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // DELETE /kpi_manual_entry -- no delete policy, row stays.
  // ══════════════════════════════════════════════════════════════════════
  {
    const del = await rest(`/kpi_manual_entry?person_id=eq.${TIA_PERSON}&kpi_definition_id=eq.${M_SUM}&date=eq.${today}`, {
      method: 'DELETE', token: TIA, prefer: 'return=representation',
    })
    check('DELETE /kpi_manual_entry on Tia\'s row returns [] (Prefer: return=representation)',
      Array.isArray(del.json) && del.json.length === 0, `status=${del.status} body=${JSON.stringify(del.json)}`)

    const stillThere = await rest(`/kpi_manual_entry?person_id=eq.${TIA_PERSON}&kpi_definition_id=eq.${M_SUM}&date=eq.${today}`,
      { token: TIA })
    check('the row still exists after the DELETE attempt',
      Array.isArray(stillThere.json) && stillThere.json.length === 1,
      `rows=${JSON.stringify(stillThere.json)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // POST /rpc/kpi_window_targets as Tia returns only locked-scorecard rows.
  // ══════════════════════════════════════════════════════════════════════
  {
    // The function caps p_end - p_start at 365 days, so this queries a
    // 180-day window around today (well under the cap) rather than the whole
    // calendar, which would return 0 rows regardless and prove nothing.
    const from = new Date(today + 'T00:00:00Z'); from.setUTCDate(from.getUTCDate() - 90)
    const to = new Date(today + 'T00:00:00Z'); to.setUTCDate(to.getUTCDate() + 90)
    const r = await rest('/rpc/kpi_window_targets', {
      method: 'POST', token: TIA,
      body: { p_person_id: TIA_PERSON, p_start: from.toISOString().slice(0, 10), p_end: to.toISOString().slice(0, 10) },
    })
    const rows = Array.isArray(r.json) ? r.json : []
    const scorecardIds = [...new Set(rows.map(row => row.scorecard_id))]
    let allLocked = true
    for (const scId of scorecardIds) {
      const sc = await rest(`/kpi_scorecard?id=eq.${scId}&select=status`, { token: TIA })
      if (!Array.isArray(sc.json) || sc.json.length !== 1 || sc.json[0].status !== 'locked') allLocked = false
    }
    check('POST /rpc/kpi_window_targets as Tia returns only locked-scorecard rows',
      rows.length > 0 && allLocked, `rows=${rows.length} distinct_scorecards=${scorecardIds.length} all_locked=${allLocked}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // POST /rpc/kpi_entry_people as an unlinked user -> [].
  // ══════════════════════════════════════════════════════════════════════
  {
    const r = await rest('/rpc/kpi_entry_people', { method: 'POST', token: UNLINKED, body: {} })
    check('POST /rpc/kpi_entry_people as an unlinked user is []',
      Array.isArray(r.json) && r.json.length === 0, `status=${r.status} body=${JSON.stringify(r.json)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Regression: POST /rpc/set_config is still not exposed.
  // ══════════════════════════════════════════════════════════════════════
  {
    const r = await rest('/rpc/set_config', {
      method: 'POST', token: ADMIN,
      body: { setting_name: 'kpi.audit_writer', new_value: 'kpi_audit_row', is_local: true },
    })
    check('POST /rpc/set_config is not exposed (404)', r.status === 404, `status=${r.status}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Manager entering for Tia (report) via REST also works end to end.
  // ══════════════════════════════════════════════════════════════════════
  {
    const d = new Date(today + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - 15)
    const day = d.toISOString().slice(0, 10)
    const r = await rest('/kpi_manual_entry', {
      method: 'POST', token: MANAGER, prefer: 'return=representation',
      body: { person_id: TIA_PERSON, kpi_definition_id: M_SUM, date: day, value: 6 },
    })
    check('manager POST /kpi_manual_entry for their report Tia succeeds', r.status === 201, `status=${r.status}`)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log('Failing checks:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch(e => {
  console.error('REST TEST CRASHED:', e)
  process.exit(1)
})
