import { useState } from 'react'

const SENT_CLASS = { Positive: 'text-pos', Negative: 'text-neg', Neutral: 'text-neu' }

export default function StudentView() {
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    if (!text.trim()) {
      setError('Please write a review before submitting.')
      return
    }

    setError('')
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), author: author.trim() || 'Anonymous' }),
      })
      if (!res.ok) throw new Error('Server error. Please make sure the backend is running.')
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
    <div className="student-shell">
      <section className="student-hero student-hero-simple">
        <div className="student-hero-copy">
          <div className="eyebrow">Student Portal</div>
          <h1>Share your campus feedback.</h1>
          <p>
            Submit a short review and CampusLens will identify the category, sentiment, and confidence behind it.
          </p>
        </div>
      </section>

      <section className="student-grid">
        <div className="card student-form-card">
          <div className="card-title">Submit Review</div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Your Name</label>
              <input
                className="form-input"
                type="text"
                placeholder="Anonymous"
                value={author}
                onChange={event => setAuthor(event.target.value)}
                maxLength={60}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Your Review</label>
              <textarea
                className="form-textarea student-textarea"
                placeholder="Example: The faculty is supportive, but hostel maintenance needs improvement."
                value={text}
                onChange={event => {
                  setText(event.target.value)
                  setError('')
                }}
                maxLength={1000}
              />
              <div className="student-form-meta">
                <span>Be specific for better predictions.</span>
                <span className="mono">{text.length} / 1000</span>
              </div>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="student-actions">
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? <><span className="spinner" /> Analyzing...</> : 'Analyze and Submit'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={resetForm}>
                Clear
              </button>
            </div>
          </form>
        </div>

        <div className="student-result-panel">
          {result ? (
            <div className="result-box student-result-box">
              <div className="result-header">
                <div>
                  <div className="card-title">Prediction Summary</div>
                  <h2>Review analyzed successfully.</h2>
                </div>
                <button className="btn btn-ghost" onClick={resetForm}>
                  Submit Another
                </button>
              </div>

              <div className="result-chips">
                <div className="chip feature-chip">
                  <div className="chip-label">Category</div>
                  <div className="chip-value text-accent">{result.category}</div>
                  <div className="chip-conf">{result.cat_confidence}% confidence</div>
                </div>

                <div className="chip feature-chip">
                  <div className="chip-label">Sentiment</div>
                  <div className={`chip-value ${SENT_CLASS[result.sentiment]}`}>{result.sentiment}</div>
                  <div className="chip-conf">{result.sent_confidence}% confidence</div>
                </div>
              </div>

              {result.all_cats && (
                <div className="probability-card">
                  <div className="card-title">Category Probabilities</div>
                  <div className="probability-list">
                    {Object.entries(result.all_cats)
                      .sort((left, right) => right[1] - left[1])
                      .map(([category, probability]) => (
                        <div key={category} className="probability-row">
                          <div className="probability-label">{category}</div>
                          <div className="probability-track">
                            <div
                              className={`probability-fill ${category === result.category ? 'is-winner' : ''}`}
                              style={{ width: `${probability}%` }}
                            />
                          </div>
                          <div className="probability-value">{probability}%</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="student-empty-state">
              <div className="card-title">Prediction Summary</div>
              <h2>Your result will appear here.</h2>
              <p>After submission, you will see the detected category, sentiment, and confidence breakdown.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
