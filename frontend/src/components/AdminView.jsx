import { useCallback, useEffect, useState } from 'react'

const ADMIN_CACHE_KEY = 'campuslens-admin-cache'

let adminViewCache = {
  reviews: null,
  analytics: null,
  evaluation: null,
}

function loadAdminCache() {
  if (adminViewCache.reviews && adminViewCache.analytics) {
    return adminViewCache
  }

  try {
    const rawCache = sessionStorage.getItem(ADMIN_CACHE_KEY)
    if (!rawCache) return adminViewCache

    const parsed = JSON.parse(rawCache)
    adminViewCache = {
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : null,
      analytics: parsed.analytics || null,
      evaluation: parsed.evaluation || null,
    }
  } catch (error) {
    console.error('Failed to restore admin cache', error)
  }

  return adminViewCache
}

function saveAdminCache(nextCache) {
  adminViewCache = {
    ...adminViewCache,
    ...nextCache,
  }

  try {
    sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(adminViewCache))
  } catch (error) {
    console.error('Failed to persist admin cache', error)
  }
}

function clearAdminCache() {
  adminViewCache = {
    reviews: null,
    analytics: null,
    evaluation: null,
  }

  try {
    sessionStorage.removeItem(ADMIN_CACHE_KEY)
  } catch (error) {
    console.error('Failed to clear admin cache', error)
  }
}

export default function AdminView() {
  const cachedData = loadAdminCache()
  const [tab, setTab] = useState('overview')
  const [reviews, setReviews] = useState(cachedData.reviews || [])
  const [analytics, setAnalytics] = useState(cachedData.analytics)
  const [evaluation, setEvaluation] = useState(cachedData.evaluation)
  const [loadingDashboard, setLoadingDashboard] = useState(!cachedData.reviews || !cachedData.analytics)
  const [loadingEvaluation, setLoadingEvaluation] = useState(false)
  const [search, setSearch] = useState('')
  const [filterSent, setFilterSent] = useState('')
  const [filterCat, setFilterCat] = useState('')

  const fetchDashboard = useCallback(async ({ force = false } = {}) => {
    if (!force && adminViewCache.reviews && adminViewCache.analytics) {
      setReviews(adminViewCache.reviews)
      setAnalytics(adminViewCache.analytics)
      setLoadingDashboard(false)
      return
    }

    setLoadingDashboard(true)
    try {
      const [reviewsRes, analyticsRes] = await Promise.all([
        fetch('/api/reviews'),
        fetch('/api/analytics'),
      ])

      const nextReviews = await reviewsRes.json()
      const nextAnalytics = await analyticsRes.json()
      setReviews(nextReviews)
      setAnalytics(nextAnalytics)
      saveAdminCache({
        reviews: nextReviews,
        analytics: nextAnalytics,
      })
    } catch (error) {
      console.error(error)
    } finally {
      setLoadingDashboard(false)
    }
  }, [])

  const fetchEvaluation = useCallback(async ({ force = false } = {}) => {
    if (!force && adminViewCache.evaluation) {
      setEvaluation(adminViewCache.evaluation)
      return
    }

    setLoadingEvaluation(true)
    try {
      const evaluationRes = await fetch('/api/evaluation')
      const nextEvaluation = await evaluationRes.json()
      setEvaluation(nextEvaluation)
      saveAdminCache({ evaluation: nextEvaluation })
    } catch (error) {
      console.error(error)
    } finally {
      setLoadingEvaluation(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  useEffect(() => {
    if (tab === 'performance' && !evaluation && !loadingEvaluation) {
      fetchEvaluation()
    }
  }, [evaluation, fetchEvaluation, loadingEvaluation, tab])

  async function deleteReview(id) {
    if (!confirm('Delete this review?')) return
    await fetch(`/api/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
    clearAdminCache()
    fetchDashboard({ force: true })
  }

  async function rusticateStudent(id) {
    if (!confirm('Take action and rusticate this student?')) return
    await fetch(`/api/reviews/${encodeURIComponent(id)}/rusticate`, { method: 'POST' })
    clearAdminCache()
    fetchDashboard({ force: true })
  }

  async function reassessReviews() {
    if (!confirm('Re-classify all reviews using the current models? This may take a moment.')) return
    setLoadingDashboard(true)
    setLoadingEvaluation(true)
    try {
      await fetch('/api/reviews/reassess', { method: 'POST' })
      clearAdminCache()
      await Promise.all([
        fetchDashboard({ force: true }),
        tab === 'performance' ? fetchEvaluation({ force: true }) : Promise.resolve(),
      ])
    } catch (error) {
      console.error(error)
      setLoadingDashboard(false)
      setLoadingEvaluation(false)
    }
  }

  async function refreshAdminData() {
    clearAdminCache()
    await Promise.all([
      fetchDashboard({ force: true }),
      tab === 'performance' ? fetchEvaluation({ force: true }) : Promise.resolve(),
    ])
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
          <button className="btn btn-primary" onClick={reassessReviews} disabled={loadingDashboard || loadingEvaluation}>
            {loadingDashboard || loadingEvaluation ? 'processing...' : 'reassess reviews'}
          </button>
          <button className="btn btn-ghost" onClick={refreshAdminData} disabled={loadingDashboard || loadingEvaluation}>
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

      {loadingDashboard || !analytics ? (
        <div className="loading-panel">
          <span className="spinner spinner-dark" />
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <OverviewPanel analytics={analytics} />
          )}
          {tab === 'performance' && (
            loadingEvaluation || !evaluation ? (
              <div className="loading-panel">
                <span className="spinner spinner-dark" />
              </div>
            ) : (
              <PerformancePanel evaluation={evaluation} />
            )
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
      <section className="double-grid overview-grid">
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

        <div className="card action-plan-card">
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
