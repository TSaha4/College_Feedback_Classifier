import { useCallback, useEffect, useState } from 'react'

export default function AdminView() {
  const [tab, setTab] = useState('overview')
  const [reviews, setReviews] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterSent, setFilterSent] = useState('')
  const [filterCat, setFilterCat] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [reviewsRes, analyticsRes, evaluationRes] = await Promise.all([
        fetch('/api/reviews'),
        fetch('/api/analytics'),
        fetch('/api/evaluation'),
      ])

      setReviews(await reviewsRes.json())
      setAnalytics(await analyticsRes.json())
      setEvaluation(await evaluationRes.json())
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function deleteReview(id) {
    if (!confirm('Delete this review?')) return
    await fetch(`/api/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
    fetchData()
  }

  async function rusticateStudent(id) {
    if (!confirm('Take action and rusticate this student?')) return
    await fetch(`/api/reviews/${encodeURIComponent(id)}/rusticate`, { method: 'POST' })
    fetchData()
  }

  async function reassessReviews() {
    if (!confirm('Re-classify all reviews using the current models? This may take a moment.')) return
    setLoading(true)
    try {
      await fetch('/api/reviews/reassess', { method: 'POST' })
      await fetchData()
    } catch (error) {
      console.error(error)
      setLoading(false)
    }
  }

  const filteredReviews = reviews.filter(review => {
    const matchSearch = !search
      || review.text.toLowerCase().includes(search.toLowerCase())
      || review.author.toLowerCase().includes(search.toLowerCase())
    const matchSent = !filterSent || review.sentiment === filterSent
    const reviewCategories = review.detected_categories || [review.category]
    const matchCat = !filterCat || reviewCategories.includes(filterCat)
    return matchSearch && matchSent && matchCat
  })

  const categories = [...new Set(
    reviews.flatMap(review => review.detected_categories || [review.category]),
  )].sort()
  const overviewCards = analytics ? [
    { label: 'total reviews', value: analytics.overview.total_reviews },
    { label: 'tracked categories', value: analytics.overview.categories },
    { label: 'avg category confidence', value: `${analytics.overview.avg_cat_confidence}%` },
    { label: 'avg sentiment confidence', value: `${analytics.overview.avg_sent_confidence}%` },
  ] : []

  return (
    <div className="dashboard-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Campus Analytics</div>
          <h1>Admin Intelligence Dashboard</h1>
          <p>
            Review live feedback, model quality, hidden complaint themes, and action-ready recommendations in one place.
          </p>
        </div>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={reassessReviews} disabled={loading}>
            {loading ? 'processing...' : 'reassess reviews'}
          </button>
          <button className="btn btn-ghost" onClick={fetchData}>
            refresh
          </button>
        </div>
      </section>

      <div className="stats-grid">
        {overviewCards.map(card => (
          <div className="stat-panel" key={card.label}>
            <div className="stat-label">{card.label}</div>
            <div className="stat-value">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="tabs dashboard-tabs">
        {['overview', 'performance', 'reviews'].map(name => (
          <div
            key={name}
            className={`tab ${tab === name ? 'active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </div>
        ))}
      </div>

      {loading || !analytics || !evaluation ? (
        <div className="loading-panel">
          <span className="spinner spinner-dark" />
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <OverviewPanel analytics={analytics} />
          )}
          {tab === 'performance' && (
            <PerformancePanel evaluation={evaluation} />
          )}
          {tab === 'reviews' && (
            <ReviewsFeed
              reviews={filteredReviews}
              categories={categories}
              search={search}
              setSearch={setSearch}
              filterSent={filterSent}
              setFilterSent={setFilterSent}
              filterCat={filterCat}
              setFilterCat={setFilterCat}
              onDelete={deleteReview}
              onRusticate={rusticateStudent}
            />
          )}
        </>
      )}
    </div>
  )
}

function OverviewPanel({ analytics }) {
  return (
    <div className="panel-stack">
      <section className="double-grid">
        <div className="card summary-card">
          <div className="card-title">executive summary</div>
          <h2 className="summary-headline">{analytics.summary.headline}</h2>
          <div className="signal-row">
            {analytics.summary.signals.map(signal => (
              <div className="signal-pill" key={signal.label}>
                <span>{signal.label}</span>
                <strong>{signal.value}</strong>
              </div>
            ))}
          </div>
          <div className="recommendation-list">
            {analytics.summary.recommendations.map(item => (
              <div className="recommendation-item" key={item}>{item}</div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">negative action plan</div>
          <ActionPlanList items={analytics.action_plan} />
        </div>
      </section>

      <section className="card">
        <div className="card-title">priority categories</div>
          <LeaderboardMini data={analytics.leaderboard} />
      </section>
    </div>
  )
}

function PerformancePanel({ evaluation }) {
  return (
    <div className="panel-stack">
      <section className="double-grid">
        <ModelMetricCard
          title="category model"
          subtitle={`${evaluation.holdout_size.category} holdout reviews`}
          metrics={evaluation.category}
        />
        <ModelMetricCard
          title="sentiment model"
          subtitle={`${evaluation.holdout_size.sentiment} holdout reviews`}
          metrics={evaluation.sentiment}
        />
      </section>
    </div>
  )
}

function ReviewsFeed({
  reviews,
  categories,
  search,
  setSearch,
  filterSent,
  setFilterSent,
  filterCat,
  setFilterCat,
  onDelete,
  onRusticate,
}) {
  return (
    <>
      <div className="filter-bar dashboard-filter">
        <input
          className="form-input"
          placeholder="search reviews..."
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        <select className="select-input" value={filterSent} onChange={event => setFilterSent(event.target.value)}>
          <option value="">all sentiments</option>
          <option value="Positive">positive</option>
          <option value="Negative">negative</option>
          <option value="Neutral">neutral</option>
        </select>
        <select className="select-input" value={filterCat} onChange={event => setFilterCat(event.target.value)}>
          <option value="">all categories</option>
          {categories.map(category => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </div>

      {!reviews.length ? (
        <div className="empty-state">
          <div className="empty-icon">[]</div>
          <p>{search || filterSent || filterCat ? 'No reviews match the current filters.' : 'No reviews yet.'}</p>
        </div>
      ) : (
        <div className="card">
          {reviews.map(review => (
            <div key={review.id} className="review-item">
              <div className="review-header">
                <span
                  className="review-author"
                  style={{
                    textDecoration: review.rusticated ? 'line-through' : 'none',
                    color: review.rusticated ? 'var(--negative)' : undefined,
                  }}
                >
                  @{review.author}
                </span>
                {review.rusticated && <span className="pill pill-neg">banned</span>}
                <span className="pill pill-cat">{review.category}</span>
                {review.is_multi_category && <span className="pill pill-multi">multi-topic</span>}
                <span className={`pill ${review.sentiment === 'Positive' ? 'pill-pos' : review.sentiment === 'Negative' ? 'pill-neg' : 'pill-neu'}`}>
                  {review.sentiment}
                </span>
                <div className="review-actions">
                  <button className="review-delete" onClick={() => onRusticate(review.id)}>
                    {review.rusticated ? 'unban' : 'rusticate'}
                  </button>
                  <button className="review-delete" onClick={() => onDelete(review.id)}>
                    delete
                  </button>
                </div>
              </div>

              <div className="review-text">"{review.text}"</div>

              {!!review.detected_categories?.length && (
                <div className="review-tags-row">
                  {review.detected_categories.map(category => (
                    <span
                      key={`${review.id}-${category}`}
                      className={`pill ${category === review.category ? 'pill-cat' : 'pill-multi-soft'}`}
                    >
                      {category}
                    </span>
                  ))}
                </div>
              )}

              {review.sentiment === 'Negative' && (
                <div className="review-suggestion">
                  <strong>Suggested admin action:</strong> {getReviewSuggestion(review)}
                </div>
              )}

              <div className="review-metric-row">
                <MetricChip label="category" value={`${review.cat_confidence}%`} />
                <MetricChip label="sentiment" value={`${review.sent_confidence}%`} />
                <MetricChip label="submitted" value={review.timestamp} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function ModelMetricCard({ title, subtitle, metrics }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="model-score-grid">
        <div>
          <div className="metric-big">{metrics.accuracy}%</div>
          <div className="metric-caption">accuracy</div>
        </div>
        <div>
          <div className="metric-big">{metrics.macro_f1}%</div>
          <div className="metric-caption">macro f1</div>
        </div>
        <div>
          <div className="metric-big">{metrics.weighted_f1}%</div>
          <div className="metric-caption">weighted f1</div>
        </div>
      </div>
      <p className="text-dim metric-subtitle">{subtitle}</p>
      <div className="per-class-table">
        {metrics.per_class.map(row => (
          <div className="per-class-row" key={row.label}>
            <span>{row.label}</span>
            <span>{row.f1}% F1</span>
            <span>{row.support} samples</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeaderboardMini({ data }) {
  const topRows = [...data]
    .sort((left, right) => (right.negative / Math.max(1, right.total)) - (left.negative / Math.max(1, left.total)))
    .slice(0, 5)

  return (
    <div className="leaderboard-mini">
      {topRows.map(row => (
        <div className="leaderboard-row" key={row.category}>
          <div>
            <strong>{row.category}</strong>
            <div className="text-dim">{row.negative} negative of {row.total}</div>
          </div>
          <div className="leaderboard-metrics">
            <span className="text-neg">{Math.round((row.negative / Math.max(1, row.total)) * 100)}% neg</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ActionPlanList({ items }) {
  if (!items.length) {
    return <div className="empty-inline">No negative feedback trends yet.</div>
  }

  return (
    <div className="action-plan-list">
      {items.map(item => (
        <div className="action-plan-item" key={item.category}>
          <div className="action-plan-head">
            <strong>{item.category}</strong>
            <span className="pill pill-neg">{item.share}% negative</span>
          </div>
          <div className="text-dim action-plan-meta">{item.negative} of {item.total} reviews are negative</div>
          {item.actions.map(action => (
            <div className="recommendation-item compact" key={action}>{action}</div>
          ))}
        </div>
      ))}
    </div>
  )
}

function getReviewSuggestion(review) {
  const primaryCategory = (review.detected_categories && review.detected_categories[0]) || review.category
  const suggestions = {
    Academics: 'review workload, class scheduling, and support sessions for the affected subjects.',
    Administration: 'check process delays, communication gaps, and unresolved office requests.',
    Facilities: 'inspect the reported infrastructure issue and assign a maintenance follow-up.',
    Faculty: 'review teaching conduct concerns with the department and collect section-wise feedback.',
    Hostel: 'verify hostel operations, cleanliness, and maintenance response for that block.',
    Mess: 'inspect food quality, hygiene, and menu consistency with the mess team.',
    Others: 'manually review this complaint and assign it to the right team for follow-up.',
  }
  return suggestions[primaryCategory] || suggestions.Others
}

function MetricChip({ label, value }) {
  return (
    <div className="metric-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
