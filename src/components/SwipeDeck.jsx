import { useRef, useState } from 'react'
import { Heart, X } from 'lucide-react'
import RepoCard from './RepoCard'

function SwipeDeck({ repository, position, total, onPass, onMatch }) {
  const [offset, setOffset] = useState(0)
  const [exitDirection, setExitDirection] = useState('')
  const pointerStart = useRef(null)
  const actionTimer = useRef(null)

  function decide(direction) {
    if (exitDirection) return
    setExitDirection(direction)
    actionTimer.current = window.setTimeout(() => {
      setExitDirection('')
      setOffset(0)
      if (direction === 'right') onMatch(repository)
      else onPass()
    }, 260)
  }

  function onPointerDown(event) {
    if (event.target.closest('a, button')) return
    pointerStart.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event) {
    if (!pointerStart.current) return
    setOffset(event.clientX - pointerStart.current.x)
  }

  function onPointerUp() {
    if (!pointerStart.current) return
    const distance = offset
    pointerStart.current = null
    if (distance > 105) decide('right')
    else if (distance < -105) decide('left')
    else setOffset(0)
  }

  return (
    <main className="discover-page">
      <div className="discover-heading"><div><span className="section-kicker"><span className="live-dot" /> YOUR DISCOVERY DECK</span><h1>One good project <span>at a time.</span></h1></div><div className="deck-progress"><span>{position}<i> / </i>{total}</span><small>PROJECTS FOR YOU</small><div><i style={{ width: `${Math.min(100, (position / total) * 100)}%` }} /></div></div></div>
      <div className="deck-layout">
        <div className="deck-aside left-aside"><span className="aside-index">01 / PROFILE FIT</span><h2>Built around<br />what <em>you</em> bring.</h2><p>Every recommendation starts with your skills, interests, and the kind of contribution you want to make.</p><div className="aside-stamp"><span>RM</span><small>CURATED<br />FOR YOU</small></div></div>
        <div className="deck-stage">
          <div className="deck-back-card back-card-two" /><div className="deck-back-card back-card-one" />
          <RepoCard repository={repository} className={`active-repo-card ${exitDirection ? `exit-${exitDirection}` : ''}`} style={{ transform: `translateX(${offset}px) rotate(${offset / 24}deg)` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          <div className="swipe-controls"><button className="swipe-button pass-button" onClick={() => decide('left')} aria-label="Pass on this repository"><X size={20} /><span>PASS</span></button><span className="swipe-hint">NOT NOW</span><button className="swipe-button match-button" onClick={() => decide('right')} aria-label="Match with this repository"><Heart size={19} fill="currentColor" /><span>MATCH</span></button></div>
          <p className="drag-hint">OR DRAG THE CARD <span>←</span> <i>PASS</i><span>·</span><i>MATCH</i> <span>→</span></p>
        </div>
        <div className="deck-aside right-aside"><span className="aside-index">02 / FIRST STEP</span><h2>Less browsing.<br /><em>More building.</em></h2><p>Each match comes with a real issue chosen as a practical first contribution.</p><div className="aside-live"><span className="live-dot" /><span>LIVE PROJECT DATA</span></div></div>
      </div>
    </main>
  )
}

export default SwipeDeck