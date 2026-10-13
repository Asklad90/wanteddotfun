/**
 * Client for the off-chain submissions backend at /api/*
 */

export interface OffchainSubmission {
  id: number
  bounty_id: string
  submitter: string   // lowercase address
  content: string
  created_at: number  // unix seconds
}

export interface SubmissionsResponse {
  submissions: OffchainSubmission[]
  count: number
  publicSubs: boolean
  isPoster: boolean
}

const BASE = '/api'

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const data = await res.json() as T & { error?: string }
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

/** Register a bounty's poster after createBounty confirms onchain */
export async function registerBounty(bountyId: string, poster: string) {
  return apiFetch<{ ok: boolean }>('/bounty-settings', {
    method: 'POST',
    body: JSON.stringify({ bountyId, poster }),
  })
}

/** Toggle public/private submissions (poster only) */
export async function setSubmissionVisibility(bountyId: string, poster: string, publicSubs: boolean) {
  return apiFetch<{ ok: boolean; publicSubs: boolean }>(
    `/bounty-settings/${bountyId}/visibility`,
    { method: 'PATCH', body: JSON.stringify({ poster, publicSubs }) },
  )
}

/** Submit work — free, no gas */
export async function postSubmission(bountyId: string, submitter: string, content: string) {
  return apiFetch<{ ok: boolean; id: number }>('/submissions', {
    method: 'POST',
    body: JSON.stringify({ bountyId, submitter, content }),
  })
}

/** Get submissions the viewer is allowed to see */
export async function getSubmissions(bountyId: string, viewer: string): Promise<SubmissionsResponse> {
  const q = viewer ? `?viewer=${encodeURIComponent(viewer)}` : ''
  return apiFetch<SubmissionsResponse>(`/submissions/${bountyId}${q}`)
}

/** Just the count — public, no auth */
export async function getSubmissionCount(bountyId: string): Promise<number> {
  const r = await apiFetch<{ count: number }>(`/submissions/${bountyId}/count`)
  return r.count
}

/** Get the viewer's own submission */
export async function getMySubmission(bountyId: string, submitter: string): Promise<OffchainSubmission | null> {
  const r = await apiFetch<{ submission: OffchainSubmission | null }>(
    `/submissions/${bountyId}/mine?submitter=${encodeURIComponent(submitter)}`,
  )
  return r.submission
}
