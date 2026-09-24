import { describe, test, expect } from 'vitest'
import {
  OPTIONS,
  DEFINITION_FIELDS,
  STALE_MESSAGE,
  labelFor,
  canTransition,
  latestVersions,
  toStoredNumber,
  toDisplayNumber,
  formatExampleTarget,
  readStoredNumber,
  savedByLabel,
  validateDefinition,
  validateStatusChange,
  definitionChanged,
  mapDefinitionDbError,
} from './library.js'

const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'
const UUID_C = '33333333-3333-3333-3333-333333333333'
const GENERIC = { ok: false, status: 400, error: "We couldn't save that. Try again." }
const STALE = 'This KPI changed since you opened it. Refresh the page to see the latest version.'

function body(overrides = {}) {
  return {
    name: 'ZZ Test visits',
    description: 'Face-to-face visits logged.',
    kpiType: 'lead',
    unit: 'count',
    direction: 'higher',
    aggregation: 'sum',
    phasing: 'working_days',
    source: 'manual',
    sourceMapping: '',
    attributionMethod: 'entered_for_person',
    attributionNote: '',
    exampleTarget: '20',
    ...overrides,
  }
}

function updateBody(overrides = {}) {
  return { ...body(), id: UUID_A, version: 1, ...overrides }
}

function fieldErr(field, error) {
  return { ok: false, status: 400, field, error }
}

describe('OPTIONS and labelFor', () => {
  test('groups hold the values in the specified order', () => {
    expect(OPTIONS.kpiType.map(o => o.value)).toEqual(['lead', 'lag'])
    expect(OPTIONS.unit.map(o => o.value)).toEqual(['count', 'currency', 'percent', 'hours', 'days', 'multiple'])
    expect(OPTIONS.direction.map(o => o.value)).toEqual(['higher', 'lower'])
    expect(OPTIONS.aggregation.map(o => o.value)).toEqual(['sum', 'average', 'ratio', 'latest'])
    expect(OPTIONS.phasing.map(o => o.value)).toEqual(['working_days', 'calendar_days'])
    expect(OPTIONS.source.map(o => o.value)).toEqual(['hubspot', 'xero', 'forecast', 'manual'])
    expect(OPTIONS.attributionMethod.map(o => o.value)).toEqual(['record_owner', 'entered_for_person', 'company'])
    expect(OPTIONS.status.map(o => o.value)).toEqual(['proposed', 'published', 'retired'])
  })

  test('the lists are frozen', () => {
    expect(Object.isFrozen(OPTIONS)).toBe(true)
    expect(Object.isFrozen(OPTIONS.unit)).toBe(true)
    expect(Object.isFrozen(OPTIONS.unit[0])).toBe(true)
  })

  test('labels match the brief', () => {
    expect(labelFor('kpiType', 'lead')).toBe('Lead (drives future results)')
    expect(labelFor('unit', 'currency')).toBe('Dollars ($)')
    expect(labelFor('unit', 'multiple')).toBe('Multiple (×)')
    expect(labelFor('aggregation', 'ratio')).toBe('Ratio: one total divided by another')
    expect(labelFor('phasing', 'calendar_days')).toBe('Across every calendar day')
    expect(labelFor('source', 'forecast')).toBe('Forecast (forecast.spoke.nz)')
    expect(labelFor('attributionMethod', 'record_owner')).toBe("The record's owner in the source system")
    expect(labelFor('status', 'retired')).toBe('Retired')
  })

  test("labelFor('unit', 'furlongs') is 'Unknown', never blank", () => {
    expect(labelFor('unit', 'furlongs')).toBe('Unknown')
    expect(labelFor('unit', null)).toBe('Unknown')
  })

  test('an unknown group reads Unknown', () => {
    expect(labelFor('colour', 'lead')).toBe('Unknown')
    expect(labelFor('toString', 'lead')).toBe('Unknown')
  })

  test('DEFINITION_FIELDS is the create key list', () => {
    expect(DEFINITION_FIELDS).toEqual(Object.keys(body()))
  })
})

describe('canTransition', () => {
  test('allows exactly proposed→published, proposed→retired, published→retired', () => {
    expect(canTransition('proposed', 'published')).toBe(true)
    expect(canTransition('proposed', 'retired')).toBe(true)
    expect(canTransition('published', 'retired')).toBe(true)
  })

  test("nothing leaves retired: canTransition('retired', 'published') is false", () => {
    expect(canTransition('retired', 'published')).toBe(false)
    expect(canTransition('retired', 'proposed')).toBe(false)
    expect(canTransition('retired', 'retired')).toBe(false)
  })

  test("no going back: canTransition('published', 'proposed') is false", () => {
    expect(canTransition('published', 'proposed')).toBe(false)
    expect(canTransition('published', 'published')).toBe(false)
    expect(canTransition('proposed', 'proposed')).toBe(false)
  })

  test('unknown or inherited statuses are false', () => {
    expect(canTransition('draft', 'published')).toBe(false)
    expect(canTransition('toString', 'published')).toBe(false)
    expect(canTransition(undefined, 'retired')).toBe(false)
  })
})

describe('latestVersions', () => {
  const v1 = { id: UUID_A, version: 1, name: 'Visits', status: 'published' }
  const v2 = { id: UUID_A, version: 2, name: 'Visits', status: 'published' }
  const v3 = { id: UUID_A, version: 3, name: 'Visits', status: 'published' }

  test('ascending AND descending version order both return version 3 (divergence: first row seen wins)', () => {
    expect(latestVersions([v1, v2, v3])).toEqual([v3])
    expect(latestVersions([v3, v2, v1])).toEqual([v3])
    expect(latestVersions([v2, v3, v1])).toEqual([v3])
  })

  test('sorts by status (published, proposed, retired), then name case-insensitively', () => {
    const rows = [
      { id: UUID_A, version: 1, name: 'b retired', status: 'retired' },
      { id: UUID_B, version: 1, name: 'Zeta', status: 'proposed' },
      { id: UUID_C, version: 1, name: 'alpha', status: 'proposed' },
      { id: '44444444-4444-4444-4444-444444444444', version: 1, name: 'Beta', status: 'published' },
      { id: '55555555-5555-5555-5555-555555555555', version: 1, name: 'alpha', status: 'published' },
    ]
    expect(latestVersions(rows).map(r => r.name)).toEqual(['alpha', 'Beta', 'alpha', 'Zeta', 'b retired'])
    expect(latestVersions([...rows].reverse()).map(r => r.name)).toEqual(['alpha', 'Beta', 'alpha', 'Zeta', 'b retired'])
  })

  test('equal names keep a stable order and unknown statuses go last', () => {
    const rows = [
      { id: UUID_A, version: 1, name: 'Same', status: 'weird' },
      { id: UUID_B, version: 1, name: 'same', status: 'retired' },
      { id: UUID_C, version: 1, name: 'SAME', status: 'retired' },
    ]
    expect(latestVersions(rows).map(r => r.id)).toEqual([UUID_B, UUID_C, UUID_A])
  })

  test('uses the current row status, not an older version', () => {
    const old = { id: UUID_A, version: 1, name: 'Visits', status: 'proposed' }
    const cur = { id: UUID_A, version: 2, name: 'Visits', status: 'retired' }
    expect(latestVersions([cur, old])).toEqual([cur])
  })

  test('does not mutate its input and handles an empty list', () => {
    const rows = [v3, v1]
    const copy = [...rows]
    latestVersions(rows)
    expect(rows).toEqual(copy)
    expect(latestVersions([])).toEqual([])
  })
})

describe('toStoredNumber and toDisplayNumber', () => {
  test('only percent converts', () => {
    expect(toStoredNumber('percent', 29)).toBe(0.29)
    expect(toStoredNumber('count', 29)).toBe(29)
    expect(toDisplayNumber('currency', 12500)).toBe(12500)
  })

  test("toDisplayNumber('percent', 0.29) === 29 (divergence: 0.29 * 100 is 28.999999999999996)", () => {
    expect(0.29 * 100).not.toBe(29)
    expect(toDisplayNumber('percent', 0.29)).toBe(29)
  })

  test('percent round-trips: toDisplayNumber(toStoredNumber(57)) === 57', () => {
    expect(toDisplayNumber('percent', toStoredNumber('percent', 57))).toBe(57)
    expect(toDisplayNumber('percent', toStoredNumber('percent', 33.3))).toBe(33.3)
  })
})

describe('formatExampleTarget', () => {
  test('null reads Not set', () => {
    expect(formatExampleTarget('count', null)).toBe('Not set')
  })

  test('0 reads 0, not Not set (rule 3)', () => {
    expect(formatExampleTarget('count', 0)).toBe('0')
  })

  test('each unit', () => {
    expect(formatExampleTarget('count', 20)).toBe('20')
    expect(formatExampleTarget('currency', 12500)).toBe('$12,500')
    expect(formatExampleTarget('percent', 0.29)).toBe('29%')
    expect(formatExampleTarget('hours', 1)).toBe('1 hour')
    expect(formatExampleTarget('hours', 24)).toBe('24 hours')
    expect(formatExampleTarget('days', 1)).toBe('1 day')
    expect(formatExampleTarget('days', 5)).toBe('5 days')
    expect(formatExampleTarget('multiple', 3)).toBe('3×')
  })

  test('rounds to two decimals and groups thousands', () => {
    expect(formatExampleTarget('count', 1234.567)).toBe('1,234.57')
  })

  test('an unknown unit shows the plain number', () => {
    expect(formatExampleTarget('furlongs', 7)).toBe('7')
  })

  test('an unreadable stored value reads Unreadable, not Not set (rule 8)', () => {
    expect(formatExampleTarget('count', Number.NaN)).toBe('Unreadable')
    expect(formatExampleTarget('count', '20')).toBe('Unreadable')
    expect(formatExampleTarget('count', Infinity)).toBe('Unreadable')
  })
})

describe('readStoredNumber', () => {
  test('null and undefined are null; 0 stays 0', () => {
    expect(readStoredNumber(null)).toBeNull()
    expect(readStoredNumber(undefined)).toBeNull()
    expect(readStoredNumber(0)).toBe(0)
    expect(readStoredNumber(0.29)).toBe(0.29)
  })

  test('a numeric string converts at the boundary', () => {
    expect(readStoredNumber('0.29')).toBe(0.29)
    expect(readStoredNumber('0')).toBe(0)
  })

  test('anything unreadable is NaN, never null', () => {
    for (const raw of ['', 'abc', '-1', Infinity, Number.NaN, {}, true]) {
      expect(Number.isNaN(readStoredNumber(raw)), String(raw)).toBe(true)
    }
  })
})

describe('savedByLabel', () => {
  const people = [
    { full_name: 'No email', email: null },
    { full_name: 'Aroha Smith', email: 'aroha@example.test' },
  ]

  test('matches a person by email, case-insensitively', () => {
    expect(savedByLabel('Aroha@Example.test', people)).toBe('Aroha Smith')
  })

  test('falls back to the email, then Not recorded', () => {
    expect(savedByLabel('someone@example.test', people)).toBe('someone@example.test')
    expect(savedByLabel(null, people)).toBe('Not recorded')
    expect(savedByLabel(undefined, people)).toBe('Not recorded')
    expect(savedByLabel('  ', people)).toBe('Not recorded')
    expect(savedByLabel('x@example.test', [])).toBe('x@example.test')
  })
})

describe('validateDefinition: frozen body', () => {
  test('rejects non-object bodies', () => {
    expect(validateDefinition(null, 'create')).toEqual(GENERIC)
    expect(validateDefinition([], 'create')).toEqual(GENERIC)
    expect(validateDefinition('nope', 'create')).toEqual(GENERIC)
  })

  test('every create key removed in turn is rejected (divergence: frozen body not enforced)', () => {
    for (const key of Object.keys(body())) {
      const b = body()
      delete b[key]
      expect(validateDefinition(b, 'create'), key).toEqual(GENERIC)
    }
  })

  test('every update key removed in turn is rejected', () => {
    for (const key of Object.keys(updateBody())) {
      const b = updateBody()
      delete b[key]
      expect(validateDefinition(b, 'update'), key).toEqual(GENERIC)
    }
  })

  test("adding 'status' or an unknown key is rejected in both modes", () => {
    expect(validateDefinition(body({ status: 'published' }), 'create')).toEqual(GENERIC)
    expect(validateDefinition(body({ evil: 1 }), 'create')).toEqual(GENERIC)
    expect(validateDefinition(updateBody({ status: 'published' }), 'update')).toEqual(GENERIC)
  })

  test('create mode rejects id and version', () => {
    expect(validateDefinition(updateBody(), 'create')).toEqual(GENERIC)
  })

  test('update mode requires id and version', () => {
    expect(validateDefinition(body(), 'update')).toEqual(GENERIC)
  })

  test('a non-string where a string is expected is rejected', () => {
    for (const key of Object.keys(body())) {
      expect(validateDefinition(body({ [key]: 5 }), 'create'), key).toEqual(GENERIC)
      expect(validateDefinition(body({ [key]: null }), 'create'), key).toEqual(GENERIC)
    }
  })

  test('update rejects a bad id', () => {
    expect(validateDefinition(updateBody({ id: 'not-a-uuid' }), 'update')).toEqual(GENERIC)
    expect(validateDefinition(updateBody({ id: 42 }), 'update')).toEqual(GENERIC)
  })

  test('update rejects a version that is not an integer >= 1', () => {
    for (const version of [0, -1, 1.5, '1', null, Number.NaN]) {
      expect(validateDefinition(updateBody({ version }), 'update'), String(version)).toEqual(GENERIC)
    }
  })
})

describe('validateDefinition: fields', () => {
  test('name', () => {
    expect(validateDefinition(body({ name: '   ' }), 'create')).toEqual(fieldErr('name', 'Enter a KPI name.'))
    expect(validateDefinition(body({ name: 'a'.repeat(121) }), 'create')).toEqual(
      fieldErr('name', 'Keep the name under 120 characters.')
    )
    expect(validateDefinition(body({ name: ` ${'a'.repeat(120)} ` }), 'create').ok).toBe(true)
  })

  test('every field empty shows the name error first', () => {
    const empty = Object.fromEntries(Object.keys(body()).map(k => [k, '']))
    expect(validateDefinition(empty, 'create')).toEqual(fieldErr('name', 'Enter a KPI name.'))
  })

  test('description', () => {
    expect(validateDefinition(body({ description: ' ' }), 'create')).toEqual(
      fieldErr('description', 'Say what this KPI measures and why it matters.')
    )
    expect(validateDefinition(body({ description: 'a'.repeat(1001) }), 'create')).toEqual(
      fieldErr('description', 'Keep the description under 1,000 characters.')
    )
  })

  test('selects', () => {
    expect(validateDefinition(body({ kpiType: '' }), 'create')).toEqual(fieldErr('kpiType', 'Choose lead or lag.'))
    expect(validateDefinition(body({ unit: 'furlongs' }), 'create')).toEqual(fieldErr('unit', 'Choose a unit.'))
    expect(validateDefinition(body({ direction: '' }), 'create')).toEqual(
      fieldErr('direction', 'Choose whether higher or lower is better.')
    )
    expect(validateDefinition(body({ aggregation: '' }), 'create')).toEqual(
      fieldErr('aggregation', 'Choose how values combine.')
    )
    expect(validateDefinition(body({ phasing: '' }), 'create')).toEqual(
      fieldErr('phasing', 'Choose how the target is spread.')
    )
    expect(validateDefinition(body({ source: '' }), 'create')).toEqual(fieldErr('source', 'Choose a data source.'))
    expect(validateDefinition(body({ attributionMethod: '' }), 'create')).toEqual(
      fieldErr('attributionMethod', 'Choose who a result counts towards.')
    )
  })

  test('source mapping blank is null', () => {
    const r = validateDefinition(body({ source: 'hubspot', sourceMapping: '   ' }), 'create')
    expect(r.ok).toBe(true)
    expect(r.value.source_mapping).toBeNull()
  })

  test('source mapping over 4,000 characters', () => {
    const long = `{"a": "${'x'.repeat(4000)}"}`
    expect(validateDefinition(body({ source: 'hubspot', sourceMapping: long }), 'create')).toEqual(
      fieldErr('sourceMapping', 'Keep the source mapping under 4,000 characters.')
    )
  })

  test("'null', '[]', '\"x\"', '42', '[1]', and '{oops' give the JSON object message", () => {
    for (const text of ['null', '[]', '"x"', '42', '[1]', '{oops', 'true']) {
      expect(validateDefinition(body({ source: 'hubspot', sourceMapping: text }), 'create'), text).toEqual(
        fieldErr('sourceMapping', 'Enter the source mapping as a JSON object, or leave it blank.')
      )
    }
  })

  test("'{}' is accepted as {}", () => {
    const r = validateDefinition(body({ source: 'hubspot', sourceMapping: '{}' }), 'create')
    expect(r.ok).toBe(true)
    expect(r.value.source_mapping).toEqual({})
  })

  test('manual plus a mapping is rejected; automated plus a mapping is stored unchanged', () => {
    expect(validateDefinition(body({ source: 'manual', sourceMapping: '{"a": 1}' }), 'create')).toEqual(
      fieldErr('sourceMapping', "Manual KPIs don't use a source mapping. Clear this field.")
    )
    const r = validateDefinition(body({ source: 'xero', sourceMapping: '{"b": 1, "a": {"c": [1, 2]}}' }), 'create')
    expect(r.value.source_mapping).toEqual({ b: 1, a: { c: [1, 2] } })
  })

  test('attribution note', () => {
    expect(validateDefinition(body({ attributionNote: 'a'.repeat(301) }), 'create')).toEqual(
      fieldErr('attributionNote', 'Keep the note under 300 characters.')
    )
    expect(validateDefinition(body({ attributionNote: '  ' }), 'create').value.attribution).toEqual({
      method: 'entered_for_person',
      note: null,
    })
    expect(validateDefinition(body({ attributionNote: ' Only field reps. ' }), 'create').value.attribution).toEqual({
      method: 'entered_for_person',
      note: 'Only field reps.',
    })
  })

  test("exampleTarget '0' → example_target 0, not null (divergence: truthiness)", () => {
    const r = validateDefinition(body({ exampleTarget: '0' }), 'create')
    expect(r.ok).toBe(true)
    expect(r.value.example_target).toBe(0)
  })

  test('exampleTarget blank is null', () => {
    expect(validateDefinition(body({ exampleTarget: ' ' }), 'create').value.example_target).toBeNull()
  })

  test('exampleTarget rejects negatives, commas, symbols, and overflow', () => {
    for (const text of ['-5', '1,000', '$20', '20%', '1e3', '.5', '5.', 'abc', '9'.repeat(400)]) {
      expect(validateDefinition(body({ exampleTarget: text }), 'create'), text).toEqual(
        fieldErr('exampleTarget', 'Enter a number of 0 or more, without commas or symbols, or leave it blank.')
      )
    }
  })

  test('exampleTarget for percent is stored as a fraction', () => {
    expect(validateDefinition(body({ unit: 'percent', exampleTarget: '29' }), 'create').value.example_target).toBe(0.29)
    expect(validateDefinition(body({ unit: 'count', exampleTarget: ' 12.5 ' }), 'create').value.example_target).toBe(12.5)
  })

  test('a valid create body maps to DB column names', () => {
    expect(validateDefinition(body({ name: '  ZZ Test visits  ' }), 'create')).toEqual({
      ok: true,
      value: {
        name: 'ZZ Test visits',
        description: 'Face-to-face visits logged.',
        kpi_type: 'lead',
        unit: 'count',
        direction: 'higher',
        aggregation: 'sum',
        phasing: 'working_days',
        source: 'manual',
        source_mapping: null,
        attribution: { method: 'entered_for_person', note: null },
        example_target: 20,
      },
    })
  })

  test('a valid update body carries id and version', () => {
    const r = validateDefinition(updateBody({ version: 2 }), 'update')
    expect(r.ok).toBe(true)
    expect(r.value.id).toBe(UUID_A)
    expect(r.value.version).toBe(2)
  })

  test('does not mutate the body', () => {
    const b = body({ name: '  spaced  ' })
    const copy = { ...b }
    validateDefinition(b, 'create')
    expect(b).toEqual(copy)
  })
})

describe('validateStatusChange', () => {
  const ok = { id: UUID_A, version: 2, status: 'published' }

  test('accepts published and retired', () => {
    expect(validateStatusChange(ok)).toEqual({ ok: true, value: ok })
    expect(validateStatusChange({ ...ok, status: 'retired' }).ok).toBe(true)
  })

  test('rejects other statuses, bad ids, bad versions, and non-objects', () => {
    expect(validateStatusChange({ ...ok, status: 'proposed' })).toEqual(GENERIC)
    expect(validateStatusChange({ ...ok, id: 'x' })).toEqual(GENERIC)
    expect(validateStatusChange({ ...ok, id: 7 })).toEqual(GENERIC)
    expect(validateStatusChange({ ...ok, version: 0 })).toEqual(GENERIC)
    expect(validateStatusChange({ ...ok, version: '2' })).toEqual(GENERIC)
    expect(validateStatusChange(null)).toEqual(GENERIC)
    expect(validateStatusChange([])).toEqual(GENERIC)
  })

  test('the body is frozen', () => {
    expect(validateStatusChange({ ...ok, evil: 1 })).toEqual(GENERIC)
    expect(validateStatusChange({ id: UUID_A, version: 2 })).toEqual(GENERIC)
  })
})

describe('definitionChanged', () => {
  const row = {
    id: UUID_A,
    version: 2,
    status: 'published',
    created_at: '2026-09-24T01:02:03.123456+00:00',
    name: 'Visits',
    description: 'Visits logged.',
    kpi_type: 'lead',
    unit: 'count',
    direction: 'higher',
    aggregation: 'sum',
    phasing: 'working_days',
    source: 'hubspot',
    source_mapping: { a: 2, b: 1 },
    attribution: { note: null, method: 'record_owner' },
    example_target: 20,
  }
  const value = {
    id: UUID_A,
    version: 2,
    name: 'Visits',
    description: 'Visits logged.',
    kpi_type: 'lead',
    unit: 'count',
    direction: 'higher',
    aggregation: 'sum',
    phasing: 'working_days',
    source: 'hubspot',
    source_mapping: { b: 1, a: 2 },
    attribution: { method: 'record_owner', note: null },
    example_target: 20,
  }

  test('{ a: 2, b: 1 } row vs { b: 1, a: 2 } value is unchanged (divergence: JSON.stringify)', () => {
    expect(JSON.stringify(row.source_mapping)).not.toBe(JSON.stringify(value.source_mapping))
    expect(definitionChanged(row, value)).toBe(false)
  })

  test('nested { x: { b: 1, a: 2 } } vs { x: { a: 2, b: 1 } } is unchanged', () => {
    expect(
      definitionChanged({ ...row, source_mapping: { x: { a: 2, b: 1 } } }, { ...value, source_mapping: { x: { b: 1, a: 2 } } })
    ).toBe(false)
  })

  test('example_target null vs 0 is a change (divergence: null == 0 treated as equal)', () => {
    expect(definitionChanged({ ...row, example_target: null }, { ...value, example_target: 0 })).toBe(true)
    expect(definitionChanged({ ...row, example_target: 0 }, { ...value, example_target: null })).toBe(true)
  })

  test('every definition column is compared', () => {
    const changes = {
      name: 'Other',
      description: 'Other.',
      kpi_type: 'lag',
      unit: 'hours',
      direction: 'lower',
      aggregation: 'average',
      phasing: 'calendar_days',
      source: 'xero',
      source_mapping: { a: 3, b: 1 },
      attribution: { method: 'company', note: null },
      example_target: 21,
    }
    for (const [column, changed] of Object.entries(changes)) {
      expect(definitionChanged(row, { ...value, [column]: changed }), column).toBe(true)
    }
  })

  test('status, version, and timestamps are not definition columns', () => {
    expect(definitionChanged({ ...row, status: 'retired', version: 9, created_at: 'x' }, value)).toBe(false)
  })

  test('structure differences are changes', () => {
    expect(definitionChanged({ ...row, source_mapping: null }, value)).toBe(true)
    expect(definitionChanged(row, { ...value, source_mapping: null })).toBe(true)
    expect(definitionChanged({ ...row, source_mapping: { a: [1, 2] } }, { ...value, source_mapping: { a: { 0: 1, 1: 2 } } })).toBe(true)
    expect(definitionChanged({ ...row, source_mapping: { a: 1 } }, { ...value, source_mapping: { a: 1, b: 2 } })).toBe(true)
    expect(definitionChanged({ ...row, source_mapping: { a: 1 } }, { ...value, source_mapping: { b: 1 } })).toBe(true)
    expect(definitionChanged({ ...row, source_mapping: { a: '1' } }, { ...value, source_mapping: { a: 1 } })).toBe(true)
    expect(definitionChanged({ ...row, source_mapping: { a: [1, 2] } }, { ...value, source_mapping: { a: [1, 2] } })).toBe(false)
    expect(definitionChanged({ ...row, source_mapping: { a: [1, 2] } }, { ...value, source_mapping: { a: [2, 1] } })).toBe(true)
    expect(definitionChanged({ ...row, attribution: null }, value)).toBe(true)
  })
})

describe('mapDefinitionDbError', () => {
  test('23505 and the guard codes map to the stale 409', () => {
    for (const code of ['23505', 'KP001', 'KP002', 'KP003']) {
      expect(mapDefinitionDbError({ code, message: 'raw db text' }), code).toEqual({ status: 409, error: STALE })
    }
    expect(STALE_MESSAGE).toBe(STALE)
  })

  test('23514 maps to a 400 check message', () => {
    expect(mapDefinitionDbError({ code: '23514' })).toEqual({
      status: 400,
      error: "We couldn't save that. Check the details and try again.",
    })
  })

  test('42501 maps to a 403 access message', () => {
    expect(mapDefinitionDbError({ code: '42501' })).toEqual({
      status: 403,
      error: "We couldn't save that proposal. Ask the admin to check your access.",
    })
  })

  test('anything else, including null and a numeric code, maps to 500', () => {
    const fallback = { status: 500, error: "We couldn't save that. Try again." }
    expect(mapDefinitionDbError({ code: 'PGRST204' })).toEqual(fallback)
    expect(mapDefinitionDbError({ code: 23505 })).toEqual(fallback)
    expect(mapDefinitionDbError(null)).toEqual(fallback)
    expect(mapDefinitionDbError(undefined)).toEqual(fallback)
    expect(mapDefinitionDbError('23505')).toEqual(fallback)
  })

  test('never returns raw database text', () => {
    const r = mapDefinitionDbError({ code: 'XX000', message: 'relation "kpi_definition" does not exist' })
    expect(JSON.stringify(r)).not.toMatch(/relation|kpi_definition/)
  })
})
