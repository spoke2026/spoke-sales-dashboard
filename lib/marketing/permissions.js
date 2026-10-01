// Who may edit the Marketing tab: the admin, or anyone on public.mkt_editor
// (0008_marketing_editors.sql). RLS (public.mkt_can_edit()) is the real
// boundary; this decides what the page shows and lets routes fail early.

// Before 0008 is applied mkt_can_edit() doesn't exist, so fall back to the
// admin check rather than locking Ed out. Any other error means no.
const MISSING_FUNCTION = ['PGRST202', '42883']

export async function canEditMarketing(supabase) {
  const { data, error } = await supabase.rpc('mkt_can_edit')
  if (!error) return data === true
  if (!MISSING_FUNCTION.includes(error.code)) return false
  const admin = await supabase.rpc('is_admin')
  return !admin.error && admin.data === true
}
