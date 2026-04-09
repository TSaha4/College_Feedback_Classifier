export default function RoleSelector({ onSelect }) {
  return (
    <div className="role-selector">
      <div className="role-selector-logo">CampusLens</div>
      <div className="role-selector-tagline">AI-powered College Review Intelligence Platform</div>
      <div className="role-selector-lead">
        Choose a portal to submit student feedback or explore the analytics dashboard.
      </div>

      <div className="role-cards">
        <div className="role-card" onClick={() => onSelect('student')}>
          <div className="role-icon">Student</div>
          <h3>Student Portal</h3>
          <p>Share your college experience and get instant AI insight on your review.</p>
        </div>

        <div className="role-card" onClick={() => onSelect('admin')}>
          <div className="role-icon">Admin</div>
          <h3>Admin Dashboard</h3>
          <p>Review feedback trends, model performance, and analytics-driven recommendations.</p>
        </div>
      </div>
    </div>
  )
}
