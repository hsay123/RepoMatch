import { ArrowUpRight, GitFork, Star } from 'lucide-react'
import IssueCard from './IssueCard'

function formatCount(value) {
  if (typeof value !== 'number') return '—'
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}m`
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return value.toLocaleString()
}

function RepoCard({ repository, className = '', style, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) {
  const topics = Array.isArray(repository.topics) ? repository.topics : []
  const reasons = Array.isArray(repository.whyMatch) ? repository.whyMatch.filter(Boolean) : []
  const score = repository.matchScore
  const owner = repository.owner || repository.fullName?.split('/')[0] || 'open-source'

  return (
    <article className={`repo-card ${className}`} style={style} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      <div className="repo-card-top"><span className="match-label"><span className="match-spark">✦</span>{typeof score === 'number' ? <><strong>{score}%</strong><span className="match-caption">MATCH</span></> : 'YOUR MATCH'}</span><span className="card-index-label">OPEN SOURCE · #{repository.id ?? '—'}</span></div>
      <div className="repo-title-row"><div className="repo-avatar" aria-hidden="true">{(repository.name || 'R').slice(0, 1).toUpperCase()}</div><div className="repo-title"><h2>{repository.name || repository.fullName || 'Untitled repository'}</h2><span>@{owner}</span></div>{repository.url && <a className="repo-github-link" href={repository.url} target="_blank" rel="noreferrer" aria-label={`Open ${repository.fullName || repository.name} on GitHub`}><ArrowUpRight size={17} /></a>}</div>
      <p className="repo-description">{repository.description || 'A community-built project looking for its next contributor.'}</p>
      <div className="repo-stats"><span><Star size={14} /> {formatCount(repository.stars)}</span><span><GitFork size={14} /> {formatCount(repository.forks)}</span><span className="language-stat"><i /> {repository.language || 'Open source'}</span></div>
      {topics.length > 0 && <div className="repo-topics">{topics.map((topic) => <span key={topic}>{topic}</span>)}</div>}
      <div className="issue-count-row"><span className="issue-count-dot" />{typeof repository.goodFirstIssueCount === 'number' && repository.goodFirstIssueCount > 0 ? <><strong>{repository.goodFirstIssueCount}</strong> beginner-friendly issues</> : <span>No beginner issues found</span>}</div>
      {reasons.length > 0 && <section className="why-section"><div className="card-section-label">WHY YOU?</div><ul>{reasons.map((reason, index) => <li key={`${index}-${reason}`}><span>✓</span>{reason}</li>)}</ul></section>}
      <IssueCard issue={repository.recommendedIssue} />
    </article>
  )
}

export default RepoCard