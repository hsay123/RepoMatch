import { Compass, Heart, Sparkles, UserRound } from 'lucide-react'

function Navbar({ activeScreen, gemmaConnected, onNavigate }) {
  return (
    <header className="navbar">
      <button className="brand-button" onClick={() => onNavigate('home')} aria-label="RepoMatch home">
        <span className="brand-symbol"><Heart size={17} fill="currentColor" /></span>
        <span>repo<span className="brand-match">match</span><small>OPEN SOURCE, WELL MATCHED</small></span>
      </button>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={activeScreen === 'discover' ? 'nav-link active' : 'nav-link'} onClick={() => onNavigate('discover')}><Compass size={15} /> Discover</button>
        <button className={activeScreen === 'profile' ? 'nav-link active' : 'nav-link'} onClick={() => onNavigate('profile')}><UserRound size={15} /> My Profile</button>
      </nav>
      <div className={`ai-status ${gemmaConnected ? 'connected' : 'offline'}`} aria-live="polite">
        <span className="status-led" />
        <span><b>{gemmaConnected ? 'LOCAL GEMMA · CONNECTED' : 'LOCAL GEMMA · OFFLINE'}</b><small><Sparkles size={11} /> Gemma 4 E2B · {gemmaConnected ? 'running locally' : 'connection unverified'}</small></span>
      </div>
    </header>
  )
}

export default Navbar