import { useCallback, useEffect, useState } from 'react'

// ── Icons (inline SVG helpers) ────────────────────────────────────────────────
const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const ICONS = {
  grid:    'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  list:    'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  cpu:     'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  zap:     'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  search:  'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
  filter:  'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  trash:   'M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  chevron: 'M9 18l6-6-6-6',
  star:    'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  bar:     'M18 20V10M12 20V4M6 20v-6',
  shield:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
}

const SENTIMENT_COLORS = {
  Positive: '#10b981',
  Neutral:  '#f59e0b',
  Negative: '#ef4444',
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AdminView({ role, onSwitch }) {
  const [tab, setTab]               = useState('overview')
  const [reviews, setReviews]       = useState([])
  const [analytics, setAnalytics]   = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterSent, setFilterSent] = useState('')
  const [filterCat, setFilterCat]   = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin-data')
      const data = await res.json()
      setReviews(data.reviews)
      setAnalytics(data.analytics)
      setEvaluation(data.evaluation)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function deleteReview(id) {
    if (!confirm('Delete this review?')) return
    await fetch(`/api/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
    fetchData()
  }

  async function reassessReviews() {
    if (!confirm('Re-classify all reviews using current models?')) return
    setLoading(true)
    try {
      await fetch('/api/reviews/reassess', { method: 'POST' })
      await fetchData()
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const filteredReviews = reviews.filter(r => {
    const matchSearch = !search
      || r.text.toLowerCase().includes(search.toLowerCase())
      || r.author.toLowerCase().includes(search.toLowerCase())
    const matchSent = !filterSent || r.sentiment === filterSent
    const matchCat  = !filterCat  || r.category  === filterCat
    return matchSearch && matchSent && matchCat
  })

  const categories = [...new Set(reviews.map(r => r.category))].sort()

  const statCards = analytics ? [
    { label: 'Total Reviews',       value: analytics.overview.total_reviews,              icon: ICONS.list,   color: '#6366f1' },
    { label: 'Categories Tracked',  value: analytics.overview.categories,                 icon: ICONS.grid,   color: '#10b981' },
    { label: 'Avg Category Conf.',  value: `${analytics.overview.avg_cat_confidence}%`,   icon: ICONS.shield, color: '#f59e0b' },
    { label: 'Avg Sentiment Conf.', value: `${analytics.overview.avg_sent_confidence}%`,  icon: ICONS.zap,    color: '#0d7a7a' },
  ] : []

  const NAV = [
    { id: 'overview',    label: 'Overview',    icon: ICONS.grid },
    { id: 'performance', label: 'Performance', icon: ICONS.cpu  },
    { id: 'reviews',     label: 'Reviews',     icon: ICONS.list },
  ]

  return (
    <div className="adm-shell">
      {/* ── Sidebar ── */}
      <aside className="adm-sidebar">
        <div className="adm-sidebar-logo">
          <span className="adm-logo-dot" />
          Campus<span>Lens</span>
        </div>

        <div className="adm-sidebar-section-label">Main Menu</div>
        <nav className="adm-nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`adm-nav-item ${tab === n.id ? 'active' : ''}`}
              onClick={() => setTab(n.id)}
            >
              <Icon d={n.icon} size={17} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="adm-sidebar-spacer" />

        <div className="adm-action-group">
          <button className="adm-sidebar-btn adm-btn-action" onClick={reassessReviews} disabled={loading}>
            <Icon d={ICONS.zap} size={15} />
            {loading ? 'Processing…' : 'Re‑assess Reviews'}
          </button>
          <button className="adm-sidebar-btn adm-btn-ghost" onClick={fetchData}>
            <Icon d={ICONS.refresh} size={15} />
            Refresh
          </button>
          {onSwitch && (
            <button className="adm-sidebar-btn adm-btn-ghost adm-btn-switch" onClick={onSwitch}>
              ← Switch Role
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="adm-main">
        {/* Top bar */}
        <header className="adm-topbar">
          <div>
            <div className="adm-page-eyebrow">Admin Intelligence</div>
            <h1 className="adm-page-title">
              {tab === 'overview' ? 'Dashboard Overview' : tab === 'performance' ? 'Model Performance' : 'Reviews Feed'}
            </h1>
          </div>
          <div className="adm-topbar-right">
            <span className="adm-topbar-role">Admin</span>
            <div className="adm-avatar">A</div>
          </div>
        </header>

        {/* Stat cards */}
        {analytics && (
          <div className="adm-stat-row">
            {statCards.map(s => (
              <div key={s.label} className="adm-stat-card">
                <div className="adm-stat-icon" style={{ background: `${s.color}18`, color: s.color }}>
                  <Icon d={s.icon} size={19} />
                </div>
                <div>
                  <div className="adm-stat-label">{s.label}</div>
                  <div className="adm-stat-value">{s.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab body */}
        <div className="adm-body">
          {loading || !analytics || !evaluation ? (
            <div className="adm-loading">
              <span className="spinner spinner-dark" />
              <span>Loading dashboard data…</span>
            </div>
          ) : (
            <>
              {tab === 'overview'    && <OverviewPanel    analytics={analytics} />}
              {tab === 'performance' && <PerformancePanel evaluation={evaluation} />}
              {tab === 'reviews'     && (
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
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// ── Overview ───────────────────────────────────────────────────────────────────
function OverviewPanel({ analytics }) {
  return (
    <div className="adm-panel-stack">

      {/* Executive Summary — full width */}
      <div className="adm-card adm-card-accent">
        <SectionHeader title="Executive Summary" icon={ICONS.star} />
        <div className="adm-exec-body">
          <h2 className="adm-summary-headline">{analytics.summary.headline}</h2>
          <div className="adm-signal-row">
            {analytics.summary.signals.map(s => (
              <div className="adm-signal-pill" key={s.label}>
                <span>{s.label}</span>
                <strong>{s.value}</strong>
              </div>
            ))}
          </div>
          <div className="adm-rec-grid">
            {analytics.summary.recommendations.map(item => (
              <div className="adm-rec-item" key={item}>
                <span className="adm-rec-bullet" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3-col row — stretch so cards are even height */}
      <div className="adm-grid-3">
        <div className="adm-card">
          <SectionHeader title="Sentiment Mix" icon={ICONS.bar} />
          <ChartList data={analytics.sentiment_distribution} compact />
        </div>
        <div className="adm-card">
          <SectionHeader title="Category Distribution" icon={ICONS.grid} />
          <ChartList data={analytics.category_distribution} compact />
        </div>
        <div className="adm-card">
          <SectionHeader title="Submission Trend" icon={ICONS.bar} />
          <TrendBars data={analytics.trend} />
        </div>
      </div>

      {/* Leaderboard + Confidence side by side, both capped to same height */}
      <div className="adm-grid-2 adm-grid-equal">
        <div className="adm-card adm-card-scroll">
          <SectionHeader title="Leaderboard Snapshot" icon={ICONS.star} />
          <LeaderboardMini data={analytics.leaderboard} />
        </div>
        <div className="adm-card adm-card-scroll">
          <SectionHeader title="Confidence Radar" icon={ICONS.shield} />
          <ConfidenceList points={analytics.confidence_points} />
        </div>
      </div>

      <div className="adm-card">
        <SectionHeader title="Topic Clusters" icon={ICONS.zap} />
        <TopicClusters clusters={analytics.topic_clusters} />
      </div>
    </div>
  )
}

// ── Performance ────────────────────────────────────────────────────────────────
function PerformancePanel({ evaluation }) {
  return (
    <div className="adm-panel-stack">
      <div className="adm-grid-2">
        <ModelMetricCard
          title="Category Model"
          subtitle={`${evaluation.holdout_size.category} holdout reviews`}
          metrics={evaluation.category}
          accentColor="#6366f1"
        />
        <ModelMetricCard
          title="Sentiment Model"
          subtitle={`${evaluation.holdout_size.sentiment} holdout reviews`}
          metrics={evaluation.sentiment}
          accentColor="#10b981"
        />
      </div>

      <div className="adm-grid-2">
        <div className="adm-card">
          <SectionHeader title="Category Confusion Matrix" icon={ICONS.grid} />
          <ConfusionMatrix matrix={evaluation.category.confusion_matrix} />
        </div>
        <div className="adm-card">
          <SectionHeader title="Sentiment Confusion Matrix" icon={ICONS.grid} />
          <ConfusionMatrix matrix={evaluation.sentiment.confusion_matrix} />
        </div>
      </div>

      <div className="adm-grid-2">
        <div className="adm-card">
          <SectionHeader title="Category Error Samples" icon={ICONS.filter} />
          <ErrorList items={evaluation.category.sample_errors} />
        </div>
        <div className="adm-card">
          <SectionHeader title="Sentiment Error Samples" icon={ICONS.filter} />
          <ErrorList items={evaluation.sentiment.sample_errors} />
        </div>
      </div>
    </div>
  )
}

// ── Reviews Feed ───────────────────────────────────────────────────────────────
function ReviewsFeed({ reviews, categories, search, setSearch, filterSent, setFilterSent, filterCat, setFilterCat, onDelete }) {
  return (
    <div className="adm-panel-stack">
      <div className="adm-card">
        <div className="adm-filter-row">
          <div className="adm-search-wrap adm-filter-search">
            <Icon d={ICONS.search} size={14} />
            <input
              className="adm-search"
              placeholder="Search reviews or authors…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="adm-select" value={filterSent} onChange={e => setFilterSent(e.target.value)}>
            <option value="">All Sentiments</option>
            <option value="Positive">Positive</option>
            <option value="Negative">Negative</option>
            <option value="Neutral">Neutral</option>
          </select>
          <select className="adm-select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {!reviews.length ? (
          <div className="adm-empty">
            <div className="adm-empty-icon">
              <Icon d={ICONS.search} size={32} />
            </div>
            <p>{search || filterSent || filterCat ? 'No reviews match the current filters.' : 'No reviews yet.'}</p>
          </div>
        ) : (
          <div className="adm-reviews-table">
            <div className="adm-table-head">
              <span>Author</span>
              <span>Review</span>
              <span>Category</span>
              <span>Sentiment</span>
              <span>Confidence</span>
              <span>Date</span>
              <span></span>
            </div>
            {reviews.map(r => (
              <div key={r.id} className="adm-table-row">
                <span className="adm-author">@{r.author}</span>
                <span className="adm-review-text" title={r.text}>{r.text}</span>
                <span><Badge type="cat">{r.category}</Badge></span>
                <span>
                  <Badge type={r.sentiment === 'Positive' ? 'pos' : r.sentiment === 'Negative' ? 'neg' : 'neu'}>
                    {r.sentiment}
                  </Badge>
                </span>
                <span>
                  <ConfBar value={r.cat_confidence} label={`${r.cat_confidence}%`} />
                </span>
                <span className="adm-date-cell">{r.timestamp}</span>
                <span>
                  <button className="adm-delete-btn" onClick={() => onDelete(r.id)} title="Delete">
                    <Icon d={ICONS.trash} size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function SectionHeader({ title, icon }) {
  return (
    <div className="adm-section-header">
      <span className="adm-section-icon">
        <Icon d={icon} size={14} />
      </span>
      <span className="adm-section-title">{title}</span>
    </div>
  )
}

function Badge({ type, children }) {
  return <span className={`adm-badge adm-badge-${type}`}>{children}</span>
}

function ConfBar({ value, label }) {
  return (
    <div className="adm-conf-row">
      <div className="adm-conf-track">
        <div className="adm-conf-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="adm-conf-label">{label}</span>
    </div>
  )
}

function ModelMetricCard({ title, subtitle, metrics, accentColor }) {
  return (
    <div className="adm-card adm-metric-card">
      <SectionHeader title={title} icon={ICONS.cpu} />
      <div className="adm-metric-scores">
        {[
          { val: metrics.accuracy,    lbl: 'Accuracy'    },
          { val: metrics.macro_f1,    lbl: 'Macro F1'    },
          { val: metrics.weighted_f1, lbl: 'Weighted F1' },
        ].map(m => (
          <div className="adm-metric-score" key={m.lbl}>
            <div className="adm-metric-big" style={{ color: accentColor }}>{m.val}%</div>
            <div className="adm-metric-lbl">{m.lbl}</div>
          </div>
        ))}
      </div>
      <p className="adm-metric-sub">{subtitle}</p>
      <div className="adm-per-class">
        {metrics.per_class.map(row => (
          <div className="adm-per-class-row" key={row.label}>
            <span className="adm-per-class-name">{row.label}</span>
            <ConfBar value={row.f1} label={`${row.f1}% F1`} />
            <span className="adm-per-class-sup">{row.support} samples</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfusionMatrix({ matrix }) {
  const maxVal = Math.max(...matrix.matrix.flat(), 1)
  return (
    <div className="adm-matrix">
      <div className="adm-matrix-row">
        <div className="adm-matrix-corner" />
        {matrix.labels.map(l => <div key={l} className="adm-matrix-label">{l}</div>)}
      </div>
      {matrix.matrix.map((row, ri) => (
        <div key={matrix.labels[ri]} className="adm-matrix-row">
          <div className="adm-matrix-label adm-matrix-side">{matrix.labels[ri]}</div>
          {row.map((val, ci) => (
            <div
              key={`${ri}-${ci}`}
              className="adm-matrix-cell"
              style={{ opacity: 0.2 + (val / maxVal) * 0.8 }}
            >{val}</div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ErrorList({ items }) {
  if (!items.length) return <p className="adm-empty-inline">No mistakes in the sampled holdout set.</p>
  return (
    <div className="adm-error-list">
      {items.map((item, i) => (
        <div className="adm-error-item" key={i}>
          <div className="adm-error-meta">
            <Badge type="neg">{item.actual}</Badge>
            <span className="adm-arrow">→</span>
            <Badge type="neu">{item.predicted}</Badge>
            <span className="adm-conf-txt">{item.confidence}%</span>
          </div>
          <p className="adm-error-text">{item.text}</p>
        </div>
      ))}
    </div>
  )
}

function ChartList({ data, compact = false }) {
  const maxVal = Math.max(...data.map(d => d.value), 1)
  return (
    <div className={`adm-chart-list${compact ? ' adm-chart-list-compact' : ''}`}>
      {data.map(item => (
        <div className="adm-chart-row" key={item.label}>
          <div className="adm-chart-label">{item.label}</div>
          <div className="adm-chart-track">
            <div
              className="adm-chart-fill"
              style={{
                width: `${(item.value / maxVal) * 100}%`,
                background: SENTIMENT_COLORS[item.label] || '#6366f1',
              }}
            />
          </div>
          <div className="adm-chart-value">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function TrendBars({ data }) {
  if (!data.length) return <p className="adm-empty-inline">Need dated reviews to show a trend.</p>
  const maxVal = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="adm-trend-bars">
      {data.map(item => (
        <div className="adm-trend-wrap" key={item.date}>
          <div
            className="adm-trend-bar"
            style={{ height: `${30 + (item.count / maxVal) * 110}px` }}
            title={`${item.date}: ${item.count}`}
          >
            <span className="adm-trend-count">{item.count}</span>
          </div>
          <div className="adm-trend-label">{item.date.slice(5)}</div>
        </div>
      ))}
    </div>
  )
}

function LeaderboardMini({ data }) {
  const top = [...data].sort((a, b) => b.score - a.score).slice(0, 5)
  return (
    <div className="adm-lb">
      {top.map((row, i) => (
        <div className="adm-lb-row" key={row.category}>
          <span className="adm-lb-rank">#{i + 1}</span>
          <div className="adm-lb-info">
            <strong>{row.category}</strong>
            <span className="adm-lb-total">{row.total} reviews</span>
          </div>
          <div className="adm-lb-pills">
            <span className="adm-badge adm-badge-pos">{row.positive} pos</span>
            <span className="adm-badge adm-badge-neg">{row.negative} neg</span>
            <span className="adm-lb-score" style={{ color: row.score >= 0 ? '#10b981' : '#ef4444' }}>
              {row.score > 0 ? '+' : ''}{row.score}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ConfidenceList({ points }) {
  if (!points.length) return <p className="adm-empty-inline">Confidence analytics appear after a few reviews.</p>
  return (
    <div className="adm-conf-list">
      {points.map((p, i) => (
        <div className="adm-conf-item" key={i}>
          <div className="adm-conf-info">
            <strong>{p.category}</strong>
            <span className="adm-conf-sent">{p.sentiment}</span>
          </div>
          <div className="adm-conf-bars">
            <ConfBar value={p.cat_confidence}  label={`Cat ${p.cat_confidence}%`} />
            <ConfBar value={p.sent_confidence} label={`Sent ${p.sent_confidence}%`} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TopicClusters({ clusters }) {
  if (!clusters.clusters.length) return <p className="adm-empty-inline">Need at least three reviews to discover recurring themes.</p>
  return (
    <div className="adm-cluster-grid">
      {clusters.clusters.map(c => (
        <div className="adm-cluster-card" key={c.id}>
          <div className="adm-cluster-head">
            <strong className="adm-cluster-title">{c.title}</strong>
            <Badge type="cat">{c.size} reviews</Badge>
          </div>
          <div className="adm-keyword-row">
            {c.keywords.map(kw => <span className="adm-keyword" key={kw}>{kw}</span>)}
          </div>
          <div className="adm-cluster-meta">
            <span>Top: {c.top_category}</span>
            <span className="adm-badge adm-badge-pos">+{c.sentiment_mix.Positive || 0}</span>
            <span className="adm-badge adm-badge-neg">-{c.sentiment_mix.Negative || 0}</span>
          </div>
          <div className="adm-cluster-examples">
            {c.examples.map(ex => (
              <div className="adm-cluster-example" key={ex.id}>
                <Badge type={ex.sentiment === 'Positive' ? 'pos' : ex.sentiment === 'Negative' ? 'neg' : 'neu'}>
                  {ex.sentiment}
                </Badge>
                <p>{ex.text}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
