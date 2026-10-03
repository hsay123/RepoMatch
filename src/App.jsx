import { useEffect, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import Navbar from './components/Navbar'
import ProfileSetup from './components/ProfileSetup'
import SwipeDeck from './components/SwipeDeck'
import MatchResult from './components/MatchResult'
import Loading from './components/Loading'
import { checkBackendHealth, findMatches } from './services/api'
import './App.css'

const emptyProfile = { skills: [], interests: [], experience: '', contributionTypes: [] }

function App() {
  const [screen, setScreen] = useState('landing')
  const [profile, setProfile] = useState(emptyProfile)
  const [repositories, setRepositories] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [gemmaConnected, setGemmaConnected] = useState(false)

  useEffect(() => {
    let active = true
    checkBackendHealth()
      .then((health) => {
        const reportsAvailable = (value) => value === true
          || ['available', 'connected', 'healthy', 'ok', 'running'].includes(String(value).toLowerCase())
        const connected = reportsAvailable(health?.gemma?.available ?? health?.gemma)
          || reportsAvailable(health?.gemmaAvailable)
          || reportsAvailable(health?.ai?.available)
          || reportsAvailable(health?.services?.gemma)
        if (active) setGemmaConnected(connected)
      })
      .catch(() => { if (active) setGemmaConnected(false) })
    return () => { active = false }
  }, [])

  async function handleFindMatches(nextProfile = profile) {
    setProfile(nextProfile)
    setLoading(true)
    setError(null)
    setScreen('loading')
    try {
      const data = await findMatches(nextProfile)
      const nextRepositories = Array.isArray(data?.repositories) ? data.repositories : []
      setRepositories(nextRepositories)
      setCurrentIndex(0)
      setSelectedMatch(null)
      setScreen(nextRepositories.length ? 'discover' : 'empty')
    } catch (requestError) {
      setError(requestError)
      setScreen('error')
    } finally {
      setLoading(false)
    }
  }

  function handlePass() {
    const nextIndex = currentIndex + 1
    setCurrentIndex(nextIndex)
    if (nextIndex >= repositories.length) setScreen('empty')
  }

  function handleMatch(repository) {
    setSelectedMatch(repository)
    setScreen('match')
  }

  function handleKeepDiscovering() {
    const nextIndex = currentIndex + 1
    setCurrentIndex(nextIndex)
    setScreen(nextIndex >= repositories.length ? 'empty' : 'discover')
  }

  function handleNavigation(destination) {
    if (destination === 'home') setScreen('landing')
    if (destination === 'profile') setScreen('profile')
    if (destination === 'discover') {
      if (!repositories.length) setScreen('profile')
      else setScreen(currentIndex < repositories.length ? 'discover' : 'empty')
    }
  }

  return (
    <div className={`app-shell screen-${screen}`}>
      <Navbar activeScreen={screen} gemmaConnected={gemmaConnected} onNavigate={handleNavigation} />
      {screen === 'landing' && (
        <main className="landing-page">
          <div className="landing-copy">
            <div className="eyebrow-pill"><span className="eyebrow-dot" /> OPEN SOURCE DISCOVERY</div>
            <h1>Find your<br /><span>open-source match.</span></h1>
            <p className="landing-description">Stop scrolling through thousands of repositories. Find projects that match your skills, interests, and experience, then discover where you can make your first contribution.</p>
            <button className="button button-primary landing-cta" onClick={() => setScreen('profile')}>Find My Match <ArrowRight size={17} /></button>
            <div className="powered-note"><Sparkles size={13} /> Powered by local Gemma AI</div>
            <div className="landing-proof"><span className="proof-avatars"><i>J</i><i>M</i><i>A</i></span><span><strong>Better contributions start</strong><br />with a project that fits.</span></div>
          </div>
          <div className="landing-art" aria-label="Preview of a recommended repository">
            <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
            <div className="preview-card">
              <div className="preview-topline"><span className="preview-label"><span /> TOP PICK FOR YOU</span><span className="preview-dots">•••</span></div>
              <div className="preview-score"><strong>94</strong><span>%<br />MATCH</span></div>
              <div className="preview-repo-title"><span className="repo-mark">✳</span><div><h2>OpenSourceAI</h2><span>owner / OpenSourceAI</span></div></div>
              <p className="preview-description">AI-powered developer productivity platform</p>
              <div className="preview-tags"><span>React</span><span>JavaScript</span><span>AI</span></div>
              <div className="preview-divider" />
              <div className="preview-issue"><span className="issue-spark">✦</span><div><small>YOUR FIRST CONTRIBUTION</small><strong>Improve mobile navigation</strong></div><span className="issue-arrow">↗</span></div>
              <button className="preview-heart" aria-label="Start matching with OpenSourceAI" onClick={() => setScreen('profile')}><span>♥</span></button>
            </div>
            <div className="floating-note note-top"><span className="note-icon note-green">✓</span><span><b>Good first issue</b><small>Picked for your skill set</small></span></div>
            <div className="floating-note note-bottom"><span className="note-icon note-pink">♥</span><span><b>Great chemistry</b><small>Skills + interests aligned</small></span></div>
            <div className="art-caption"><span className="caption-line" /> CURATED FOR YOUR NEXT CHAPTER</div>
          </div>
        </main>
      )}
      {screen === 'profile' && <ProfileSetup initialProfile={profile} onSubmit={handleFindMatches} onBack={() => setScreen('landing')} />}
      {loading && <Loading />}
      {screen === 'discover' && !loading && repositories[currentIndex] && <SwipeDeck repository={repositories[currentIndex]} position={currentIndex + 1} total={repositories.length} onPass={handlePass} onMatch={handleMatch} />}
      {screen === 'match' && selectedMatch && <MatchResult repository={selectedMatch} onKeepDiscovering={handleKeepDiscovering} />}
      {screen === 'empty' && (
        <main className="state-page empty-page">
          <div className="state-icon empty-icon"><Sparkles size={25} /></div>
          <span className="section-kicker">YOU'RE ALL CAUGHT UP</span>
          <h1>No more matches for now.</h1>
          <p>We've reached the end of your current deck. Your next great contribution is one profile tweak away.</p>
          <div className="state-actions"><button className="button button-primary" onClick={() => handleFindMatches()}><Sparkles size={16} /> Find More Matches</button><button className="button button-quiet" onClick={() => setScreen('profile')}>Edit My Profile</button></div>
        </main>
      )}
      {screen === 'error' && !loading && <ErrorState error={error} onRetry={() => handleFindMatches()} onEditProfile={() => setScreen('profile')} />}
      <footer className="app-footer"><span>GitHub discovery, live. Gemma intelligence, local.</span><span className="footer-local"><i /> LOCAL AI · GEMMA 4 E2B</span></footer>
    </div>
  )
}

function ErrorState({ error, onRetry, onEditProfile }) {
  const errorCode = String(error?.code || '').toLowerCase()
  const errorMessage = String(error?.message || '').toLowerCase()
  const isGemmaUnavailable = errorCode.includes('gemma') || errorCode.includes('ollama')
    || errorMessage.includes('gemma') || errorMessage.includes('ollama')
  const isGithubRateLimited = errorCode.includes('rate') || errorCode.includes('github')
    || errorMessage.includes('rate limit') || errorMessage.includes('github')
  const message = isGemmaUnavailable
    ? ["Local Gemma isn't available.", 'Start Ollama and make sure gemma4:e2b is installed.']
    : isGithubRateLimited
      ? ['GitHub temporarily limited repository discovery.', 'Give it a moment, then try again.']
      : error?.code === 'backend_unavailable'
        ? ["Can't reach RepoMatch's matching engine.", 'Make sure the backend is running on localhost:3000.']
        : ['Something went wrong while finding your matches.', 'Check that the matching service is available, then try again.']
  return (
    <main className="state-page error-page">
      <div className="state-icon error-icon"><span>!</span></div>
      <span className="section-kicker">MATCHING INTERRUPTED</span>
      <h1>{message[0]}</h1><p>{message[1]}</p>
      <div className="state-actions"><button className="button button-primary" onClick={onRetry}><Sparkles size={16} /> Try Again</button><button className="button button-quiet" onClick={onEditProfile}>Edit My Profile</button></div>
    </main>
  )
}

export default App
