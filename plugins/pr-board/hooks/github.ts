import type { Pr, PrActivity } from '../types'

// The only commands the mod runs: read-only, fixed argv. The one value that
// is not a constant is a PR id or a pageInfo cursor GitHub itself returned,
// checked against ID_SHAPE and passed as the value of its own `-f` flag.
const COMMENT_FIELDS = 'id author { login } body path line originalLine createdAt'
const THREADS = `pageInfo { hasNextPage endCursor } nodes { comments(last: 20) { nodes { ${COMMENT_FIELDS} } } }`

const QUERY = `query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        id number title url isDraft reviewDecision updatedAt
        repository { nameWithOwner }
        reviews(last: 20) { nodes { id author { login } state body submittedAt } }
        comments(last: 20) { nodes { id author { login } body createdAt } }
        reviewThreads(first: 30) { ${THREADS} }
      }
    }
  }
}`

// Older threads can hold the newest replies, so threads are read page by page.
const THREADS_QUERY = `query($id: ID!, $cursor: String!) {
  node(id: $id) { ... on PullRequest { reviewThreads(first: 100, after: $cursor) { ${THREADS} } } }
}`

export const FETCH_ARGV = [
  'gh',
  'api',
  'graphql',
  '-f',
  `query=${QUERY}`,
  '-f',
  'q=is:pr is:open author:@me org:weeki-io',
] as const

const ID_SHAPE = /^[A-Za-z0-9+/=_-]{1,200}$/
const MAX_THREAD_PAGES = 20

export const threadsArgv = (id: string, cursor: string) => {
  if (!ID_SHAPE.test(id) || !ID_SHAPE.test(cursor)) throw new Error('identifiant GitHub inattendu')
  return ['gh', 'api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-f', `id=${id}`, '-f', `cursor=${cursor}`]
}

export const ACTIVITY_LIMIT = 20

type Author = { login?: string } | null
type Node = {
  id: string
  author: Author
  body: string
  state?: string
  submittedAt?: string | null
  createdAt?: string
  path?: string
  line?: number | null
  originalLine?: number | null
}
type Threads = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: { comments: { nodes: Node[] } }[]
}
type Raw = {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  reviewDecision: string | null
  updatedAt: string
  repository: { nameWithOwner: string }
  reviews: { nodes: Node[] }
  comments: { nodes: Node[] }
  reviewThreads: Threads
}
type Data = {
  data?: { viewer: { login: string }; search: { nodes: Raw[] }; node?: { reviewThreads: Threads } | null }
  errors?: { message: string }[]
}

export type Run = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

const who = (author: Author) => author?.login ?? 'ghost'

const inlineOf = (threads: Threads): PrActivity[] =>
  threads.nodes.flatMap(thread =>
    thread.comments.nodes.map(comment => ({
      id: comment.id,
      kind: 'inline' as const,
      author: who(comment.author),
      text: comment.body,
      path: comment.path,
      line: comment.line ?? comment.originalLine ?? undefined,
      at: comment.createdAt ?? '',
    })),
  )

const activityOf = (raw: Raw): PrActivity[] => {
  const items: PrActivity[] = []
  for (const review of raw.reviews.nodes) {
    // A review that only wraps inline comments says nothing itself.
    if (!review.submittedAt || (review.state === 'COMMENTED' && review.body === '')) continue
    items.push({ id: review.id, kind: 'review', author: who(review.author), state: review.state, text: review.body, at: review.submittedAt })
  }
  for (const comment of raw.comments.nodes) {
    items.push({ id: comment.id, kind: 'comment', author: who(comment.author), text: comment.body, at: comment.createdAt ?? '' })
  }
  return items
}

const newestFirst = (items: PrActivity[]) => items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, ACTIVITY_LIMIT)

/** Runs one `gh api graphql` call and returns its data; throws a readable message on any failure. */
const ask = async (run: Run, argv: readonly string[]) => {
  const result = await run(argv)
  if (result.exitCode !== 0) {
    throw new Error(`gh a échoué : ${result.stderr.trim().split('\n')[0] || `code ${result.exitCode}`}`)
  }
  let data: Data
  try {
    data = JSON.parse(result.stdout)
  } catch {
    throw new Error('réponse de gh illisible')
  }
  if (data.errors?.length) throw new Error(data.errors.map(error => error.message).join('; '))
  if (!data.data) throw new Error('réponse de gh sans données')
  return data.data
}

/** The viewer's open weeki-io PRs, each with its 20 newest reviews and comments across every thread. */
export const fetchOpenPrs = async (run: Run): Promise<{ login: string; prs: Pr[] }> => {
  const found = await ask(run, FETCH_ARGV)
  const prs: Pr[] = []
  for (const raw of found.search.nodes) {
    if (raw.id === undefined) continue
    const items = [...activityOf(raw), ...inlineOf(raw.reviewThreads)]
    let page = raw.reviewThreads.pageInfo
    for (let pages = 0; page.hasNextPage; pages++) {
      if (pages >= MAX_THREAD_PAGES || page.endCursor === null) throw new Error(`trop de fils de discussion sur ${raw.repository.nameWithOwner}#${raw.number}`)
      const more = (await ask(run, threadsArgv(raw.id, page.endCursor))).node?.reviewThreads
      if (!more) throw new Error('réponse de gh sans fils de discussion')
      items.push(...inlineOf(more))
      page = more.pageInfo
    }
    prs.push({
      id: raw.id,
      repo: raw.repository.nameWithOwner,
      number: raw.number,
      title: raw.title,
      url: raw.url,
      isDraft: raw.isDraft,
      reviewDecision: raw.reviewDecision,
      updatedAt: raw.updatedAt,
      activity: newestFirst(items),
    })
  }
  return { login: found.viewer.login, prs }
}
