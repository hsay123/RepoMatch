import { ArrowRight, Check, Heart, Sparkles } from 'lucide-react'
import IssueCard from './IssueCard'

function MatchResult({ repository, onKeepDiscovering }) {
  const reasons = Array.isArray(repository.whyMatch) ? repository.whyMatch.filter(Boolean) : []
  return (
    <main className="match-page">
      <div className="match-celebration"><span className="confetti confetti-one" /><span className="confetti confetti-two" /><span className="confetti confetti-three" /><div className="match-heart"><Heart size={28} fill="currentColor" /></div><span className="section-kicker"><Sparkles size={13} /> GOOD CHEMISTRY FOUND</span><h1>It's a <span>match!</span></h1><p>You and this repository have chemistry.</p></div>
      <section className="match-summary"><div className="match-summary-main"><span className="repo-avatar">{(repository.name || 'R').slice(0, 1).toUpperCase()}</span><div><span className="match-repo-owner">{repository.fullName || repository.name}</span><h2>{repository.name || 'Open-source repository'}</h2></div></div><div className="match-score-summary"><strong>{typeof repository.matchScore === 'number' ? `${repository.matchScore}%` : '—'}</strong><span>COMPATIBILITY</span></div></section>
      <div className="match-details">
        {reasons.length > 0 && <section className="match-why"><span className="card-section-label">WHY IT MATCHES</span><ul>{reasons.map((reason, index) => <li key={`${index}-${reason}`}><Check size={15} />{reason}</li>)}</ul></section>}
        <IssueCard issue={repository.recommendedIssue} compact />
      </div>
      <div className="match-actions"><button className="button button-primary" onClick={onKeepDiscovering}>Keep Discovering <ArrowRight size={16} /></button><span>One contribution can lead anywhere.</span></div>
    </main>
  )
}

export default MatchResult