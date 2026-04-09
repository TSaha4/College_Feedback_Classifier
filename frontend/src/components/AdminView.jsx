import { useCallback, useEffect, useState } from 'react'

const SENTIMENT_COLORS = {
  Positive: 'var(--positive)',
  Neutral: 'var(--neutral)',
  Negative: 'var(--negative)',
}

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
    const matchCat = !filterCat || review.category === filterCat
    return matchSearch && matchSent && matchCat
  })

  const categories = [...new Set(reviews.map(review => review.category))].sort()
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
      <section className="summary-grid">
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
          <div className="card-title">sentiment mix</div>
          <ChartList data={analytics.sentiment_distribution} />
        </div>
      </section>

      <section className="double-grid">
        <div className="card">
          <div className="card-title">category distribution</div>
          <ChartList data={analytics.category_distribution} />
        </div>

        <div className="card">
          <div className="card-title">submission trend</div>
          <TrendBars data={analytics.trend} />
        </div>
      </section>

      <section className="double-grid">
        <div className="card">
          <div className="card-title">leaderboard snapshot</div>
          <LeaderboardMini data={analytics.leaderboard} />
        </div>

        <div className="card">
          <div className="card-title">confidence radar</div>
          <ConfidenceList points={analytics.confidence_points} />
        </div>
      </section>

      <section className="card">
        <div className="card-title">topic clusters</div>
        <TopicClusters clusters={analytics.topic_clusters} />
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

      <section className="double-grid">
        <div className="card">
          <div className="card-title">category confusion matrix</div>
          <ConfusionMatrix matrix={evaluation.category.confusion_matrix} />
        </div>
        <div className="card">
          <div className="card-title">sentiment confusion matrix</div>
          <ConfusionMatrix matrix={evaluation.sentiment.confusion_matrix} />
        </div>
      </section>

      <section className="double-grid">
        <div className="card">
          <div className="card-title">category error samples</div>
          <ErrorList items={evaluation.category.sample_errors} />
        </div>
        <div className="card">
          <div className="card-title">sentiment error samples</div>
          <ErrorList items={evaluation.sentiment.sample_errors} />
        </div>
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

              <div className="review-metric-row">
                <MetricChip label="category confidence" value={`${review.cat_confidence}%`} />
                <MetricChip label="sentiment confidence" value={`${review.sent_confidence}%`} />
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

function ConfusionMatrix({ matrix }) {
  const maxValue = Math.max(...matrix.matrix.flat(), 1)

  return (
    <div className="matrix-wrap">
      <div className="matrix-row">
        <div className="matrix-corner" />
        {matrix.labels.map(label => (
          <div className="matrix-label" key={label}>{label}</div>
        ))}
      </div>
      {matrix.matrix.map((row, rowIndex) => (
        <div className="matrix-row" key={matrix.labels[rowIndex]}>
          <div className="matrix-label matrix-side">{matrix.labels[rowIndex]}</div>
          {row.map((value, colIndex) => (
            <div
              key={`${rowIndex}-${colIndex}`}
              className="matrix-cell"
              style={{ opacity: 0.25 + (value / maxValue) * 0.75 }}
            >
              {value}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ErrorList({ items }) {
  if (!items.length) {
    return <div className="empty-inline">No mistakes in the sampled holdout set.</div>
  }

  return (
    <div className="error-list">
      {items.map((item, index) => (
        <div className="error-item" key={`${item.actual}-${item.predicted}-${index}`}>
          <div className="error-meta">
            <span className="pill pill-neg">{item.actual}</span>
            <span className="pill pill-neu">{item.predicted}</span>
            <span className="mono text-dim">{item.confidence}%</span>
          </div>
          <div className="error-text">{item.text}</div>
        </div>
      ))}
    </div>
  )
}

function ChartList({ data }) {
  const maxValue = Math.max(...data.map(item => item.value), 1)

  return (
    <div className="chart-list">
      {data.map(item => (
        <div className="chart-row" key={item.label}>
          <div className="chart-label">{item.label}</div>
          <div className="chart-track">
            <div
              className="chart-fill"
              style={{
                width: `${(item.value / maxValue) * 100}%`,
                background: SENTIMENT_COLORS[item.label] || 'var(--accent)',
              }}
            />
          </div>
          <div className="chart-value">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function TrendBars({ data }) {
  if (!data.length) {
    return <div className="empty-inline">Need dated reviews to show a trend.</div>
  }

  const maxValue = Math.max(...data.map(item => item.count), 1)

  return (
    <div className="trend-bars">
      {data.map(item => (
        <div className="trend-bar-wrap" key={item.date}>
          <div className="trend-bar" style={{ height: `${36 + (item.count / maxValue) * 120}px` }} />
          <div className="trend-count">{item.count}</div>
          <div className="trend-label">{item.date.slice(5)}</div>
        </div>
      ))}
    </div>
  )
}

function LeaderboardMini({ data }) {
  const topRows = [...data]
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)

  return (
    <div className="leaderboard-mini">
      {topRows.map(row => (
        <div className="leaderboard-row" key={row.category}>
          <div>
            <strong>{row.category}</strong>
            <div className="text-dim">{row.total} reviews</div>
          </div>
          <div className="leaderboard-metrics">
            <span className="text-pos">{row.positive} pos</span>
            <span className="text-neg">{row.negative} neg</span>
            <span className="mono">{row.score > 0 ? '+' : ''}{row.score}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ConfidenceList({ points }) {
  if (!points.length) {
    return <div className="empty-inline">Confidence analytics will appear after a few reviews.</div>
  }

  return (
    <div className="confidence-list">
      {points.map((point, index) => (
        <div className="confidence-row" key={`${point.category}-${index}`}>
          <div>
            <strong>{point.category}</strong>
            <div className="text-dim">{point.sentiment}</div>
          </div>
          <div className="confidence-bars">
            <div className="mini-track">
              <div className="mini-fill" style={{ width: `${point.cat_confidence}%` }} />
            </div>
            <div className="mini-track secondary">
              <div className="mini-fill" style={{ width: `${point.sent_confidence}%`, background: 'var(--positive)' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function TopicClusters({ clusters }) {
  if (!clusters.clusters.length) {
    return <div className="empty-inline">Need at least three reviews to discover recurring themes.</div>
  }

  return (
    <div className="cluster-grid">
      {clusters.clusters.map(cluster => (
        <div className="cluster-card" key={cluster.id}>
          <div className="cluster-head">
            <strong>{cluster.title}</strong>
            <span className="pill pill-cat">{cluster.size} reviews</span>
          </div>
          <div className="keyword-row">
            {cluster.keywords.map(keyword => (
              <span className="keyword-chip" key={keyword}>{keyword}</span>
            ))}
          </div>
          <div className="cluster-meta">
            <span>top category: {cluster.top_category}</span>
            <span>positive: {cluster.sentiment_mix.Positive || 0}</span>
            <span>negative: {cluster.sentiment_mix.Negative || 0}</span>
          </div>
          <div className="cluster-examples">
            {cluster.examples.map(example => (
              <div className="cluster-example" key={example.id}>
                <span className={`pill ${example.sentiment === 'Positive' ? 'pill-pos' : example.sentiment === 'Negative' ? 'pill-neg' : 'pill-neu'}`}>
                  {example.sentiment}
                </span>
                <p>{example.text}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MetricChip({ label, value }) {
  return (
    <div className="metric-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
