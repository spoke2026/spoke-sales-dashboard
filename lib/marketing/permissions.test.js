import { describe, it, expect } from 'vitest'
import { canEditMarketing } from './permissions.js'

function fakeSupabase(answers) {
  const calls = []
  return {
    calls,
    rpc: async name => {
      calls.push(name)
      return answers[name]
    },
  }
}

describe('canEditMarketing', () => {
  it('lets in the admin and marketing editors', async () => {
    expect(await canEditMarketing(fakeSupabase({ mkt_can_edit: { data: true, error: null } }))).toBe(true)
  })

  it('keeps everyone else out', async () => {
    expect(await canEditMarketing(fakeSupabase({ mkt_can_edit: { data: false, error: null } }))).toBe(false)
    expect(await canEditMarketing(fakeSupabase({ mkt_can_edit: { data: null, error: null } }))).toBe(false)
  })

  it('falls back to the admin check before 0008 is applied', async () => {
    const missing = { data: null, error: { code: 'PGRST202' } }
    const ed = fakeSupabase({ mkt_can_edit: missing, is_admin: { data: true, error: null } })
    expect(await canEditMarketing(ed)).toBe(true)
    expect(ed.calls).toEqual(['mkt_can_edit', 'is_admin'])
    const other = fakeSupabase({ mkt_can_edit: { data: null, error: { code: '42883' } }, is_admin: { data: false, error: null } })
    expect(await canEditMarketing(other)).toBe(false)
    const broken = fakeSupabase({ mkt_can_edit: missing, is_admin: { data: null, error: { code: 'x' } } })
    expect(await canEditMarketing(broken)).toBe(false)
  })

  it('fails closed on any other error', async () => {
    const s = fakeSupabase({ mkt_can_edit: { data: null, error: { code: '08006' } } })
    expect(await canEditMarketing(s)).toBe(false)
    expect(s.calls).toEqual(['mkt_can_edit'])
  })
})
