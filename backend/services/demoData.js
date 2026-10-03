/**
 * demoData.js — offline fallback dataset.
 *
 * Used when GitHub is unreachable or rate limited. The shape is IDENTICAL to
 * the output of githubService.normalizeRepo(), so every downstream stage
 * (matching, Gemma analysis, response building) works unchanged.
 *
 * `demo: true` is kept internally so the route can set meta.dataSource = "demo"
 * without ever leaking the flag into the JSON response.
 */

/** @type {Array<import('./githubService.js').NormalizedRepo>} */
export const DEMO_REPOSITORIES = [
  {
    id: 100000001,
    name: 'pixel-forge',
    fullName: 'openforge/pixel-forge',
    owner: 'openforge',
    description:
      'A lightweight, zero-config image pipeline written in TypeScript. Crop, resize and convert images with a fluent API that runs in Node and the browser.',
    url: 'https://github.com/openforge/pixel-forge',
    htmlUrl: 'https://github.com/openforge/pixel-forge',
    stars: 1420,
    forks: 96,
    language: 'TypeScript',
    topics: ['image-processing', 'typescript', 'developer-tools', 'open-source'],
    openIssues: 34,
    pushedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 3,
    issues: [
      {
        number: 412,
        title: 'Add AVIF output format to the encode() helper',
        url: 'https://github.com/openforge/pixel-forge/issues/412',
        labels: ['good first issue', 'enhancement', 'help wanted'],
        body: 'We support webp and jpeg today. AVIF is widely supported in modern browsers and would cut file size by ~30%. Add "avif" to the FORMATS map and add a test case in test/encode.test.js.',
      },
      {
        number: 428,
        title: 'Document the resize() aspect-ratio options in the README',
        url: 'https://github.com/openforge/pixel-forge/issues/428',
        labels: ['good first issue', 'documentation'],
        body: 'The README only shows resize(w, h). Please document fit: "cover" | "contain" | "fill", position, and the background option, with one example per value.',
      },
      {
        number: 437,
        title: 'Fix memory leak when reusing a Sharp instance across jobs',
        url: 'https://github.com/openforge/pixel-forge/issues/437',
        labels: ['good first issue', 'bug'],
        body: 'Calling pipeline() repeatedly on the same instance grows the heap without bound. Reproduce with a loop of 500 512x512 conversions and a --expose-gc heap snapshot.',
      },
    ],
    demo: true,
  },
  {
    id: 100000002,
    name: 'lumen-agents',
    fullName: 'lumenai/lumen-agents',
    owner: 'lumenai',
    description:
      'A tiny, hackable framework for building single-file AI agents in Python. Batteries included for tool calling, memory and streaming, no cloud lock-in.',
    url: 'https://github.com/lumenai/lumen-agents',
    htmlUrl: 'https://github.com/lumenai/lumen-agents',
    stars: 8940,
    forks: 712,
    language: 'Python',
    topics: ['ai', 'artificial-intelligence', 'machine-learning', 'agents', 'python'],
    openIssues: 87,
    pushedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 3,
    issues: [
      {
        number: 1203,
        title: 'Add a structured-output helper that validates tool schemas',
        url: 'https://github.com/lumenai/lumen-agents/issues/1203',
        labels: ['good first issue', 'enhancement', 'ai'],
        body: 'Right now a malformed tool response raises a bare KeyError. Add a helper that validates the model output against the tool JSON schema and raises a friendly ToolSchemaError with the offending field path.',
      },
      {
        number: 1211,
        title: 'Streaming API drops the final usage token counts',
        url: 'https://github.com/lumenai/lumen-agents/issues/1211',
        labels: ['good first issue', 'bug', 'help wanted'],
        body: 'agent.stream() never emits a final chunk with .usage, so cost tracking is impossible for streamed runs. The non-streaming path works fine — compare Agent.run vs Agent.stream.',
      },
      {
        number: 1220,
        title: 'Write a getting-started notebook for the memory module',
        url: 'https://github.com/lumenai/lumen-agents/issues/1220',
        labels: ['good first issue', 'documentation'],
        body: 'examples/ has no notebook showing sliding-window vs summarisation memory. Cover both strategies, show the token savings, and keep it under 100 lines of code.',
      },
    ],
    demo: true,
  },
  {
    id: 100000003,
    name: 'secure-cart',
    fullName: 'guardrail-labs/secure-cart',
    owner: 'guardrail-labs',
    description:
      'Security-focused HTTP middleware collection for Express. Ships CSRF, rate limiting, header hardening and request-signature verification out of the box.',
    url: 'https://github.com/guardrail-labs/secure-cart',
    htmlUrl: 'https://github.com/guardrail-labs/secure-cart',
    stars: 3180,
    forks: 141,
    language: 'JavaScript',
    topics: ['security', 'express', 'middleware', 'nodejs', 'web-development'],
    openIssues: 41,
    pushedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 3,
    issues: [
      {
        number: 302,
        title: 'Add a Redis-backed store option for the rate limiter',
        url: 'https://github.com/guardrail-labs/secure-cart/issues/302',
        labels: ['good first issue', 'enhancement', 'help wanted'],
        body: 'The default in-memory store breaks across multiple instances. Implement a Store-compatible Redis store (i- prefixed keys, atomic INCR + EXPIRE via a Lua script) and add it to docs/multi-instance.md.',
      },
      {
        number: 309,
        title: 'Header hardening middleware is missing COOP/COEP presets',
        url: 'https://github.com/guardrail-labs/secure-cart/issues/309',
        labels: ['good first issue', 'security', 'enhancement'],
        body: 'Add crossOriginOpenerPolicy and crossOriginEmbedderPolicy to the helmet-like defaults, with an opt-out flag and a table in the README comparing them to Helmet.',
      },
      {
        number: 315,
        title: 'CSRF token validator accepts array-valued headers',
        url: 'https://github.com/guardrail-labs/secure-cart/issues/315',
        labels: ['good first issue', 'bug', 'security'],
        body: 'If a client sends x-csrf-token twice the current code reads only the first value and the comparison passes unexpectedly. Normalise to the last header value and add a regression test.',
      },
    ],
    demo: true,
  },
  {
    id: 100000004,
    name: 'cloudcost',
    fullName: 'driftwise/cloudcost',
    owner: 'driftwise',
    description:
      'CLI that scans Terraform plans and reports likely cost surprises before you apply. Detects oversized instances, missing autoscaling and forgotten dev environments.',
    url: 'https://github.com/driftwise/cloudcost',
    htmlUrl: 'https://github.com/driftwise/cloudcost',
    stars: 2260,
    forks: 118,
    language: 'Go',
    topics: ['cloud', 'terraform', 'devops', 'cost-optimization', 'developer-tools'],
    openIssues: 26,
    pushedAt: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 2,
    issues: [
      {
        number: 188,
        title: 'Support AWS Graviton instance families in the pricing table',
        url: 'https://github.com/driftwise/cloudcost/issues/188',
        labels: ['good first issue', 'enhancement'],
        body: 'The rules engine only knows x86 on-demand prices, so t4g/c7g instances are flagged as "unknown". Extend internal/pricing/aws.go with the Gravizon entries and add a table-driven test.',
      },
      {
        number: 195,
        title: 'Add --json output and a JUnit reporter for CI',
        url: 'https://github.com/driftwise/cloudcost/issues/195',
        labels: ['good first issue', 'feature', 'help wanted'],
        body: 'CI users want machine-readable output. Add a --json flag that emits findings as a stable schema, then a junit reporter package under reporters/junit.',
      },
    ],
    demo: true,
  },
  {
    id: 100000005,
    name: 'prism-cli',
    fullName: 'prismtools/prism-cli',
    owner: 'prismtools',
    description:
      'A terminal UI for previewing HTTP responses, diffing two endpoints and generating typed API clients from OpenAPI specs. Built with Ink and React.',
    url: 'https://github.com/prismtools/prism-cli',
    htmlUrl: 'https://github.com/prismtools/prism-cli',
    stars: 640,
    forks: 38,
    language: 'JavaScript',
    topics: ['cli', 'react', 'developer-tools', 'openapi', 'web-development'],
    openIssues: 19,
    pushedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 3,
    issues: [
      {
        number: 74,
        title: 'Render GraphQL responses in the response viewer pane',
        url: 'https://github.com/prismtools/prism-cli/issues/74',
        labels: ['good first issue', 'feature'],
        body: 'The viewer currently assumes a JSON object and crashes on nested arrays. Add a collapsible tree renderer that handles { data, errors } envelopes without losing the pretty-printer for plain REST payloads.',
      },
      {
        number: 81,
        title: 'Add a --watch flag that re-runs the request on file change',
        url: 'https://github.com/prismtools/prism-cli/issues/81',
        labels: ['good first issue', 'enhancement', 'help wanted'],
        body: 'Use chokidar to watch local .env and spec files, then re-issue the last request with a debounce of 250ms. Show a spinner state while the request is in flight.',
      },
      {
        number: 90,
        title: 'Colorise validation errors in the generated client output',
        url: 'https://github.com/prismtools/prism-cli/issues/90',
        labels: ['good first issue', 'good first issue', 'dx'],
        body: 'Validation failures print as a plain stack. Prefix each error with a red bullet and print the JSON pointer path in dim text. Respect NO_COLOR and non-TTY stdout.',
      },
    ],
    demo: true,
  },
  {
    id: 100000006,
    name: 'sightline-vision',
    fullName: 'sightline-lab/sightline-vision',
    owner: 'sightline-lab',
    description:
      'Pretrained computer-vision backbones and training recipes for wildlife camera traps. Includes augmentation pipelines, a small 3-class baseline and reproducible notebooks.',
    url: 'https://github.com/sightline-lab/sightline-vision',
    htmlUrl: 'https://github.com/sightline-lab/sightline-vision',
    stars: 5210,
    forks: 304,
    language: 'Python',
    topics: ['machine-learning', 'computer-vision', 'pytorch', 'ai', 'deep-learning'],
    openIssues: 58,
    pushedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 3,
    issues: [
      {
        number: 655,
        title: 'Add a mosaic augmentation flag to the training config',
        url: 'https://github.com/sightline-lab/sightline-vision/issues/655',
        labels: ['good first issue', 'machine-learning', 'enhancement'],
        body: 'The baseline config has no mosaic option even though datasets/transforms.py implements Mosaic. Expose it in configs/baseline.yaml with a default of 0.5 and verify mAP improves on the small subset.',
      },
      {
        number: 661,
        title: 'Fix dataloader worker leak when num_workers > 0',
        url: 'https://github.com/sightline-lab/sightline-vision/issues/661',
        labels: ['good first issue', 'bug'],
        body: 'With num_workers=4 the process count grows on every epoch because the worker pool is never shut down. Ensure the loader is created inside the run function and add a smoke test that asserts stable worker PIDs.',
      },
      {
        number: 670,
        title: 'Publish class-weight helper for imbalanced camera-trap datasets',
        url: 'https://github.com/sightline-lab/sightline-vision/issues/670',
        labels: ['good first issue', 'machine-learning', 'documentation'],
        body: 'Most camera-trap sets are heavily imbalanced. Add a function computing inverse-frequency class weights from a label histogram, unit-test it, and reference it from the fine-tuning notebook.',
      },
    ],
    demo: true,
  },
  {
    id: 100000007,
    name: 'gitship',
    fullName: 'shipfast-labs/gitship',
    owner: 'shipfast-labs',
    description:
      'Release automation for small teams: conventional-commit changelog, semantic version bump, GitHub release and a Docker image push, all in one command.',
    url: 'https://github.com/shipfast-labs/gitship',
    htmlUrl: 'https://github.com/shipfast-labs/gitship',
    stars: 1870,
    forks: 83,
    language: 'TypeScript',
    topics: ['developer-tools', 'release', 'git', 'hacktoberfest', 'automation'],
    openIssues: 22,
    pushedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 2,
    issues: [
      {
        number: 254,
        title: 'Support pre-release channels (next, beta) in the version bump',
        url: 'https://github.com/shipfast-labs/gitship/issues/254',
        labels: ['good first issue', 'feature', 'help wanted'],
        body: 'gitship release --channel next should bump to 1.4.0-next.1 and mark the GitHub release as a pre-release. Extend the semver helper and cover it with a fixture-based test.',
      },
      {
        number: 261,
        title: 'Retry the Docker push with exponential backoff on 429',
        url: 'https://github.com/shipfast-labs/gitship/issues/261',
        labels: ['good first issue', 'bug', 'docker'],
        body: 'Registry rate limits make the push step flaky on CI. Retry up to three times with backoff and read Retry-After when present. Add a unit test with a fake registry client.',
      },
    ],
    demo: true,
  },
  {
    id: 100000008,
    name: 'tidepool',
    fullName: 'tidepool-ui/tidepool',
    owner: 'tidepool-ui',
    description:
      'Accessible React component primitives — menu, combobox, dialog, toast — with full keyboard support and visible focus rings. 4 kB gzipped, zero runtime dependencies.',
    url: 'https://github.com/tidepool-ui/tidepool',
    htmlUrl: 'https://github.com/tidepool-ui/tidepool',
    stars: 3410,
    forks: 205,
    language: 'TypeScript',
    topics: ['react', 'accessibility', 'web-development', 'ui', 'design-system'],
    openIssues: 33,
    pushedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    goodFirstIssues: 3,
    issues: [
      {
        number: 508,
        title: 'Add aria-live announcements to the Toast component',
        url: 'https://github.com/tidepool-ui/tidepool/issues/508',
        labels: ['good first issue', 'accessibility', 'a11y'],
        body: 'Screen reader users get no feedback when a toast appears. Render a visually hidden live region with aria-live="polite" for info toasts and assert="assertive" for error toasts.',
      },
      {
        number: 515,
        title: 'Combobox: keep the active option scrolled into view with long lists',
        url: 'https://github.com/tidepool-ui/tidepool/issues/515',
        labels: ['good first issue', 'bug', 'react'],
        body: 'Arrow-key navigation past the visible window does not scroll. Call scrollIntoView({ block: "nearest" }) on the active option in the keydown handler and add a jsdom test asserting the call.',
      },
      {
        number: 522,
        title: 'Document the theme contract for custom design tokens',
        url: 'https://github.com/tidepool-ui/tidepool/issues/522',
        labels: ['good first issue', 'documentation', 'theming'],
        body: 'We have no written spec for which CSS custom properties consumers may override. Document the contract, note the required contrast ratios, and add a small example of a themed Dialog.',
      },
    ],
    demo: true,
  },
];

/**
 * Return a fresh deep copy so callers (and the cache) can never mutate the
 * module-level fixtures.
 * @returns {Array<object>}
 */
export function getDemoRepositories() {
  return DEMO_REPOSITORIES.map((repo) => ({
    ...repo,
    topics: [...repo.topics],
    issues: repo.issues.map((issue) => ({ ...issue, labels: [...issue.labels] })),
  }));
}

export default { DEMO_REPOSITORIES, getDemoRepositories };
