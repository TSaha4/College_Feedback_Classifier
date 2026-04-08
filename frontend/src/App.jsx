import { useState } from 'react'
import RoleSelector from './components/RoleSelector'
import StudentView from './components/StudentView'
import AdminView from './components/AdminView'

export default function App() {
  const [role, setRole] = useState(null)
  const [clicks, setClicks] = useState(0)

  const handleSecretClick = () => {
    setClicks(count => {
      if (count >= 2) {
        setRole('chancellor')
        return 0
      }
      return count + 1
    })
  }

  if (!role) {
    return (
      <div onClick={event => {
        if (String(event.target.className).includes('logo')) handleSecretClick()
      }}>
        <RoleSelector onSelect={setRole} />
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-logo" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={handleSecretClick}>
          Campus<span>Lens</span>
        </div>
        <div className="topbar-role">
          <span className="role-badge" onClick={() => { setRole(null); setClicks(0) }}>
            {role === 'student' ? 'Student Portal' : role === 'admin' ? 'Admin Dashboard' : 'Chancellor Access'} | Switch
          </span>
        </div>
      </header>

      <main className="page-content">
        {role === 'student' ? <StudentView /> : <AdminView />}
      </main>
    </div>
  )
}

function ChancellorView() {
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState([])

  const addLog = message => setLogs(items => [...items, message])

  async function nukeAll() {
    if (!confirm('Supreme Chancellor Override: rusticate the entire campus?')) return
    setLoading(true)
    setLogs([])
    addLog('[SYSTEM] Initiating Supreme Rustication Protocol...')
    try {
      const res = await fetch('/api/reviews')
      const reviews = await res.json()

      const unrusticated = reviews.filter(review => !review.rusticated && review.author?.toLowerCase() !== 'anonymous')
      const uniqueIds = [...new Set(unrusticated.map(review => review.author))]
        .map(author => unrusticated.find(review => review.author === author).id)

      if (uniqueIds.length === 0) {
        addLog('Nothing to do. All non-anonymous students are already rusticated.')
      } else {
        addLog(`Identified ${uniqueIds.length} active students. Proceeding with mass action...`)
        for (let index = 0; index < uniqueIds.length; index += 1) {
          addLog(`[EXECUTING] Rusticating student cluster ${index + 1}...`)
          await fetch(`/api/reviews/${encodeURIComponent(uniqueIds[index])}/rusticate`, { method: 'POST' })
        }
        addLog('Mass rustication complete.')
      }
    } catch (error) {
      addLog(`Critical error: ${error.message}`)
    }
    setLoading(false)
  }

  async function massPardon() {
    if (!confirm('Mercy Protocol: unban all currently rusticated students?')) return
    setLoading(true)
    setLogs([])
    addLog('[SYSTEM] Initiating Mass Pardon Protocol...')
    try {
      const res = await fetch('/api/reviews')
      const reviews = await res.json()

      const rusticated = reviews.filter(review => review.rusticated)
      const uniqueIds = [...new Set(rusticated.map(review => review.author))]
        .map(author => rusticated.find(review => review.author === author).id)

      if (uniqueIds.length === 0) {
        addLog('No rusticated students found.')
      } else {
        addLog(`Identified ${uniqueIds.length} banned students. Processing pardon directives...`)
        for (let index = 0; index < uniqueIds.length; index += 1) {
          await fetch(`/api/reviews/${encodeURIComponent(uniqueIds[index])}/rusticate`, { method: 'POST' })
        }
        addLog('Mass pardon complete.')
      }
    } catch (error) {
      addLog(`Critical error: ${error.message}`)
    }
    setLoading(false)
  }

  async function purgeNegativity() {
    if (!confirm('Propaganda Mode: permanently delete all negative reviews?')) return
    setLoading(true)
    setLogs([])
    addLog('[SYSTEM] Initiating PR Clean Slate Protocol...')
    try {
      const res = await fetch('/api/reviews')
      const reviews = await res.json()
      const negativeReviews = reviews.filter(review => review.sentiment === 'Negative')

      if (negativeReviews.length === 0) {
        addLog('No negative reviews found.')
      } else {
        addLog(`Identified ${negativeReviews.length} negative reviews. Expunging...`)
        for (let index = 0; index < negativeReviews.length; index += 1) {
          await fetch(`/api/reviews/${encodeURIComponent(negativeReviews[index].id)}`, { method: 'DELETE' })
        }
        addLog('Purge complete.')
      }
    } catch (error) {
      addLog(`Critical error: ${error.message}`)
    }
    setLoading(false)
  }

  return (
    <div className="card" style={{ borderColor: '#444', boxShadow: '0 0 40px rgba(0, 0, 0, 0.4)' }}>
      <h2 style={{ color: 'var(--text)', fontWeight: 'bold', fontSize: '1.5rem', marginBottom: '1rem', letterSpacing: '0.05em' }}>
        Chancellor Directive Dashboard
      </h2>
      <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
        Warning: You have bypassed standard administrative controls. Actions here affect live review data.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <button className="btn btn-primary" style={{ backgroundColor: 'var(--negative)', borderColor: 'var(--negative)', padding: '1rem', fontWeight: 800 }} onClick={nukeAll} disabled={loading}>
          {loading ? 'Executing...' : 'Nuclear Option: Rusticate Entire Campus'}
        </button>

        <button className="btn btn-primary" style={{ backgroundColor: 'var(--positive)', borderColor: 'var(--positive)', padding: '1rem', fontWeight: 800, color: '#fff' }} onClick={massPardon} disabled={loading}>
          {loading ? 'Executing...' : 'Mercy Protocol: Pardon All Students'}
        </button>

        <button className="btn btn-primary" style={{ backgroundColor: 'var(--neutral)', borderColor: 'var(--neutral)', padding: '1rem', fontWeight: 800, color: '#fff' }} onClick={purgeNegativity} disabled={loading}>
          {loading ? 'Executing...' : 'PR Mode: Purge All Negative Reviews'}
        </button>
      </div>

      {logs.length > 0 && (
        <div style={{ marginTop: '2rem', background: '#0a0a0a', color: '#10b981', padding: '1.5rem', fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius)', fontSize: '0.85rem', border: '1px solid #333', maxHeight: '300px', overflowY: 'auto' }}>
          {logs.map((log, index) => <div key={index} style={{ marginBottom: '4px' }}>{log}</div>)}
        </div>
      )}
    </div>
  )
}
