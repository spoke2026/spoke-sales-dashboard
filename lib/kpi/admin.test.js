import { describe, test, expect } from 'vitest'
import { Worker } from 'node:worker_threads'
import {
  validateTeam,
  validatePerson,
  validateClosure,
  wouldCreateManagerCycle,
  mapDbError,
} from './admin.js'

const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'
const UUID_C = '33333333-3333-3333-3333-333333333333'

const GENERIC = "We couldn't save that. Try again."

describe('validateTeam', () => {
  describe('create mode', () => {
    test('rejects a null body', () => {
      expect(validateTeam(null, 'create')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects an array body', () => {
      expect(validateTeam([], 'create')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a string body', () => {
      expect(validateTeam('nope', 'create')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects any key not in the frozen body', () => {
      const result = validateTeam({ name: 'ZZ Test team', evil: 1 }, 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a non-string name', () => {
      expect(validateTeam({ name: 42 }, 'create')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects an empty name after trim', () => {
      expect(validateTeam({ name: '   ' }, 'create')).toEqual({
        ok: false,
        status: 400,
        field: 'name',
        error: 'Enter a team name.',
      })
    })

    test('rejects a name over 80 characters', () => {
      expect(validateTeam({ name: 'a'.repeat(81) }, 'create')).toEqual({
        ok: false,
        status: 400,
        field: 'name',
        error: 'Keep the team name under 80 characters.',
      })
    })

    test('accepts a valid name and trims it', () => {
      expect(validateTeam({ name: '  ZZ Test team  ' }, 'create')).toEqual({
        ok: true,
        value: { name: 'ZZ Test team' },
      })
    })
  })

  describe('update mode', () => {
    test('rejects any key not in the frozen body', () => {
      const result = validateTeam({ id: UUID_A, name: 'ZZ Test team', active: true, evil: 1 }, 'update')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a missing required key', () => {
      const result = validateTeam({ id: UUID_A, name: 'ZZ Test team' }, 'update')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a non-uuid id', () => {
      const result = validateTeam({ id: 'not-a-uuid', name: 'ZZ Test team', active: true }, 'update')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a non-boolean active', () => {
      const result = validateTeam({ id: UUID_A, name: 'ZZ Test team', active: 'true' }, 'update')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects an invalid name', () => {
      const result = validateTeam({ id: UUID_A, name: '', active: true }, 'update')
      expect(result).toEqual({ ok: false, status: 400, field: 'name', error: 'Enter a team name.' })
    })

    test('accepts active: false, not rejected as falsy', () => {
      const result = validateTeam({ id: UUID_A, name: 'ZZ Test team', active: false }, 'update')
      expect(result).toEqual({ ok: true, value: { id: UUID_A, name: 'ZZ Test team', active: false } })
    })

    test('accepts a full valid update', () => {
      const result = validateTeam({ id: UUID_A, name: 'ZZ Test team', active: true }, 'update')
      expect(result).toEqual({ ok: true, value: { id: UUID_A, name: 'ZZ Test team', active: true } })
    })
  })
})

function validPersonCreateBody(overrides = {}) {
  return {
    fullName: 'ZZ Test person',
    email: null,
    primaryTeamId: null,
    managerId: null,
    isContractor: false,
    scorecardType: 'individual',
    ...overrides,
  }
}

function validPersonUpdateBody(overrides = {}) {
  return {
    ...validPersonCreateBody(),
    id: UUID_A,
    active: true,
    ...overrides,
  }
}

describe('validatePerson', () => {
  describe('create mode', () => {
    test('rejects a null body', () => {
      expect(validatePerson(null, 'create')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects an array body', () => {
      expect(validatePerson([], 'create')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects any key not in the frozen body', () => {
      const result = validatePerson(validPersonCreateBody({ evil: 1 }), 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a non-string fullName', () => {
      const result = validatePerson(validPersonCreateBody({ fullName: 42 }), 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects an empty fullName after trim', () => {
      const result = validatePerson(validPersonCreateBody({ fullName: '   ' }), 'create')
      expect(result).toEqual({
        ok: false,
        status: 400,
        field: 'fullName',
        error: "Enter the person's full name.",
      })
    })

    test('rejects a fullName over 120 characters', () => {
      const result = validatePerson(validPersonCreateBody({ fullName: 'a'.repeat(121) }), 'create')
      expect(result).toEqual({
        ok: false,
        status: 400,
        field: 'fullName',
        error: 'Keep the name under 120 characters.',
      })
    })

    test('accepts a null email', () => {
      const result = validatePerson(validPersonCreateBody({ email: null }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.email).toBeNull()
    })

    test('normalises an empty-string email to null', () => {
      const result = validatePerson(validPersonCreateBody({ email: '   ' }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.email).toBeNull()
    })

    test('rejects an invalid email', () => {
      const result = validatePerson(validPersonCreateBody({ email: 'not-an-email' }), 'create')
      expect(result).toEqual({
        ok: false,
        status: 400,
        field: 'email',
        error: 'Enter a valid email address.',
      })
    })

    test('rejects a non-string non-null email', () => {
      const result = validatePerson(validPersonCreateBody({ email: 42 }), 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('trims and lowercases a valid email', () => {
      const result = validatePerson(validPersonCreateBody({ email: '  ZZ.Test@Spoke.NZ  ' }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.email).toBe('zz.test@spoke.nz')
    })

    test('rejects an invalid primaryTeamId', () => {
      const result = validatePerson(validPersonCreateBody({ primaryTeamId: 'not-a-uuid' }), 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('accepts a null primaryTeamId', () => {
      const result = validatePerson(validPersonCreateBody({ primaryTeamId: null }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.primaryTeamId).toBeNull()
    })

    test('accepts a valid primaryTeamId', () => {
      const result = validatePerson(validPersonCreateBody({ primaryTeamId: UUID_B }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.primaryTeamId).toBe(UUID_B)
    })

    test('rejects an invalid managerId', () => {
      const result = validatePerson(validPersonCreateBody({ managerId: 'not-a-uuid' }), 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('accepts a null managerId', () => {
      const result = validatePerson(validPersonCreateBody({ managerId: null }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.managerId).toBeNull()
    })

    test('rejects a non-boolean isContractor', () => {
      const result = validatePerson(validPersonCreateBody({ isContractor: 'yes' }), 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('accepts isContractor: false, not rejected as falsy', () => {
      const result = validatePerson(validPersonCreateBody({ isContractor: false }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.isContractor).toBe(false)
    })

    test('rejects an invalid scorecardType', () => {
      const result = validatePerson(validPersonCreateBody({ scorecardType: 'team' }), 'create')
      expect(result).toEqual({
        ok: false,
        status: 400,
        field: 'scorecardType',
        error: 'Choose a scorecard type.',
      })
    })

    test('accepts scorecardType company_only', () => {
      const result = validatePerson(validPersonCreateBody({ scorecardType: 'company_only' }), 'create')
      expect(result.ok).toBe(true)
      expect(result.value.scorecardType).toBe('company_only')
    })

    test('accepts a full valid create body with no id or active in the result', () => {
      const result = validatePerson(validPersonCreateBody({ managerId: UUID_B }), 'create')
      expect(result).toEqual({
        ok: true,
        value: {
          fullName: 'ZZ Test person',
          email: null,
          primaryTeamId: null,
          managerId: UUID_B,
          isContractor: false,
          scorecardType: 'individual',
        },
      })
    })
  })

  describe('update mode', () => {
    test('rejects any key not in the frozen body', () => {
      const result = validatePerson(validPersonUpdateBody({ evil: 1 }), 'update')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a missing required key', () => {
      const body = validPersonUpdateBody()
      delete body.active
      expect(validatePerson(body, 'update')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a non-uuid id', () => {
      const result = validatePerson(validPersonUpdateBody({ id: 'nope' }), 'update')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a non-boolean active', () => {
      const result = validatePerson(validPersonUpdateBody({ active: 'true' }), 'update')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects managerId equal to id', () => {
      const result = validatePerson(validPersonUpdateBody({ id: UUID_A, managerId: UUID_A }), 'update')
      expect(result).toEqual({
        ok: false,
        status: 400,
        field: 'managerId',
        error: "A person can't be their own line manager.",
      })
    })

    test('accepts a null managerId in update mode without triggering the self-manager check', () => {
      const result = validatePerson(validPersonUpdateBody({ id: UUID_A, managerId: null }), 'update')
      expect(result.ok).toBe(true)
      expect(result.value.managerId).toBeNull()
    })

    test('accepts active: false, not rejected as falsy', () => {
      const result = validatePerson(validPersonUpdateBody({ active: false }), 'update')
      expect(result.ok).toBe(true)
      expect(result.value.active).toBe(false)
    })

    test('accepts a full valid update with id and active in the result', () => {
      const result = validatePerson(validPersonUpdateBody({ id: UUID_A, managerId: UUID_B, active: true }), 'update')
      expect(result).toEqual({
        ok: true,
        value: {
          fullName: 'ZZ Test person',
          email: null,
          primaryTeamId: null,
          managerId: UUID_B,
          isContractor: false,
          scorecardType: 'individual',
          id: UUID_A,
          active: true,
        },
      })
    })
  })
})

describe('validateClosure', () => {
  describe('delete mode', () => {
    test('rejects a null body', () => {
      expect(validateClosure(null, 'delete')).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects any key not in the frozen body', () => {
      const result = validateClosure({ date: '2028-11-15', evil: 1 }, 'delete')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects an invalid date', () => {
      const result = validateClosure({ date: 'banana' }, 'delete')
      expect(result).toEqual({ ok: false, status: 400, field: 'date', error: 'Pick a date.' })
    })

    test('accepts a valid date', () => {
      const result = validateClosure({ date: '2028-11-15' }, 'delete')
      expect(result).toEqual({ ok: true, value: { date: '2028-11-15' } })
    })
  })

  describe('create mode', () => {
    test('rejects any key not in the frozen body', () => {
      const result = validateClosure({ date: '2028-11-15', reason: 'ZZ Test closure', evil: 1 }, 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects a date that fails the regex', () => {
      const result = validateClosure({ date: 'banana', reason: 'ZZ Test closure' }, 'create')
      expect(result).toEqual({ ok: false, status: 400, field: 'date', error: 'Pick a date.' })
    })

    test('rejects a date that matches the regex but is not a real calendar date', () => {
      const result = validateClosure({ date: '2026-02-30', reason: 'ZZ Test closure' }, 'create')
      expect(result).toEqual({ ok: false, status: 400, field: 'date', error: 'Pick a date.' })
    })

    test('rejects a non-string date', () => {
      const result = validateClosure({ date: 20281115, reason: 'ZZ Test closure' }, 'create')
      expect(result).toEqual({ ok: false, status: 400, field: 'date', error: 'Pick a date.' })
    })

    test('rejects a non-string reason', () => {
      const result = validateClosure({ date: '2028-11-15', reason: 42 }, 'create')
      expect(result).toEqual({ ok: false, status: 400, error: GENERIC })
    })

    test('rejects an empty reason after trim', () => {
      const result = validateClosure({ date: '2028-11-15', reason: '   ' }, 'create')
      expect(result).toEqual({
        ok: false,
        status: 400,
        field: 'reason',
        error: 'Enter a reason, for example Christmas shutdown.',
      })
    })

    test('rejects a reason over 120 characters', () => {
      const result = validateClosure({ date: '2028-11-15', reason: 'a'.repeat(121) }, 'create')
      expect(result).toEqual({
        ok: false,
        status: 400,
        field: 'reason',
        error: 'Keep the reason under 120 characters.',
      })
    })

    test('accepts a valid closure and trims the reason', () => {
      const result = validateClosure({ date: '2028-11-15', reason: '  ZZ Test closure  ' }, 'create')
      expect(result).toEqual({ ok: true, value: { date: '2028-11-15', reason: 'ZZ Test closure' } })
    })

    test('accepts a leap day as a valid date', () => {
      const result = validateClosure({ date: '2028-02-29', reason: 'ZZ Test closure' }, 'create')
      expect(result.ok).toBe(true)
    })
  })
})

describe('wouldCreateManagerCycle', () => {
  test('is true when managerId equals personId', () => {
    expect(wouldCreateManagerCycle([], UUID_A, UUID_A)).toBe(true)
  })

  test('is false when the chain resolves to no manager', () => {
    const people = [{ id: UUID_A, manager_id: null }]
    expect(wouldCreateManagerCycle(people, null, UUID_A)).toBe(false)
  })

  test('is true when following manager_id upward reaches personId', () => {
    // A is being edited to report to B. B already reports to A.
    const people = [
      { id: UUID_A, manager_id: null },
      { id: UUID_B, manager_id: UUID_A },
    ]
    expect(wouldCreateManagerCycle(people, UUID_A, UUID_B)).toBe(true)
  })

  test('is false for an unrelated chain with a real manager', () => {
    const people = [
      { id: UUID_B, manager_id: UUID_C },
      { id: UUID_C, manager_id: null },
    ]
    expect(wouldCreateManagerCycle(people, UUID_A, UUID_B)).toBe(false)
  })

  // B and C already report to each other. personId (A) is unrelated, so the
  // walk never finds it and must stop via the step bound.
  const EXISTING_CYCLE = [
    { id: UUID_B, manager_id: UUID_C },
    { id: UUID_C, manager_id: UUID_B },
  ]

  test('stops after people.length steps on a pre-existing cycle', () => {
    expect(wouldCreateManagerCycle(EXISTING_CYCLE, UUID_A, UUID_B)).toBe(false)
  })

  // Runs the walk in a worker thread with a deadline. A synchronous infinite
  // loop cannot be interrupted by a test timeout, so without the worker a
  // missing step bound would hang the whole run instead of failing this test.
  test(
    'wouldCreateManagerCycle terminates on data that already contains a cycle',
    async () => {
      const code = `
        const { parentPort, workerData } = require('node:worker_threads')
        import(workerData.url).then(m => {
          parentPort.postMessage(m.wouldCreateManagerCycle(workerData.people, workerData.personId, workerData.managerId))
        })
      `
      const worker = new Worker(code, {
        eval: true,
        workerData: {
          url: new URL('./admin.js', import.meta.url).href,
          people: EXISTING_CYCLE,
          personId: UUID_A,
          managerId: UUID_B,
        },
      })
      const outcome = await Promise.race([
        new Promise(resolve => worker.once('message', value => resolve({ value }))),
        new Promise(resolve => setTimeout(() => resolve('did not terminate within 1500ms'), 1500)),
      ])
      await worker.terminate()
      expect(outcome).toEqual({ value: false })
    },
    { timeout: 5000 }
  )
})

describe('mapDbError', () => {
  test('maps 23505 for a team to the name field', () => {
    expect(mapDbError('team', { code: '23505' })).toEqual({
      status: 409,
      error: 'A team with that name already exists.',
      field: 'name',
    })
  })

  test('maps 23505 for a person to the email field', () => {
    expect(mapDbError('person', { code: '23505' })).toEqual({
      status: 409,
      error: 'A person with that email already exists.',
      field: 'email',
    })
  })

  test('maps 23505 for a closure to the date field', () => {
    expect(mapDbError('closure', { code: '23505' })).toEqual({
      status: 409,
      error: 'That date is already a closure.',
      field: 'date',
    })
  })

  test('maps 23503 to a generic reference error', () => {
    expect(mapDbError('person', { code: '23503' })).toEqual({
      status: 400,
      error: 'That team or person no longer exists. Refresh the page.',
    })
  })

  test('maps 23514 to a generic check-constraint error', () => {
    expect(mapDbError('team', { code: '23514' })).toEqual({
      status: 400,
      error: "We couldn't save that. Check the details and try again.",
    })
  })

  test('maps an unknown code to a 500', () => {
    expect(mapDbError('team', { code: '99999' })).toEqual({
      status: 500,
      error: "We couldn't save that. Try again.",
    })
  })

  test('maps a null error to a 500', () => {
    expect(mapDbError('team', null)).toEqual({
      status: 500,
      error: "We couldn't save that. Try again.",
    })
  })

  test('maps an error with no code to a 500', () => {
    expect(mapDbError('team', {})).toEqual({
      status: 500,
      error: "We couldn't save that. Try again.",
    })
  })
})

describe('frozen request bodies (rule 6)', () => {
  const BODIES = [
    ['validateTeam create', b => validateTeam(b, 'create'), { name: 'ZZ Test team' }],
    ['validateTeam update', b => validateTeam(b, 'update'), { id: UUID_A, name: 'ZZ Test team', active: true }],
    ['validatePerson create', b => validatePerson(b, 'create'), {
      fullName: 'ZZ Test person', email: 'zz.test@spoke.nz', primaryTeamId: null, managerId: null,
      isContractor: false, scorecardType: 'individual',
    }],
    ['validatePerson update', b => validatePerson(b, 'update'), {
      id: UUID_A, fullName: 'ZZ Test person', email: null, primaryTeamId: UUID_B, managerId: UUID_C,
      isContractor: true, scorecardType: 'company_only', active: false,
    }],
    ['validateClosure create', b => validateClosure(b, 'create'), { date: '2028-11-15', reason: 'ZZ Test closure' }],
    ['validateClosure delete', b => validateClosure(b, 'delete'), { date: '2028-11-15' }],
  ]

  for (const [name, validate, body] of BODIES) {
    test(`${name}: the full frozen body is accepted`, () => {
      expect(validate(body).ok).toBe(true)
    })
    for (const key of Object.keys(body)) {
      test(`${name}: a missing ${key} is rejected with the generic error`, () => {
        const partial = { ...body }
        delete partial[key]
        expect(validate(partial)).toEqual({ ok: false, status: 400, error: GENERIC })
      })
    }
    for (const extra of ['evil', 'role_admin', 'roleAdmin', 'hubspot_owner_id', 'xero_ref', 'full_name']) {
      test(`${name}: an unknown key ${extra} is rejected with the generic error`, () => {
        expect(validate({ ...body, [extra]: 1 })).toEqual({ ok: false, status: 400, error: GENERIC })
      })
    }
  }
})
