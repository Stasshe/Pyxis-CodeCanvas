import * as React from 'react'
import type { SVGProps } from 'react'

// LucideのPanelRightアイコン（16x16）
function PanelRightIcon({
  color = 'currentColor',
  size = 16,
  ...props
}: SVGProps<SVGSVGElement> & { color?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="M15 3v18" />
    </svg>
  )
}

export default PanelRightIcon
