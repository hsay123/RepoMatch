const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

async function request(path, options) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options)
  } catch {
    const error = new Error('The RepoMatch backend could not be reached.')
    error.code = 'backend_unavailable'
    throw error
  }

  let data = {}
  try {
    data = await response.json()
  } catch {
    if (response.ok) return {}
  }

  if (!response.ok) {
    const backendCode = data?.code || data?.error
    const error = new Error(typeof data?.message === 'string' ? data.message : 'The matching request failed.')
    error.code = response.status === 429 ? 'github_rate_limit' : backendCode
    throw error
  }
  return data
}

export function findMatches(profile) {
  return request('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skills: profile.skills || [],
      interests: profile.interests || [],
      experience: profile.experience || '',
      contributionTypes: profile.contributionTypes || [],
    }),
  })
}

export function checkBackendHealth() {
  return request('/api/health')
}