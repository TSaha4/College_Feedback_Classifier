import { useState, useEffect, useCallback } from 'react'

const SENT_PILL = { Positive: 'pill-pos', Negative: 'pill-neg', Neutral: 'pill-neu' }

const SORT_OPTIONS = [
  { key: 'category', label: 'Category', icon: '↕' },
  { key: 'total',    label: 'Total',    icon: '↕' },
  { key: 'positive', label: 'Positive', icon: '↕' },
  { key: 'negative', label: 'Negative', icon: '↕' },
  { key: 'score',    label: 'Score',    icon: '↕' },
]

export default function AdminView() {
  const [tab,       setTab]       = useState('leaderboard')  // 'leaderboard' | 'reviews'
  const [reviews,   setReviews]   = useState([])
  const [lb,        setLb]        = useState([])
  const [loading,   setLoading]   = useState(true)
  const [sortKey,   setSortKey]   = useState('total')
  const [sortDir,   setSortDir]   = useState(-1)             // -1 = desc, 1 = asc
  const [search,    setSearch]    = useState('')
  const [filterSent,setFilterSent]= useState('')
  const [filterCat, setFilterCat] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [rRes, lRes] = await Promise.all([
        fetch('/api/reviews'),
        fetch('/api/leaderboard'),
      ])
      setReviews(await rRes.json())
      setLb(await lRes.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // delete a review
  async function deleteReview(id) {
    if (!confirm('Delete this review?')) return
    await fetch(`/api/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
    fetchData()
  }

  // rusticate a student
  async function rusticateStudent(id) {
    if (!confirm('Take action and rusticate this student?')) return
    await fetch(`/api/reviews/${encodeURIComponent(id)}/rusticate`, { method: 'POST' })
    fetchData()
  }

  // ── derived data ─────────────────────────────────────────
  const sortedLb = [...lb].sort((a, b) => {
    const av = typeof a[sortKey] === 'string' ? a[sortKey] : a[sortKey]
    const bv = typeof b[sortKey] === 'string' ? b[sortKey] : b[sortKey]
    if (typeof av === 'string') return sortDir * av.localeCompare(bv)
    return sortDir * (bv - av)
  })

  const filteredReviews = reviews.filter(r => {
    const matchSearch  = !search     || r.text.toLowerCase().includes(search.toLowerCase()) || r.author.toLowerCase().includes(search.toLowerCase())
    const matchSent    = !filterSent || r.sentiment === filterSent
    const matchCat     = !filterCat  || r.category  === filterCat
    return matchSearch && matchSent && matchCat
  })

  const totalPos = reviews.filter(r => r.sentiment === 'Positive').length
  const totalNeg = reviews.filter(r => r.sentiment === 'Negative').length
  const totalNeu = reviews.filter(r => r.sentiment === 'Neutral').length

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(-1) }
  }

  const cats = [...new Set(reviews.map(r => r.category))].sort()

  // ── render ───────────────────────────────────────────────
  return (
    <div>
      {/* Page title */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.3rem' }}>
          admin dashboard
        </h1>
        <p className="text-dim" style={{ fontSize: '0.82rem' }}>
          view all reviews, analyze sentiment trends, and sort by category performance.
        </p>
      </div>

      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <div className="stat-label">total</div>
          <div className="stat-value">{reviews.length}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">positive</div>
          <div className="stat-value text-pos">{totalPos}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">negative</div>
          <div className="stat-value text-neg">{totalNeg}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">neutral</div>
          <div className="stat-value text-neu">{totalNeu}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">categories</div>
          <div className="stat-value text-accent">{lb.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {['leaderboard', 'reviews'].map(t => (
          <div
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'leaderboard' ? '🏆 leaderboard' : '📝 reviews'}
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-ghost"
            title="Re-run AI classification on all existing reviews"
            disabled={loading}
            onClick={async () => {
              if(!confirm('Re-classify all reviews using the current models? This may take a moment.')) return;
              setLoading(true);
              try {
                await fetch('/api/reviews/reassess', { method: 'POST' });
                await fetchData();
              } catch(e) { console.error(e); setLoading(false); }
            }}
            style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}
          >
            {loading ? '⚙...' : '🔄 reassess'}
          </button>
          <button
            className="btn btn-ghost"
            title="Refresh"
            onClick={fetchData}
            style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}
          >
            ↻ refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
          <span className="spinner" style={{ width: 20, height: 20 }} />
        </div>
      ) : tab === 'leaderboard' ? (
        <LeaderBoard data={sortedLb} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
      ) : (
        <ReviewsFeed
          reviews={filteredReviews}
          search={search} setSearch={setSearch}
          filterSent={filterSent} setFilterSent={setFilterSent}
          filterCat={filterCat}  setFilterCat={setFilterCat}
          cats={cats}
          onDelete={deleteReview}
          onRusticate={rusticateStudent}
        />
      )}
    </div>
  )
}

/* ── Leaderboard sub-component ─────────────────────── */
function LeaderBoard({ data, sortKey, sortDir, onSort }) {
  if (!data.length) return (
    <div className="empty-state">
      <div className="empty-icon">🏆</div>
      <p>No reviews yet. Students need to submit some!</p>
    </div>
  )

  return (
    <div className="card" style={{ padding: '0 0.25rem' }}>
      <table className="lb-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>#</th>
            {SORT_OPTIONS.map(opt => (
              <th
                key={opt.key}
                className={sortKey === opt.key ? 'sorted' : ''}
                onClick={() => onSort(opt.key)}
              >
                {opt.label}
                <span className="sort-icon">
                  {sortKey === opt.key ? (sortDir === -1 ? '▼' : '▲') : '⇅'}
                </span>
              </th>
            ))}
            <th>Sentiment Mix</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const total = row.total || 1
            const posW  = (row.positive / total) * 100
            const negW  = (row.negative / total) * 100
            const neuW  = (row.neutral  / total) * 100
            const scoreColor = row.score > 0 ? 'var(--positive)' : row.score < 0 ? 'var(--negative)' : 'var(--neutral)'

            return (
              <tr key={row.category}>
                <td className="lb-rank">{i + 1}</td>
                <td className="lb-cat-name">{row.category}</td>
                <td className="mono" style={{ color: 'var(--text-sub)' }}>{row.total}</td>
                <td className="mono text-pos">{row.positive}</td>
                <td className="mono text-neg">{row.negative}</td>
                <td className="mono" style={{ color: scoreColor, fontWeight: 600 }}>
                  {row.score > 0 ? '+' : ''}{row.score}
                </td>
                <td style={{ minWidth: 120 }}>
                  <div className="sentiment-bar">
                    <div className="bar-pos" style={{ width: `${posW}%` }} title={`Positive: ${row.positive}`} />
                    <div className="bar-neu" style={{ width: `${neuW}%` }} title={`Neutral: ${row.neutral}`} />
                    <div className="bar-neg" style={{ width: `${negW}%` }} title={`Negative: ${row.negative}`} />
                  </div>
                  <div className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 3 }}>
                    {posW.toFixed(0)}% · {neuW.toFixed(0)}% · {negW.toFixed(0)}%
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Reviews Feed sub-component ────────────────────── */
function ReviewsFeed({ reviews, search, setSearch, filterSent, setFilterSent, filterCat, setFilterCat, cats, onDelete, onRusticate }) {
  return (
    <>
      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="form-input"
          placeholder="search reviews…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="select-input" value={filterSent} onChange={e => setFilterSent(e.target.value)}>
          <option value="">all sentiments</option>
          <option value="Positive">positive</option>
          <option value="Negative">negative</option>
          <option value="Neutral">neutral</option>
        </select>
        <select className="select-input" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">all categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {!reviews.length ? (
        <div className="empty-state">
          <div className="empty-icon">📝</div>
          <p>{search || filterSent || filterCat ? 'No reviews match your filters.' : 'No reviews yet.'}</p>
        </div>
      ) : (
        <div className="card">
          {reviews.map(r => (
            <div key={r.id} className="review-item">
              <div className="review-header">
                <span className="review-author" style={{ textDecoration: r.rusticated ? 'line-through' : 'none', color: r.rusticated ? 'var(--negative)' : undefined }}>@{r.author}</span>
                {r.rusticated && <span className="pill pill-neg" style={{marginLeft: '0'}}>BANNED</span>}
                <span className={`pill pill-cat`}>{r.category}</span>
                <span className={`pill ${r.sentiment === 'Positive' ? 'pill-pos' : r.sentiment === 'Negative' ? 'pill-neg' : 'pill-neu'}`}>
                  {r.sentiment}
                </span>
                
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                  <button className="review-delete" onClick={() => onRusticate(r.id)} title={r.rusticated ? "Unban student" : "Rusticate student"}>
                    🔨
                  </button>
                  <button className="review-delete" onClick={() => onDelete(r.id)} title="Delete review">
                    ✕
                  </button>
                </div>
              </div>
              <div className="review-text">"{r.text}"</div>
              <div className="review-meta">
                {r.timestamp} &nbsp;·&nbsp; cat {r.cat_confidence}% &nbsp;·&nbsp; sent {r.sent_confidence}%
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
