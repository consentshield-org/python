export function ScoreGauge({
  score,
  level,
}: {
  score: number
  level: 'red' | 'amber' | 'green'
}) {
  const radius = 56
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  const color =
    level === 'green' ? '#16a34a' : level === 'amber' ? '#d97706' : '#dc2626'

  return (
    <div className="relative w-32 h-32 flex items-center justify-center">
      <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
        <circle
          cx="64"
          cy="64"
          r={radius}
          stroke="#e5e7eb"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          stroke={color}
          strokeWidth="8"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-3xl font-bold tabular-nums">{score}</p>
        <p className="text-xs text-gray-500 uppercase">{level}</p>
      </div>
    </div>
  )
}
