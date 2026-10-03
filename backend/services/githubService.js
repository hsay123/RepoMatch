/**
 * githubService.js — everything that talks to the GitHub REST API.
 *
 * Responsibilities:
 *   1. Translate a developer profile into at most 3 /search/repositories calls.
 *   2. Merge + dedupe those results into a candidate pool (~15 repos).
 *   3. Fetch "good first issue" issues for the strongest candidates only.
 *   4. Normalise everything into one predictable shape.
 *   5. Cache search results in memory (10 min TTL).
 *
 * Rate-limit policy: unauthenticated GitHub search allows ~10 requests/minute
 * and search results are cached aggressively for 10 minutes, so we never issue
 * more than MAX_SEARCH_CALLS (3) per uncached request and we run them in
 * parallel to keep the wall-clock time down.
 */

import {
  GITHUB_TOKEN,
  CACHE_TTL_MS,
  MAX_SEARCH_CALLS,
  MAX_CANDIDATES,
  MAX_ISSUE_FETCHES,
  MAX_ISSUE_BODY_CHARS,
} from './config.js';

const GITHUB_API = 'https://api.github.com';

/* ------------------------------------------------------------------ *
 * Profile -> GitHub vocabulary
 * ------------------------------------------------------------------ */

/**
 * Free-text skill -> GitHub search language. Keys are already lower-cased.
 * Anything unmapped falls through to the raw string (GitHub is forgiving but a
 * wrong language returns zero results, so the map is deliberately generous).
 */
export const SKILL_TO_LANGUAGE = {
  react: 'JavaScript',
  'react.js': 'JavaScript',
  reactjs: 'JavaScript',
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  'node.js': 'JavaScript',
  node: 'JavaScript',
  nodejs: 'JavaScript',
  express: 'JavaScript',
  'node.js/express': 'JavaScript',
  next: 'JavaScript',
  'next.js': 'JavaScript',
  nextjs: 'JavaScript',
  vue: 'JavaScript',
  vuejs: 'JavaScript',
  angular: 'TypeScript',
  svelte: 'JavaScript',
  html: 'HTML',
  'html/css': 'CSS',
  css: 'CSS',
  sass: 'SCSS',
  tailwind: 'TypeScript',
  python: 'Python',
  django: 'Python',
  flask: 'Python',
  fastapi: 'Python',
  'machine learning': 'Python',
  ml: 'Python',
  pandas: 'Python',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  'c++': 'C++',
  cpp: 'C++',
  'c#': 'C#',
  csharp: 'C#',
  'c/c++': 'C++',
  c: 'C',
  go: 'Go',
  golang: 'Go',
  rust: 'Rust',
  ruby: 'Ruby',
  rails: 'Ruby',
  php: 'PHP',
  laravel: 'PHP',
  'objective-c': 'Objective-C',
  shell: 'Shell',
  bash: 'Shell',
  lua: 'Lua',
  r: 'R',
  'jupyter notebook': 'Jupyter Notebook',
  dart: 'Dart',
  elixir: 'Elixir',
  scala: 'Scala',
  'crystal': 'Crystal',
};

/**
 * Free-text interest -> GitHub topic. Topics are the single most effective
 * search qualifier available to unauthenticated callers.
 */
export const INTEREST_TO_TOPIC = {
  ai: 'artificial-intelligence',
  'artificial intelligence': 'artificial-intelligence',
  'machine learning': 'machine-learning',
  ml: 'machine-learning',
  deeplearning: 'deep-learning',
  'deep learning': 'deep-learning',
  'computer vision': 'computer-vision',
  nlp: 'nlp',
  'web development': 'web',
  webdev: 'web',
  frontend: 'frontend',
  'front-end': 'frontend',
  backend: 'backend',
  'back-end': 'backend',
  fullstack: 'fullstack',
  'full stack': 'fullstack',
  'developer tools': 'developer-tools',
  devtools: 'developer-tools',
  'dev tools': 'developer-tools',
  cli: 'cli',
  'command line': 'cli',
  cybersecurity: 'security',
  security: 'security',
  appsec: 'security',
  'app security': 'security',
  privacy: 'privacy',
  cloud: 'cloud',
  aws: 'aws',
  devops: 'devops',
  kubernetes: 'kubernetes',
  terraform: 'terraform',
  'open source': 'hacktoberfest',
  hacktoberfest: 'hacktoberfest',
  'good first issue': 'good-first-issue',
  gamedev: 'game-development',
  'game development': 'game-development',
  mobile: 'mobile',
  ios: 'ios',
  android: 'android',
  react: 'react',
  reactjs: 'react',
  'data science': 'data-science',
  datascience: 'data-science',
  databases: 'database',
  database: 'database',
  api: 'api',
  testing: 'testing',
  documentation: 'documentation',
  localization: 'localization',
  accessibility: 'accessibility',
};

/** Fallback topic per interest so an unknown interest still narrows the search. */
function slugifyTopic(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Deduplicate while preserving insertion order. */
function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

/**
 * Qualifiers that apply to EVERY search, independent of the profile.
 *
 * `good-first-issues:>0` is the important one: a repository with no open
 * good-first issue can never produce a recommendation, so we filter it out
 * server-side instead of wasting model calls on it.
 */
function baseQualifiers() {
  // 30 days ago, in the date format GitHub's `pushed:` comparison accepts.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return [
    'good-first-issues:>0',
    'archived:false',
    'is:public',
    `pushed:>${since}`,
    // Star floor keeps hobby repos out; the ceiling drops the mega-corps whose
    // issues are all triage-heavy.
    'stars:50..50000',
  ];
}

/**
 * Build one /search/repositories qualifier string.
 *
 * IMPORTANT: only ONE topic may appear per query. GitHub ANDs repeated
 * `topic:` qualifiers, and "topic:artificial-intelligence topic:web
 * good-first-issues:>0" returns 0 results in practice — verified against the
 * live API. The union of interests is therefore achieved by running one search
 * per topic and merging, not by ANDing topics inside a single query.
 *
 * @param {{language?: string, topic?: string}} spec
 * @returns {string}
 */
function buildQualifier({ language, topic } = {}) {
  const parts = [];
  if (language) parts.push(`language:${language}`);
  if (topic) parts.push(`topic:${topic}`);
  parts.push(...baseQualifiers());
  return parts.join(' ');
}

/**
 * Decide the (at most MAX_SEARCH_CALLS) set of searches to run.
 *
 * Strategy: one search per candidate language, then spend any remaining calls
 * on the highest-priority interests — again one topic per query, because GitHub
 * ANDs repeated `topic:` qualifiers (see buildQualifier).
 *
 * Each query is deliberately allowed to over-match. The deterministic
 * pre-filter downstream is what enforces precision; the search only has to
 * produce a wide, deduped candidate pool.
 */
function planSearches(profile) {
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  const interests = Array.isArray(profile.interests) ? profile.interests : [];

  const languages = unique(
    skills.map((s) => SKILL_TO_LANGUAGE[String(s).toLowerCase().trim()] || null)
  ).slice(0, 2);

  const topics = unique(
    interests.map((i) => INTEREST_TO_TOPIC[String(i).toLowerCase().trim()] || slugifyTopic(i))
  ).slice(0, 3);

  /** @type {Array<{kind: string, language?: string, topic?: string}>} */
  const plan = [];

  for (const language of languages) {
    if (plan.length >= MAX_SEARCH_CALLS) break;
    plan.push({ kind: `language:${language}`, language });
  }

  // Topic-only searches catch repos whose primary language we guessed wrong.
  for (const topic of topics) {
    if (plan.length >= MAX_SEARCH_CALLS) break;
    plan.push({ kind: `topic:${topic}`, topic });
  }

  if (plan.length === 0) {
    // Degenerate profile: a plain good-first-issue search still returns usable
    // repos instead of nothing.
    plan.push({ kind: 'broad' });
  }
  return plan.slice(0, MAX_SEARCH_CALLS);
}

/* ------------------------------------------------------------------ *
 * In-memory TTL cache
 * ------------------------------------------------------------------ */

/** @type {Map<string, {value: any, expiresAt: number}>} */
const searchCache = new Map();

/** Read a cache entry, or null if missing/expired. */
function cacheGet(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return hit.value;
}

/** Write a cache entry and opportunistically evict expired neighbours. */
function cacheSet(key, value) {
  if (searchCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of searchCache) {
      if (now > v.expiresAt) searchCache.delete(k);
    }
  }
  searchCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Exposed for tests / debugging. */
export function clearSearchCache() {
  searchCache.clear();
}

/* ------------------------------------------------------------------ *
 * Low-level fetch helpers
 * ------------------------------------------------------------------ */

/** Standard headers. Authorization is only attached when a token exists. */
function buildHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'RepoMatch',
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * True when the response signals that we are being rate limited.
 *
 * Only non-2xx responses can be a rate limit. A *successful* response is always
 * usable data, even when it carries `x-ratelimit-remaining: 0` (which GitHub
 * sends on the request that consumes the last of the quota) — treating that as
 * a limit would throw away perfectly good results.
 */
function isRateLimited(response) {
  if (response.ok) return false;
  if (response.status === 429) return true;
  if (response.status === 403) {
    // 403 on GitHub is almost always the secondary rate limit. If the quota
    // header contradicts that, trust the header; if it is absent, assume a
    // limit so the caller reports a clear rate-limit error rather than leaking
    // a bare 403 to the client.
    const remaining = response.headers.get('x-ratelimit-remaining');
    return remaining === null || remaining === '0';
  }
  // Any other failure (5xx, network-ish) that reports an exhausted quota.
  return response.headers.get('x-ratelimit-remaining') === '0';
}

/**
 * fetch() + JSON with timeout, rate-limit detection and typed errors.
 *
 * @param {string} path  path starting with "/" e.g. "/search/repositories"
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<any>}
 * @throws {{type:'RATE_LIMIT'|'NETWORK'|'HTTP', status?:number, message:string}}
 */
async function githubFetch(path, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      headers: buildHeaders(),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw { type: 'NETWORK', message: `GitHub request timed out after ${timeoutMs}ms: ${path}` };
    }
    throw { type: 'NETWORK', message: `Could not reach GitHub: ${err?.message || err}` };
  }
  clearTimeout(timer);

  if (isRateLimited(response)) {
    const reset = response.headers.get('x-ratelimit-reset');
    const resetInfo = reset ? ` (quota resets at unix ${reset})` : '';
    throw { type: 'RATE_LIMIT', status: response.status, message: `GitHub rate limit hit${resetInfo}. Set GITHUB_TOKEN in .env to raise the limit.` };
  }

  if (!response.ok) {
    throw { type: 'HTTP', status: response.status, message: `GitHub responded ${response.status} ${response.statusText} for ${path}` };
  }

  try {
    return await response.json();
  } catch {
    throw { type: 'HTTP', status: response.status, message: `GitHub returned a non-JSON body for ${path}` };
  }
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

/** Keep a description short and never null. */
function cleanText(value, max = 300) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Normalise one raw GitHub repository object into our internal shape. */
export function normalizeRepo(raw) {
  const fullName = raw.full_name || raw.fullName || '';
  return {
    id: raw.id,
    name: raw.name || fullName.split('/')[1] || '',
    fullName,
    owner: raw.owner?.login || fullName.split('/')[0] || '',
    description: cleanText(raw.description || 'No description provided.'),
    url: raw.html_url || raw.url || '',
    htmlUrl: raw.html_url || '',
    stars: raw.stargazers_count ?? raw.stars ?? 0,
    forks: raw.forks_count ?? raw.forks ?? 0,
    language: raw.language || 'Unknown',
    topics: Array.isArray(raw.topics) ? raw.topics.slice(0, 12) : [],
    openIssues: raw.open_issues_count ?? 0,
    pushedAt: raw.pushed_at || null,
    // GitHub's search API does not always return a `good_first_issues` field,
    // so this is only a hint. The authoritative count comes from
    // fetchGoodFirstIssues() and overwrites it in attachGoodFirstIssues().
    goodFirstIssues: raw.good_first_issues ?? 0,
    issues: [],
  };
}

/** Normalise a raw GitHub issue and strip PRs out (they share the issues endpoint). */
function normalizeIssue(raw) {
  return {
    number: raw.number,
    title: cleanText(raw.title || 'Untitled issue', 160),
    url: raw.html_url || raw.url || '',
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
      : [],
    body: cleanText(raw.body || '', MAX_ISSUE_BODY_CHARS),
  };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Search GitHub for candidate repositories that fit a developer profile.
 *
 * @param {{skills?: string[], interests?: string[], experience?: string}} profile
 * @returns {Promise<{repos: object[], cached: boolean, queries: string[]}>}
 */
export async function searchRepositories(profile) {
  const plan = planSearches(profile);
  const queries = plan.map(buildQualifier);

  // Cache key = the exact qualifiers, so identical profiles share one search.
  const cacheKey = `search::${queries.join('||')}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[github] cache HIT for ${cached.length} repos (key: ${cacheKey.slice(0, 80)}…)`);
    return { repos: cached, cached: true, queries };
  }

  console.log(`[github] running ${plan.length} parallel search call(s)${GITHUB_TOKEN ? ' (authenticated)' : ' (anonymous, 10/min search limit)'}`);

  // Promise.allSettled: one flaky search must not kill the other two results.
  const settled = await Promise.allSettled(
    plan.map((spec) => {
      const params = new URLSearchParams({
        q: buildQualifier(spec),
        sort: 'updated',
        order: 'desc',
        per_page: '10', // 3 calls x 10 = 30 raw results before dedupe.
      });
      return githubFetch(`/search/repositories?${params.toString()}`);
    })
  );

  const failures = [];
  /** @type {Map<number, object>} */
  const byId = new Map();

  settled.forEach((result, index) => {
    const label = plan[index]?.kind || 'search';
    if (result.status === 'fulfilled') {
      const items = Array.isArray(result.value?.items) ? result.value.items : [];
      console.log(`[github]   ${label} search -> ${items.length} repo(s)`);
      for (const raw of items) {
        if (!raw || typeof raw.id !== 'number') continue;
        // Forks and dead repos can never be a good first contribution target.
        if (raw.archived || raw.disabled || raw.fork) continue;
        // Dedupe by repo id — the same repo can match several queries.
        if (!byId.has(raw.id)) byId.set(raw.id, normalizeRepo(raw));
      }
    } else {
      // A RATE_LIMIT failure is fatal: every other search in this batch is
      // almost certainly limited too, and we refuse to return partial data.
      if (result.reason?.type === 'RATE_LIMIT') {
        console.warn(`[github] ${label} search -> RATE_LIMIT: ${result.reason.message}`);
        throw result.reason;
      }
      failures.push(result.reason?.message || String(result.reason));
      console.warn(`[github]   ${label} search failed: ${failures[failures.length - 1]}`);
    }
  });

  // Preserve "most recently updated first" after dedupe.
  const merged = [...byId.values()]
    .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0))
    .slice(0, MAX_CANDIDATES);

  if (merged.length === 0 && failures.length > 0) {
    throw { type: 'NETWORK', message: `All GitHub searches failed: ${failures[0]}` };
  }

  if (merged.length > 0) cacheSet(cacheKey, merged);
  console.log(`[github] found ${merged.length} repos${failures.length ? ` (${failures.length} search(es) failed, partial result)` : ''}`);

  return { repos: merged, cached: false, queries };
}

/**
 * Second-chance search with relaxed qualifiers.
 *
 * The strict query requires a good-first issue, activity within 30 days, a
 * 50-50k star range and an exact language/topic match. That is the right target
 * for recommendations, but a narrow profile (e.g. one uncommon skill) can match
 * literally nothing. Rather than returning an empty deck we widen the search
 * once: drop the star floor and the topic pins, and allow a 12-month window.
 *
 * Repositories found here still have to pass the good-first-issue check in
 * fetchGoodFirstIssues(), so nothing unusable can reach the client.
 *
 * @param {{skills?: string[], interests?: string[], experience?: string}} profile
 * @returns {Promise<{repos: object[], cached: boolean, queries: string[]}>}
 */
export async function searchRepositoriesRelaxed(profile) {
  const languages = unique(
    (Array.isArray(profile.skills) ? profile.skills : [])
      .map((s) => SKILL_TO_LANGUAGE[String(s).toLowerCase().trim()] || null)
  ).slice(0, 2);

  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  /** @type {string[]} */
  const queries = [];
  if (languages.length > 0) {
    // Language only: the single most reliable signal, with the windows opened up.
    queries.push(`language:${languages[0]} good-first-issues:>0 archived:false is:public pushed:>${since} stars:10..50000`);
  }
  if (languages.length > 1) {
    queries.push(`language:${languages[1]} good-first-issues:>0 archived:false is:public pushed:>${since} stars:10..50000`);
  }
  // Last resort: any healthy project with beginner-friendly issues.
  if (queries.length === 0) {
    queries.push(`good-first-issues:>0 archived:false is:public pushed:>${since} stars:10..50000`);
  }

  const cacheKey = `relaxed::${queries.join('||')}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[github] relaxed search cache HIT (${cached.length} repos)`);
    return { repos: cached, cached: true, queries };
  }

  console.log(`[github] relaxed retry with ${queries.length} wider query/queries`);

  const settled = await Promise.allSettled(
    queries.map((q) => {
      const params = new URLSearchParams({ q, sort: 'updated', order: 'desc', per_page: '10' });
      return githubFetch(`/search/repositories?${params.toString()}`);
    })
  );

  const byId = new Map();
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const items = Array.isArray(result.value?.items) ? result.value.items : [];
      console.log(`[github]   relaxed query ${index + 1} -> ${items.length} repo(s)`);
      for (const raw of items) {
        if (!raw || typeof raw.id !== 'number') continue;
        if (raw.archived || raw.disabled || raw.fork) continue;
        if (!byId.has(raw.id)) byId.set(raw.id, normalizeRepo(raw));
      }
    } else if (result.reason?.type === 'RATE_LIMIT') {
      throw result.reason;
    } else {
      console.warn(`[github]   relaxed query ${index + 1} failed: ${result.reason?.message || result.reason}`);
    }
  });

  const merged = [...byId.values()]
    .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0))
    .slice(0, MAX_CANDIDATES);

  if (merged.length > 0) cacheSet(cacheKey, merged);
  console.log(`[github] relaxed search found ${merged.length} repos`);

  return { repos: merged, cached: false, queries };
}

/**
 * Fetch open "good first issue" issues for one repository.
 *
 * Pull requests share the /issues endpoint and are identified by having a
 * `pull_request` key — they must be filtered out.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<object[]>} normalized issues (empty array on failure)
 */
export async function fetchGoodFirstIssues(owner, repo) {
  const params = new URLSearchParams({
    labels: 'good first issue',
    state: 'open',
    per_page: '5',
    sort: 'created',
    direction: 'desc',
  });

  let data;
  try {
    data = await githubFetch(`/repos/${owner}/${repo}/issues?${params.toString()}`);
  } catch (err) {
    if (err?.type === 'RATE_LIMIT') {
      // Propagate so the route can decide whether to abandon the whole request.
      throw err;
    }
    console.warn(`[github]   issues fetch failed for ${owner}/${repo}: ${err?.message || err}`);
    return [];
  }

  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item && !item.pull_request && typeof item.number === 'number')
    .slice(0, 5)
    .map(normalizeIssue);
}

/**
 * Populate `issues` (and the accurate count) for the strongest candidates.
 *
 * Issues are fetched with limited concurrency — after /search this endpoint is
 * the only one that can still hit the hourly limit, so we do not need more.
 *
 * @param {object[]} repos  candidates already sorted best-first
 * @param {number} [limit]
 * @returns {Promise<object[]>} the same repos, mutated in place
 */
export async function attachGoodFirstIssues(repos, limit = MAX_ISSUE_FETCHES) {
  const targets = repos.slice(0, limit);
  console.log(`[github] fetching good-first issues for ${targets.length} candidate(s)`);

  // 3 at a time: enough to overlap latency, gentle enough to stay under limits.
  const CONCURRENCY = 3;
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const current = targets[cursor++];
      try {
        const issues = await fetchGoodFirstIssues(current.owner, current.name);
        current.issues = issues;
        current.goodFirstIssues = issues.length;
        console.log(`[github]   ${current.fullName}: ${issues.length} good-first issue(s)`);
      } catch (err) {
        if (err?.type === 'RATE_LIMIT') throw err;
        current.issues = [];
        current.goodFirstIssues = 0;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  console.log(`[github] issues attached to ${targets.filter((r) => r.issues.length > 0).length} repo(s)`);
  return repos;
}

export default {
  searchRepositories,
  fetchGoodFirstIssues,
  attachGoodFirstIssues,
  normalizeRepo,
  clearSearchCache,
  SKILL_TO_LANGUAGE,
  INTEREST_TO_TOPIC,
};
