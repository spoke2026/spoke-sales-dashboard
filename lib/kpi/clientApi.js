// Shared browser fetch helpers for the KPI client forms (rule 7: one
// implementation). Moved verbatim from app/kpis/admin/AdminPanels.js so the
// admin panels and the KPI library forms share one copy.

export async function callApi(url, method, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { status: res.status, json }
  } catch {
    return { status: 0, json: null }
  }
}

export function describeError(status, json, recognizedFields) {
  if (status === 401) return { redirect: true }
  if (status === 403) {
    return { alert: json && typeof json.error === 'string' ? json.error : 'Only the admin can make changes here.' }
  }
  if (status === 0 || status >= 500) return { alert: "We couldn't save that. Try again." }
  if (json && json.field && recognizedFields.includes(json.field)) {
    return { field: json.field, message: json.error }
  }
  return { alert: (json && json.error) || "We couldn't save that. Try again." }
}
