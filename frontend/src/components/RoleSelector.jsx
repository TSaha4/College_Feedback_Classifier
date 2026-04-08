export default function RoleSelector({ onSelect }) {
  return (
    <div className="role-selector">
      <div className="role-selector-logo">campuslens</div>
      <div className="role-selector-tagline">ai-powered college review platform</div>

      <div className="role-cards">
        <div className="role-card" onClick={() => onSelect('student')}>
          <div className="role-icon">🎓</div>
          <h3>Student</h3>
          <p>Share your college experience. Get AI-powered insight on your review.</p>
        </div>

        <div className="role-card" onClick={() => onSelect('admin')}>
          <div className="role-icon">🔑</div>
          <h3>Admin</h3>
          <p>View all reviews, sentiment analytics, and the category leaderboard.</p>
        </div>
      </div>
    </div>
  )
}
