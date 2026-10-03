import { useEffect, useState } from 'react'
import { Check, Circle, Heart, Search } from 'lucide-react'

const steps = ['Reading your skills', 'Searching open-source projects', 'Finding contribution opportunities', 'Finding your best match']

function Loading() {
  const [activeStep, setActiveStep] = useState(1)
  useEffect(() => {
    const timer = window.setInterval(() => setActiveStep((step) => Math.min(steps.length - 1, step + 1)), 1500)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <main className="loading-page" aria-live="polite">
      <div className="loading-visual"><span className="loading-orbit orbit-a" /><span className="loading-orbit orbit-b" /><span className="loading-heart"><Heart size={24} fill="currentColor" /></span><span className="loading-search"><Search size={16} /></span></div>
      <span className="section-kicker"><span className="loading-led" /> LOCAL AI AT WORK</span>
      <h1>Finding your <span>matches...</span></h1>
      <p className="loading-subtitle">Gemma is finding the projects that fit you best.</p>
      <div className="loading-steps">{steps.map((step, index) => <div key={step} className={`loading-step ${index < activeStep ? 'complete' : ''} ${index === activeStep ? 'current' : ''}`}>{index < activeStep ? <Check size={15} /> : index === activeStep ? <span className="step-spinner" /> : <Circle size={14} />}<span>{step}</span></div>)}</div>
    </main>
  )
}

export default Loading