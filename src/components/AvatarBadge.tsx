import { useState } from 'react'
import { avatarFallbackText, avatarImageSrc } from '../lib/avatar'

interface AvatarBadgeProps {
  name: string
  avatar?: string | null
  className?: string
}

export function AvatarBadge({ name, avatar, className = '' }: AvatarBadgeProps) {
  const [failedSrc, setFailedSrc] = useState('')
  const src = avatarImageSrc(avatar)
  const showImage = Boolean(src && src !== failedSrc)

  return (
    <span className={`avatar-badge ${className}`.trim()} aria-hidden="true">
      {showImage ? (
        <img src={src} alt="" onError={() => setFailedSrc(src)} />
      ) : (
        <span>{avatarFallbackText(name)}</span>
      )}
    </span>
  )
}
