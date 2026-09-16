/**
 * Six line icons — one per navigation group.
 *
 * Deliberately group-level rather than per-lab: two dozen tiny symbols next to
 * two dozen labels is noise, not navigation. The group icon gives the sidebar
 * shape when it is collapsed, and the labels do the actual work.
 */
export function GroupIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M2.5 6.8 8 2.5l5.5 4.3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V6.8Z" />
          <path d="M6.3 13.5V9h3.4v4.5" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.8" />
          <path d="M6.6 5.6 10.6 8l-4 2.4V5.6Z" />
        </svg>
      )
    case 'wave':
      return (
        <svg {...common}>
          <path d="M1.5 8h1.3M13.2 8h1.3" />
          <path d="M4.4 5.4v5.2M6.8 3.2v9.6M9.2 4.6v6.8M11.6 6.4v3.2" />
        </svg>
      )
    case 'chip':
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
          <path d="M6.5 1.8v2.7M9.5 1.8v2.7M6.5 11.5v2.7M9.5 11.5v2.7M1.8 6.5h2.7M1.8 9.5h2.7M11.5 6.5h2.7M11.5 9.5h2.7" />
        </svg>
      )
    case 'server':
      return (
        <svg {...common}>
          <rect x="2.2" y="2.5" width="11.6" height="4.2" rx="1" />
          <rect x="2.2" y="9.3" width="11.6" height="4.2" rx="1" />
          <path d="M4.6 4.6h.01M4.6 11.4h.01" />
        </svg>
      )
    case 'compass':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.8" />
          <path d="m10.3 5.7-1.2 3.4-3.4 1.2 1.2-3.4 3.4-1.2Z" />
        </svg>
      )
    case 'stack':
      return (
        <svg {...common}>
          <path d="M8 2 1.8 5 8 8l6.2-3L8 2Z" />
          <path d="m1.8 8.2 6.2 3 6.2-3M1.8 11.2l6.2 3 6.2-3" />
        </svg>
      )
    case 'bolt':
      return (
        <svg {...common}>
          <path d="M8.8 1.8 3.6 9h3.4l-.8 5.2L12.4 7H9l-.2-5.2Z" />
        </svg>
      )
    case 'scope':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.2" />
          <circle cx="8" cy="8" r="1.6" />
          <path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2" />
        </svg>
      )
    case 'flag':
      return (
        <svg {...common}>
          <path d="M3.8 14V2" />
          <path d="M3.8 2.8h7.4l-1.6 2.6 1.6 2.6H3.8" />
        </svg>
      )
    case 'book':
      return (
        <svg {...common}>
          <path d="M2.6 3.2c1.8-.7 3.6-.7 5.4 0v9.6c-1.8-.7-3.6-.7-5.4 0V3.2Z" />
          <path d="M13.4 3.2c-1.8-.7-3.6-.7-5.4 0v9.6c1.8-.7 3.6-.7 5.4 0V3.2Z" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.8" />
        </svg>
      )
  }
}
