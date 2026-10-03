import { ArrowUpRight, Sparkles } from 'lucide-react'

function IssueCard({ issue, compact = false }) {
  if (!issue) return <p className="missing-issue">No specific issue recommendation available.</p>
  const skills = Array.isArray(issue.skills) ? issue.skills : []

  return (
    <div className={`issue-card ${compact ? 'compact' : ''}`}>
      <div className="issue-card-heading"><span className="issue-spark"><Sparkles size={14} /></span><span>YOUR FIRST CONTRIBUTION</span></div>
      <h3>{issue.title || 'Recommended issue'}</h3>
      <div className="issue-meta"><span className="issue-number">#{issue.number ?? '—'}</span>{issue.difficulty && <span className="difficulty-pill">{issue.difficulty}</span>}</div>
      {issue.explanation && <p className="issue-explanation">{issue.explanation}</p>}
      {skills.length > 0 && <div className="issue-skills" aria-label="Relevant skills">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}
      {issue.url && <a className="issue-link" href={issue.url} target="_blank" rel="noreferrer">{compact ? 'Open Issue on GitHub' : 'View Issue'} <ArrowUpRight size={14} /></a>}
    </div>
  )
}

export default IssueCard