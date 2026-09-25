// 0005_rest_test.mjs
// LOCAL TEST ONLY. Never point this at Supabase.
//
// Node 18+, no dependencies. Reads PGRST_URL (default http://127.0.0.1:54340)
// and PGRST_JWT_SECRET from env, signs HS256 JWTs with node:crypto for each
// persona, and runs the REST behaviour criteria and the audit-gate attacks
// against a local PostgREST sitting in front of the same local database that
// 0005_local_seed.sql and 0005_rls_test.sql already ran against. Prints PASS
// or FAIL per check and exits 1 on any failure.
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
const STAFF_SUB = '00000000-0000-0000-0000-000000000003'
const UNLINKED_SUB = '00000000-0000-0000-0000-000000000004'

const ADMIN_EMAIL = 'edward@spoke.nz'
const MANAGER_EMAIL = 'user1@example.test'
const STAFF_EMAIL = 'user2@example.test'
const UNLINKED_EMAIL = 'user3@example.test'

function personaToken(sub, email, extra = {}) {
  return sign({ sub, email, role: 'authenticated', iat: NOW, exp: EXP, ...extra })
}

const ADMIN = personaToken(ADMIN_SUB, ADMIN_EMAIL)
const MANAGER = personaToken(MANAGER_SUB, MANAGER_EMAIL)
const STAFF = personaToken(STAFF_SUB, STAFF_EMAIL)
const UNLINKED = personaToken(UNLINKED_SUB, UNLINKED_EMAIL)

const SAM_PERSON = '10000000-0000-0000-0000-000000000003'
const MIA_PERSON = '10000000-0000-0000-0000-000000000002'
const LEAD_A = '20000000-0000-0000-0000-000000000001'
const SEEDED_SC = '30000000-0000-0000-0000-000000000001'

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

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  // Audit gate attacks (Edward's REQUIRED additions)
  // ══════════════════════════════════════════════════════════════════════

  // Every attack runs as every persona: the admin, the line manager and the
  // staff member (both non-admin), and the signed-in user with no linked
  // person. Each must fail; the positive controls below prove the same
  // tokens can still make normal audited writes.
  const PERSONAS = [
    ['admin', ADMIN_SUB, ADMIN_EMAIL],
    ['manager', MANAGER_SUB, MANAGER_EMAIL],
    ['staff', STAFF_SUB, STAFF_EMAIL],
    ['unlinked', UNLINKED_SUB, UNLINKED_EMAIL],
  ]
  const auditBody = (sub, email) => ({
    entity: 'kpi_scorecard', entity_id: crypto.randomUUID(), action: 'insert', actor_id: sub, actor_email: email,
  })
  const SET_GATE = { setting_name: 'kpi.audit_writer', new_value: 'kpi_audit_row', is_local: true }

  for (const [label, sub, email] of PERSONAS) {
    const token = personaToken(sub, email)

    // (1) POST /rpc/set_config is not exposed: pg_catalog is never in
    // db-schemas, so PostgREST rejects it before touching the function.
    {
      const r = await rest('/rpc/set_config', { method: 'POST', token, body: SET_GATE })
      check(`${label}: POST /rpc/set_config is not exposed (404 PGRST202)`,
        r.status === 404 && r.json && r.json.code === 'PGRST202',
        `status=${r.status} code=${r.json && r.json.code}`)
    }
    {
      const r = await rest('/rpc/set_config', {
        method: 'POST', token, body: SET_GATE,
        headers: { 'content-profile': 'pg_catalog', 'accept-profile': 'pg_catalog' },
      })
      check(`${label}: POST /rpc/set_config with Content-Profile/Accept-Profile pg_catalog is rejected (406 PGRST106)`,
        r.status === 406 && r.json && r.json.code === 'PGRST106',
        `status=${r.status} code=${r.json && r.json.code}`)
    }

    // (4) POST /rpc/kpi_audit_row: RETURNS TRIGGER, revoked from everyone.
    {
      const r = await rest('/rpc/kpi_audit_row', { method: 'POST', token, body: {} })
      check(`${label}: POST /rpc/kpi_audit_row is not callable (404 PGRST202)`,
        r.status === 404 && r.json && r.json.code === 'PGRST202',
        `status=${r.status} code=${r.json && r.json.code}`)
    }

    // (3) Direct POST /kpi_audit_log, plain.
    {
      const r = await rest('/kpi_audit_log', { method: 'POST', token, body: auditBody(sub, email) })
      check(`${label}: direct POST /kpi_audit_log is rejected 403/42501`,
        r.status === 403 && r.json && r.json.code === '42501',
        `status=${r.status} code=${r.json && r.json.code}`)
    }

    // (2) Headers and JWT claims named like the GUC change nothing: PostgREST
    // never maps a client header or claim into a bare custom setting.
    for (const [what, headers] of [
      ['header "kpi.audit_writer: kpi_audit_row"', { 'kpi.audit_writer': 'kpi_audit_row' }],
      ['header "kpi-audit-writer: kpi_audit_row"', { 'kpi-audit-writer': 'kpi_audit_row' }],
    ]) {
      const r = await rest('/kpi_audit_log', { method: 'POST', token, headers, body: auditBody(sub, email) })
      check(`${label}: direct POST /kpi_audit_log with ${what} is rejected 403/42501`,
        r.status === 403 && r.json && r.json.code === '42501',
        `status=${r.status} code=${r.json && r.json.code}`)
    }
    for (const [what, extra] of [
      ['JWT claim "kpi.audit_writer"', { 'kpi.audit_writer': 'kpi_audit_row' }],
      ['nested JWT claim {"kpi":{"audit_writer":...}}', { kpi: { audit_writer: 'kpi_audit_row' } }],
    ]) {
      const r = await rest('/kpi_audit_log', {
        method: 'POST', token: personaToken(sub, email, extra), body: auditBody(sub, email),
      })
      check(`${label}: direct POST /kpi_audit_log with a ${what} is rejected 403/42501`,
        r.status === 403 && r.json && r.json.code === '42501',
        `status=${r.status} code=${r.json && r.json.code}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Positive controls through REST: an audited write succeeds and the audit
  // row appears under the right email, for staff, manager, and admin.
  // ══════════════════════════════════════════════════════════════════════

  let staffAssignmentId
  {
    // staff: own draft, target insert (fy2028 Q1 = Apr-Jun 2027, no collision
    // with the seeded fy2029 Q4 scorecard).
    const sc = await rest('/kpi_scorecard', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { person_id: SAM_PERSON, fy: 2028, quarter: 1 },
    })
    check('staff POST /kpi_scorecard (own draft, fy2028 Q1) succeeds',
      sc.status === 201 && Array.isArray(sc.json) && sc.json[0] && sc.json[0].id,
      `status=${sc.status}`)
    const scId = sc.json && sc.json[0] && sc.json[0].id

    const asg = await rest('/kpi_assignment', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { scorecard_id: scId, kpi_definition_id: LEAD_A, kpi_version: 1 },
    })
    check('staff POST /kpi_assignment (own draft) succeeds', asg.status === 201, `status=${asg.status}`)
    staffAssignmentId = asg.json && asg.json[0] && asg.json[0].id

    const tgt = await rest('/kpi_target', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { assignment_id: staffAssignmentId, month: '2027-04-01', value: 5 },
    })
    check('staff POST /kpi_target (own draft) succeeds', tgt.status === 201, `status=${tgt.status}`)
    const tgtId = tgt.json && tgt.json[0] && tgt.json[0].id

    const audit = await rest(`/kpi_audit_log?entity=eq.kpi_target&entity_id=eq.${tgtId}&action=eq.insert`, { token: ADMIN })
    check('audit row for the staff target insert carries the staff email',
      Array.isArray(audit.json) && audit.json.length === 1 && audit.json[0].actor_email === STAFF_EMAIL,
      `rows=${JSON.stringify(audit.json)}`)
  }

  {
    // manager: own draft, target insert.
    const sc = await rest('/kpi_scorecard', {
      method: 'POST', token: MANAGER, prefer: 'return=representation',
      body: { person_id: MIA_PERSON, fy: 2028, quarter: 1 },
    })
    check('manager POST /kpi_scorecard (own draft, fy2028 Q1) succeeds', sc.status === 201, `status=${sc.status}`)
    const scId = sc.json && sc.json[0] && sc.json[0].id

    const asg = await rest('/kpi_assignment', {
      method: 'POST', token: MANAGER, prefer: 'return=representation',
      body: { scorecard_id: scId, kpi_definition_id: LEAD_A, kpi_version: 1 },
    })
    const asgId = asg.json && asg.json[0] && asg.json[0].id

    const tgt = await rest('/kpi_target', {
      method: 'POST', token: MANAGER, prefer: 'return=representation',
      body: { assignment_id: asgId, month: '2027-04-01', value: 5 },
    })
    check('manager POST /kpi_target (own draft) succeeds', tgt.status === 201, `status=${tgt.status}`)
    const tgtId = tgt.json && tgt.json[0] && tgt.json[0].id

    const audit = await rest(`/kpi_audit_log?entity=eq.kpi_target&entity_id=eq.${tgtId}&action=eq.insert`, { token: ADMIN })
    check('audit row for the manager target insert carries the manager email',
      Array.isArray(audit.json) && audit.json.length === 1 && audit.json[0].actor_email === MANAGER_EMAIL,
      `rows=${JSON.stringify(audit.json)}`)
  }

  {
    // admin: kpi_team insert (the shipped 0+1 flow, still audited after 0005).
    const team = await rest('/kpi_team', {
      method: 'POST', token: ADMIN, prefer: 'return=representation',
      body: { name: 'ZZ Test 2b rest team admin' },
    })
    check('admin POST /kpi_team succeeds', team.status === 201, `status=${team.status}`)
    const teamId = team.json && team.json[0] && team.json[0].id

    const audit = await rest(`/kpi_audit_log?entity=eq.kpi_team&entity_id=eq.${teamId}&action=eq.insert`, { token: ADMIN })
    check('audit row for the admin kpi_team insert carries the admin email',
      Array.isArray(audit.json) && audit.json.length === 1 && audit.json[0].actor_email === ADMIN_EMAIL,
      `rows=${JSON.stringify(audit.json)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Combined: an audited write can't be used to smuggle a direct audit
  // insert in the same request chain (the SQL one-transaction reset case
  // covers the in-DB side; here each REST request is its own transaction,
  // so the gate is reset between them regardless).
  // ══════════════════════════════════════════════════════════════════════
  {
    const direct = await rest('/kpi_audit_log', {
      method: 'POST', token: STAFF,
      body: { entity: 'kpi_target', entity_id: crypto.randomUUID(), action: 'insert', actor_id: STAFF_SUB, actor_email: STAFF_EMAIL },
    })
    check('a direct audit insert straight after an audited REST write is still rejected 403/42501',
      direct.status === 403 && direct.json && direct.json.code === '42501',
      `status=${direct.status} code=${direct.json && direct.json.code}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2a regression through REST: proposals still work, non-admin writes to
  // kpi_person/kpi_team still 42501 and write no audit row.
  // ══════════════════════════════════════════════════════════════════════
  {
    const kpiId = crypto.randomUUID()
    const propose = await rest('/kpi_definition', {
      method: 'POST', token: MANAGER, prefer: 'return=representation',
      body: {
        id: kpiId, version: 1, name: 'ZZ Test 2b rest proposal', description: 'desc',
        kpi_type: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum',
        phasing: 'working_days', source: 'manual',
      },
    })
    check('non-admin POST /kpi_definition (propose) still succeeds', propose.status === 201, `status=${propose.status}`)

    const audit = await rest(`/kpi_audit_log?entity=eq.kpi_definition&entity_id=eq.${kpiId}&action=eq.insert`, { token: ADMIN })
    check('audit row for the non-admin KPI proposal carries their email',
      Array.isArray(audit.json) && audit.json.length === 1 && audit.json[0].actor_email === MANAGER_EMAIL,
      `rows=${JSON.stringify(audit.json)}`)
  }
  {
    const r = await rest('/kpi_person', {
      method: 'POST', token: MANAGER,
      body: { full_name: 'ZZ Test 2b rest non-admin person' },
    })
    check('non-admin POST /kpi_person is rejected 42501', r.status === 403 && r.json && r.json.code === '42501',
      `status=${r.status} code=${r.json && r.json.code}`)
  }
  {
    const r = await rest('/kpi_team', {
      method: 'POST', token: MANAGER,
      body: { name: 'ZZ Test 2b rest non-admin team' },
    })
    check('non-admin POST /kpi_team is rejected 42501', r.status === 403 && r.json && r.json.code === '42501',
      `status=${r.status} code=${r.json && r.json.code}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Admin: edit a KPI (2a's insert shape), publish, retire -- each audited.
  // ══════════════════════════════════════════════════════════════════════
  {
    const kpiId = crypto.randomUUID()
    const v1 = await rest('/kpi_definition', {
      method: 'POST', token: ADMIN, prefer: 'return=representation',
      body: {
        id: kpiId, version: 1, name: 'ZZ Test 2b rest edit flow', description: 'desc',
        kpi_type: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum',
        phasing: 'working_days', source: 'manual', status: 'proposed',
      },
    })
    check('admin creates a KPI to edit/publish/retire', v1.status === 201, `status=${v1.status}`)

    // "Edit": insert version 2 with the same status, as
    // app/api/kpi/definitions/route.js PATCH does.
    const v2 = await rest('/kpi_definition', {
      method: 'POST', token: ADMIN, prefer: 'return=representation',
      body: {
        id: kpiId, version: 2, status: 'proposed',
        name: 'ZZ Test 2b rest edit flow renamed', description: 'desc',
        kpi_type: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum',
        phasing: 'working_days', source: 'manual', source_mapping: null, attribution: null, example_target: null,
      },
    })
    check('admin edit (insert version 2) succeeds', v2.status === 201, `status=${v2.status}`)

    const editAudit = await rest(`/kpi_audit_log?entity=eq.kpi_definition&entity_id=eq.${kpiId}&action=eq.insert`, { token: ADMIN })
    check('audit rows for both kpi_definition inserts carry the admin email',
      Array.isArray(editAudit.json) && editAudit.json.length === 2
        && editAudit.json.every(row => row.actor_email === ADMIN_EMAIL),
      `rows=${JSON.stringify(editAudit.json)}`)

    // Publish: proposed -> published on the latest version.
    const publish = await rest(`/kpi_definition?id=eq.${kpiId}&version=eq.2`, {
      method: 'PATCH', token: ADMIN, prefer: 'return=representation',
      body: { status: 'published' },
    })
    check('admin publish (PATCH proposed -> published on latest version) succeeds',
      publish.status === 200, `status=${publish.status}`)

    // Retire: published -> retired.
    const retire = await rest(`/kpi_definition?id=eq.${kpiId}&version=eq.2`, {
      method: 'PATCH', token: ADMIN, prefer: 'return=representation',
      body: { status: 'retired' },
    })
    check('admin retire (PATCH published -> retired) succeeds', retire.status === 200, `status=${retire.status}`)

    const statusAudit = await rest(`/kpi_audit_log?entity=eq.kpi_definition&entity_id=eq.${kpiId}&action=eq.update`, { token: ADMIN })
    check('audit rows for publish and retire carry the admin email',
      Array.isArray(statusAudit.json) && statusAudit.json.length === 2
        && statusAudit.json.every(row => row.actor_email === ADMIN_EMAIL),
      `rows=${JSON.stringify(statusAudit.json)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Admin: kpi_person insert/update, kpi_company_closure insert/delete --
  // each writes an audit row with the admin email (the live DEPLOYMENT
  // step 5 re-check, exercised locally first).
  // ══════════════════════════════════════════════════════════════════════
  {
    const person = await rest('/kpi_person', {
      method: 'POST', token: ADMIN, prefer: 'return=representation',
      body: { full_name: 'ZZ Test 2b rest person' },
    })
    check('admin POST /kpi_person succeeds', person.status === 201, `status=${person.status}`)
    const personId = person.json && person.json[0] && person.json[0].id

    const insertAudit = await rest(`/kpi_audit_log?entity=eq.kpi_person&entity_id=eq.${personId}&action=eq.insert`, { token: ADMIN })
    check('audit row for the admin kpi_person insert carries the admin email',
      Array.isArray(insertAudit.json) && insertAudit.json.length === 1 && insertAudit.json[0].actor_email === ADMIN_EMAIL,
      `rows=${JSON.stringify(insertAudit.json)}`)

    const update = await rest(`/kpi_person?id=eq.${personId}`, {
      method: 'PATCH', token: ADMIN, prefer: 'return=representation',
      body: { full_name: 'ZZ Test 2b rest person renamed' },
    })
    check('admin PATCH /kpi_person succeeds', update.status === 200, `status=${update.status}`)

    const updateAudit = await rest(`/kpi_audit_log?entity=eq.kpi_person&entity_id=eq.${personId}&action=eq.update`, { token: ADMIN })
    check('audit row for the admin kpi_person update carries the admin email',
      Array.isArray(updateAudit.json) && updateAudit.json.length === 1 && updateAudit.json[0].actor_email === ADMIN_EMAIL,
      `rows=${JSON.stringify(updateAudit.json)}`)
  }
  {
    const closureDate = '2028-12-20'
    const insert = await rest('/kpi_company_closure', {
      method: 'POST', token: ADMIN, prefer: 'return=representation',
      body: { date: closureDate, reason: 'ZZ Test 2b rest closure' },
    })
    check('admin POST /kpi_company_closure succeeds', insert.status === 201, `status=${insert.status}`)

    const insertAudit = await rest(`/kpi_audit_log?entity=eq.kpi_company_closure&entity_id=eq.${closureDate}&action=eq.insert`, { token: ADMIN })
    check('audit row for the admin closure insert carries the admin email',
      Array.isArray(insertAudit.json) && insertAudit.json.length === 1 && insertAudit.json[0].actor_email === ADMIN_EMAIL,
      `rows=${JSON.stringify(insertAudit.json)}`)

    const del = await rest(`/kpi_company_closure?date=eq.${closureDate}`, { method: 'DELETE', token: ADMIN })
    check('admin DELETE /kpi_company_closure succeeds', del.status === 204, `status=${del.status}`)

    const delAudit = await rest(`/kpi_audit_log?entity=eq.kpi_company_closure&entity_id=eq.${closureDate}&action=eq.delete`, { token: ADMIN })
    check('audit row for the admin closure delete carries the admin email',
      Array.isArray(delAudit.json) && delAudit.json.length === 1 && delAudit.json[0].actor_email === ADMIN_EMAIL,
      `rows=${JSON.stringify(delAudit.json)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // REST behaviour criteria proper
  // ══════════════════════════════════════════════════════════════════════

  {
    // A manager PATCH on kpi_scorecard to status 'locked' with approval_kind
    // 'standard' on an incomplete scorecard -> 400 KS002.
    const sc = await rest('/kpi_scorecard', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { person_id: SAM_PERSON, fy: 2028, quarter: 2 },
    })
    const scId = sc.json && sc.json[0] && sc.json[0].id
    const asg = await rest('/kpi_assignment', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { scorecard_id: scId, kpi_definition_id: LEAD_A, kpi_version: 1 },
    })
    check('setup: staff assignment for the KS002 fixture succeeds', asg.status === 201, `status=${asg.status}`)
    const submit = await rest(`/kpi_scorecard?id=eq.${scId}`, {
      method: 'PATCH', token: STAFF, body: { status: 'submitted' },
    })
    check('setup: staff submit (no targets) for the KS002 fixture succeeds', submit.status === 204, `status=${submit.status}`)

    const approve = await rest(`/kpi_scorecard?id=eq.${scId}`, {
      method: 'PATCH', token: MANAGER,
      body: { status: 'locked', approval_kind: 'standard' },
    })
    check('manager PATCH to locked on an incomplete scorecard is 400 KS002',
      approve.status === 400 && approve.json && approve.json.code === 'KS002',
      `status=${approve.status} code=${approve.json && approve.json.code}`)
  }

  {
    // POST /rpc/kpi_scorecard_actions for the seeded staff draft.
    const asStaff = await rest('/rpc/kpi_scorecard_actions', {
      method: 'POST', token: STAFF, body: { p_scorecard_id: SEEDED_SC },
    })
    check('POST /rpc/kpi_scorecard_actions as staff on the seeded draft is ["edit","submit"]',
      Array.isArray(asStaff.json) && JSON.stringify(asStaff.json) === JSON.stringify(['edit', 'submit']),
      `status=${asStaff.status} body=${JSON.stringify(asStaff.json)}`)

    const asUnlinked = await rest('/rpc/kpi_scorecard_actions', {
      method: 'POST', token: UNLINKED, body: { p_scorecard_id: SEEDED_SC },
    })
    check('POST /rpc/kpi_scorecard_actions as an unlinked user on the seeded draft is []',
      Array.isArray(asUnlinked.json) && asUnlinked.json.length === 0,
      `status=${asUnlinked.status} body=${JSON.stringify(asUnlinked.json)}`)
  }

  {
    // kpi_remove_assignment through REST, on a fresh draft owned by staff.
    const sc = await rest('/kpi_scorecard', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { person_id: SAM_PERSON, fy: 2028, quarter: 3 },
    })
    const scId = sc.json && sc.json[0] && sc.json[0].id
    const asg = await rest('/kpi_assignment', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { scorecard_id: scId, kpi_definition_id: LEAD_A, kpi_version: 1 },
    })
    const asgId = asg.json && asg.json[0] && asg.json[0].id
    const tgt = await rest('/kpi_target', {
      method: 'POST', token: STAFF, prefer: 'return=representation',
      body: { assignment_id: asgId, month: '2027-10-01', value: 5 },
    })
    check('setup: staff target for the kpi_remove_assignment fixture succeeds', tgt.status === 201, `status=${tgt.status}`)

    const removed = await rest('/rpc/kpi_remove_assignment', {
      method: 'POST', token: STAFF, body: { p_assignment_id: asgId },
    })
    check('POST /rpc/kpi_remove_assignment as the owner on a draft returns 1',
      removed.status === 200 && removed.json === 1, `status=${removed.status} body=${JSON.stringify(removed.json)}`)

    const targetsAfter = await rest(`/kpi_target?assignment_id=eq.${asgId}`, { token: STAFF })
    check('GET /kpi_target for the removed assignment is []',
      Array.isArray(targetsAfter.json) && targetsAfter.json.length === 0,
      `body=${JSON.stringify(targetsAfter.json)}`)
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
