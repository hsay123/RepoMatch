import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react'

const skills = ['JavaScript', 'React', 'Node.js', 'Python', 'Java', 'C++', 'C', 'TypeScript', 'HTML/CSS', 'SQL', 'Go', 'Rust']
const interests = ['AI', 'Machine Learning', 'Web Development', 'Developer Tools', 'Open Source', 'Cybersecurity', 'Cloud', 'Data Science', 'Mobile', 'DevOps']
const contributionTypes = ['Good First Issues', 'Bug Fixes', 'Documentation', 'UI/UX', 'Features', 'AI/ML', 'Testing']
const experienceLevels = [
  { value: 'beginner', title: 'BEGINNER', description: 'Just getting started', code: '01' },
  { value: 'intermediate', title: 'INTERMEDIATE', description: 'Comfortable building projects', code: '02' },
  { value: 'advanced', title: 'ADVANCED', description: 'Ready for complex contributions', code: '03' },
]

function ProfileSetup({ initialProfile, onSubmit, onBack }) {
  const isEditing = initialProfile.skills?.length > 0
  const [profile, setProfile] = useState(() => ({
    skills: initialProfile.skills || [],
    interests: initialProfile.interests || [],
    experience: initialProfile.experience || '',
    contributionTypes: initialProfile.contributionTypes || [],
  }))
  const [showValidation, setShowValidation] = useState(false)

  function toggle(field, value) {
    setProfile((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
    }))
  }

  function submit(event) {
    event.preventDefault()
    if (!profile.skills.length || !profile.experience) {
      setShowValidation(true)
      return
    }
    onSubmit(profile)
  }

  return (
    <main className="profile-page">
      <div className="profile-heading">
        <span className="section-kicker"><Sparkles size={13} /> YOUR DEVELOPER PROFILE</span>
        <h1>Let's find your <span>type.</span></h1>
        <p>Tell us what you know and what you want to build.</p>
      </div>
      <form className="profile-form" onSubmit={submit}>
        <section className="profile-section">
          <div className="section-heading"><div><span className="section-number">01</span><div><h2>What are you good at?</h2><p>Pick the tools and languages you know</p></div></div><span className="selection-count">{profile.skills.length} SELECTED</span></div>
          <div className="chip-list">
            {skills.map((skill) => <button key={skill} type="button" className={`choice-chip ${profile.skills.includes(skill) ? 'selected' : ''}`} aria-pressed={profile.skills.includes(skill)} onClick={() => toggle('skills', skill)}>{profile.skills.includes(skill) && <Check size={13} />}{skill}</button>)}
          </div>
          {showValidation && !profile.skills.length && <p className="validation-message">Choose at least one skill.</p>}
        </section>
        <section className="profile-section">
          <div className="section-heading"><div><span className="section-number">02</span><div><h2>What are you interested in?</h2><p>We'll find projects that keep you curious</p></div></div><span className="selection-count">{profile.interests.length} SELECTED</span></div>
          <div className="chip-list interest-list">
            {interests.map((interest) => <button key={interest} type="button" className={`choice-chip ${profile.interests.includes(interest) ? 'selected' : ''}`} aria-pressed={profile.interests.includes(interest)} onClick={() => toggle('interests', interest)}>{profile.interests.includes(interest) && <Check size={13} />}{interest}</button>)}
          </div>
        </section>
        <section className="profile-section">
          <div className="section-heading"><div><span className="section-number">03</span><div><h2>What's your experience level?</h2><p>There's a good first issue at every level</p></div></div></div>
          <div className="experience-grid">
            {experienceLevels.map((level) => <button key={level.value} type="button" className={`experience-option ${profile.experience === level.value ? 'selected' : ''}`} aria-pressed={profile.experience === level.value} onClick={() => setProfile((current) => ({ ...current, experience: level.value }))}><span>{level.code}</span><strong>{level.title}</strong><small>{level.description}</small>{profile.experience === level.value && <Check className="experience-check" size={15} />}</button>)}
          </div>
          {showValidation && !profile.experience && <p className="validation-message">Choose an experience level.</p>}
        </section>
        <section className="profile-section contribution-section">
          <div className="section-heading"><div><span className="section-number">04</span><div><h2>What kind of contribution are you looking for?</h2><p>Optional · select as many as you like</p></div></div><span className="optional-label">OPTIONAL</span></div>
          <div className="chip-list">
            {contributionTypes.map((type) => <button key={type} type="button" className={`choice-chip ${profile.contributionTypes.includes(type) ? 'selected' : ''}`} aria-pressed={profile.contributionTypes.includes(type)} onClick={() => toggle('contributionTypes', type)}>{profile.contributionTypes.includes(type) && <Check size={13} />}{type}</button>)}
          </div>
        </section>
        <div className="profile-submit-row"><span><span className="required-dot" /> Skills and experience are required</span><button className="button button-primary" type="submit">{isEditing ? 'Update Matches' : 'Find My Matches'} <ArrowRight size={16} /></button></div>
      </form>
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={14} /> Back to RepoMatch</button>
    </main>
  )
}

export default ProfileSetup