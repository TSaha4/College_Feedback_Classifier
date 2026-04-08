import { useState } from 'react'

const SENT_CLASS = { Positive: 'text-pos', Negative: 'text-neg', Neutral: 'text-neu' }
const SENT_PILL  = { Positive: 'pill-pos', Negative: 'pill-neg', Neutral: 'pill-neu' }

export default function StudentView() {
  const [author,  setAuthor]  = useState('')
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim()) { setError('Please write something first.'); return }
    setError('')
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), author: author.trim() || 'Anonymous' }),
      })
      if (!res.ok) throw new Error('Server error. Is the backend running?')
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setText('')
    setAuthor('')
    setResult(null)
    setError('')
  }

  return (
    <div>
      {/* Title */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.3rem' }}>
          post a review
        </h1>
        <p className="text-dim" style={{ fontSize: '0.82rem' }}>
          write about academics, facilities, faculty, hostel, mess, or anything else — our AI will classify it.
        </p>
      </div>

      {/* Form card */}
      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">your name (optional)</label>
            <input
              className="form-input"
              type="text"
              placeholder="Anonymous"
              value={author}
              onChange={e => setAuthor(e.target.value)}
              maxLength={60}
            />
          </div>

          <div className="form-group">
            <label className="form-label">your review</label>
            <textarea
              className="form-textarea"
              placeholder="The faculty in the CS department is extremely helpful and always available during office hours..."
              value={text}
              onChange={e => { setText(e.target.value); setError('') }}
              maxLength={1000}
            />
            <div className="text-dim mono" style={{ fontSize: '0.72rem', textAlign: 'right', marginTop: '4px' }}>
              {text.length} / 1000
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--negative)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
              ⚠ {error}
            </div>
          )}

          <button
            className="btn btn-primary btn-full"
            type="submit"
            disabled={loading}
          >
            {loading
              ? <><span className="spinner" /> analyzing…</>
              : '✦ analyze & submit'
            }
          </button>
        </form>
      </div>

      {/* Result */}
      {result && (
        <div className="result-box">
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
            ai prediction
          </div>

          <div className="result-chips">
            {/* Category chip */}
            <div className="chip">
              <div className="chip-label">category</div>
              <div className="chip-value text-accent">{result.category}</div>
              <div className="chip-conf">{result.cat_confidence}% confidence</div>
            </div>

            {/* Sentiment chip */}
            <div className="chip">
              <div className="chip-label">sentiment</div>
              <div className={`chip-value ${SENT_CLASS[result.sentiment]}`}>{result.sentiment}</div>
              <div className="chip-conf">{result.sent_confidence}% confidence</div>
            </div>
          </div>

          {/* Category probability breakdown */}
          {result.all_cats && (
            <div>
              <div className="text-dim" style={{ fontSize: '0.72rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                category probabilities
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {Object.entries(result.all_cats)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, prob]) => (
                    <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="mono text-dim" style={{ fontSize: '0.72rem', width: '100px' }}>{cat}</div>
                      <div style={{
                        flex: 1, height: '4px', borderRadius: '99px',
                        background: 'var(--border)', overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${prob}%`, height: '100%',
                          background: cat === result.category
                            ? 'var(--accent)'
                            : 'rgba(136,192,208,0.28)',
                          borderRadius: '99px', transition: 'width 0.6s ease'
                        }} />
                      </div>
                      <div className="mono text-dim" style={{ fontSize: '0.72rem', width: '38px', textAlign: 'right' }}>
                        {prob}%
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={resetForm} style={{ fontSize: '0.8rem' }}>
              ↩ submit another
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
