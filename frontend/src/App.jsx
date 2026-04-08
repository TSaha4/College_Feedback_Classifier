import { useState } from 'react'
import RoleSelector from './components/RoleSelector'
import StudentView from './components/StudentView'
import AdminView from './components/AdminView'

export default function App() {
  const [role, setRole] = useState(null) // null | 'student' | 'admin' | 'chancellor'
  const [clicks, setClicks] = useState(0)

  const handleSecretClick = () => {
    setClicks(c => {
      if (c >= 2) {
        setRole('chancellor')
        return 0
      }
      return c + 1
    })
  }

  if (!role) return (
    <div onClick={(e) => {
      // Only trigger secret if they click near top title of role selector
      if(e.target.className.includes('logo')) handleSecretClick()
    }}>
      <RoleSelector onSelect={setRole} />
    </div>
  )

  return (
    <div className="shell">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-logo" style={{cursor: 'pointer', userSelect: 'none'}} onClick={handleSecretClick}>
          campus<span>lens</span>
        </div>
        <div className="topbar-role">
          <span className="role-badge" onClick={() => { setRole(null); setClicks(0); }}>
            {role === 'student' ? '🎓 student' : role === 'admin' ? '🔑 admin' : '👁 chancellor'} · switch
          </span>
        </div>
      </header>

      {/* Page content */}
      <main className="page-content">
        {role === 'student' ? <StudentView /> : role === 'admin' ? <AdminView /> : <ChancellorView />}
      </main>
    </div>
  )
}

function ChancellorView() {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);

  const addLog = (msg) => setLogs(l => [...l, msg]);

  // Option 1: Rusticate Everyone
  async function nukeAll() {
    if(!confirm("SUPREME CHANCELLOR OVERRIDE: Execute Order 66 and rusticate the entire campus?")) return;
    setLoading(true); setLogs([]);
    addLog("[SYSTEM] Initiating Supreme Rustication Protocol...");
    try {
      const res = await fetch('/api/reviews');
      const reviews = await res.json();
      
      const unrusticated = reviews.filter(r => !r.rusticated && r.author?.toLowerCase() !== 'anonymous');
      const uniqueIds = [...new Set(unrusticated.map(r => r.author))].map(author => unrusticated.find(r => r.author === author).id);

      if (uniqueIds.length === 0) {
        addLog("Nothing to do. All non-anonymous students are already rusticated.");
      } else {
        addLog(`Identified ${uniqueIds.length} active innocent students. Proceeding with mass ban...`);
        for (let i = 0; i < uniqueIds.length; i++) {
          addLog(`[EXECUTING] Rusticaticating student cluster ${i+1}...`);
          await fetch(`/api/reviews/${encodeURIComponent(uniqueIds[i])}/rusticate`, { method: 'POST' });
        }
        addLog("MASS RUSTICATION COMPLETE. THE CAMPUS IS SILENT.");
      }
    } catch(e) { addLog(`CRITICAL ERROR: ${e.message}`); }
    setLoading(false);
  }

  // Option 2: Pardon Everyone
  async function massPardon() {
    if(!confirm("MERCY PROTOCOL: Are you sure you wish to un-ban all currently rusticated students?")) return;
    setLoading(true); setLogs([]);
    addLog("[SYSTEM] Initiating Mass Pardon Protocol...");
    try {
      const res = await fetch('/api/reviews');
      const reviews = await res.json();
      
      const rusticated = reviews.filter(r => r.rusticated);
      const uniqueIds = [...new Set(rusticated.map(r => r.author))].map(author => rusticated.find(r => r.author === author).id);

      if (uniqueIds.length === 0) {
        addLog("Campus is fully cooperative. No rusticated students to pardon.");
      } else {
        addLog(`Identified ${uniqueIds.length} banned students. Processing mercy directives...`);
        for (let i = 0; i < uniqueIds.length; i++) {
          await fetch(`/api/reviews/${encodeURIComponent(uniqueIds[i])}/rusticate`, { method: 'POST' });
        }
        addLog("MASS PARDON COMPLETE. SECOND CHANCES GRANTED.");
      }
    } catch(e) { addLog(`CRITICAL ERROR: ${e.message}`); }
    setLoading(false);
  }

  // Option 3: Purge Negativity (Delete all negative reviews)
  async function purgeNegativity() {
    if(!confirm("PROPAGANDA MODE: Permanently delete all negative reviews to artificially boost rankings?")) return;
    setLoading(true); setLogs([]);
    addLog("[SYSTEM] Initiating PR Clean Slate Protocol...");
    try {
      const res = await fetch('/api/reviews');
      const reviews = await res.json();
      const negativeReviews = reviews.filter(r => r.sentiment === 'Negative');

      if (negativeReviews.length === 0) {
        addLog("PR is perfect. No negative reviews found on campus.");
      } else {
        addLog(`Identified ${negativeReviews.length} negative reviews polluting the ecosystem. Expunging...`);
        for (let i = 0; i < negativeReviews.length; i++) {
          await fetch(`/api/reviews/${encodeURIComponent(negativeReviews[i].id)}`, { method: 'DELETE' });
        }
        addLog("PURGE COMPLETE. THE CAMPUS IMAGE IS FLAWLESS ONCE MORE.");
      }
    } catch(e) { addLog(`CRITICAL ERROR: ${e.message}`); }
    setLoading(false);
  }

  return (
    <div className="card" style={{borderColor: '#444', boxShadow: '0 0 40px rgba(0, 0, 0, 0.4)'}}>
      <h2 style={{color: 'var(--text)', fontWeight: 'bold', fontSize: '1.5rem', marginBottom: '1rem', letterSpacing: '0.05em'}}>
        👁 CHANCELLOR DIRECTIVE DASHBOARD
      </h2>
      <p style={{color: 'var(--text-dim)', marginBottom: '2rem'}}>
        Warning: You have bypassed standard administrative red tape. Actions here are irrevocable.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <button className="btn btn-primary" style={{backgroundColor: 'var(--negative)', borderColor: 'var(--negative)', padding: '1rem', fontWeight: 800}} onClick={nukeAll} disabled={loading}>
          {loading ? 'EXECUTING...' : '☢ NUCLEAR OPTION: RUSTICATE ENTIRE CAMPUS'}
        </button>

        <button className="btn btn-primary" style={{backgroundColor: 'var(--positive)', borderColor: 'var(--positive)', padding: '1rem', fontWeight: 800, color: '#fff'}} onClick={massPardon} disabled={loading}>
          {loading ? 'EXECUTING...' : '🕊 MERCY PROTOCOL: PARDON ALL STUDENTS'}
        </button>

        <button className="btn btn-primary" style={{backgroundColor: 'var(--neutral)', borderColor: 'var(--neutral)', padding: '1rem', fontWeight: 800, color: '#fff'}} onClick={purgeNegativity} disabled={loading}>
          {loading ? 'EXECUTING...' : '🔥 PR MODE: PURGE ALL NEGATIVE REVIEWS'}
        </button>
      </div>

      {logs.length > 0 && (
        <div style={{marginTop: '2rem', background: '#0a0a0a', color: '#10b981', padding: '1.5rem', fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius)', fontSize: '0.85rem', border: '1px solid #333', maxHeight: '300px', overflowY: 'auto'}}>
          {logs.map((log, i) => <div key={i} style={{marginBottom: '4px'}}>{log}</div>)}
        </div>
      )}
    </div>
  );
}
