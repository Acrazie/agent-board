import type { Pr, PrActivity } from '../types'

// The only commands the mod runs: read-only, fixed argv. Nothing from GitHub
// ever reaches a command line.
const QUERY = `query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        id number title url isDraft reviewDecision updatedAt
        repository { nameWithOwner }
        reviews(last: 20) { nodes { id author { login } state body submittedAt } }
        comments(last: 20) { nodes { id author { login } body createdAt } }
        reviewThreads(last: 20) { nodes { comments(last: 20) { nodes { id author { login } body path line originalLine createdAt } } } }
      }
    }
  }
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
  reviewThreads: { nodes: { comments: { nodes: Node[] } }[] }
}

const who = (author: Author) => author?.login ?? 'ghost'

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
  for (const thread of raw.reviewThreads.nodes) {
    for (const comment of thread.comments.nodes) {
      items.push({
        id: comment.id,
        kind: 'inline',
        author: who(comment.author),
        text: comment.body,
        path: comment.path,
        line: comment.line ?? comment.originalLine ?? undefined,
        at: comment.createdAt ?? '',
      })
    }
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, ACTIVITY_LIMIT)
}

/** Parses `gh api graphql` output; throws a readable message on anything unexpected. */
export const parseSearch = (stdout: string): { login: string; prs: Pr[] } => {
  let data: { data?: { viewer: { login: string }; search: { nodes: Raw[] } }; errors?: { message: string }[] }
  try {
    data = JSON.parse(stdout)
  } catch {
    throw new Error('réponse de gh illisible')
  }
  if (data.errors?.length) throw new Error(data.errors.map(error => error.message).join('; '))
  if (!data.data) throw new Error('réponse de gh sans données')
  const prs = data.data.search.nodes
    .filter(raw => raw.id !== undefined)
    .map(raw => ({
      id: raw.id,
      repo: raw.repository.nameWithOwner,
      number: raw.number,
      title: raw.title,
      url: raw.url,
      isDraft: raw.isDraft,
      reviewDecision: raw.reviewDecision,
      updatedAt: raw.updatedAt,
      activity: activityOf(raw),
    }))
  return { login: data.data.viewer.login, prs }
}
