import { convertFileSrc, isTauri } from '@tauri-apps/api/core'

const passthroughSrc = /^(https?:|data:|blob:|asset:|\/)/i

export function avatarImageSrc(avatar?: string | null) {
  const value = avatar?.trim()
  if (!value) return ''
  if (passthroughSrc.test(value)) return value
  return isTauri() ? convertFileSrc(value) : value
}

export function avatarFallbackText(name?: string | null) {
  const value = name?.trim()
  if (!value) return '?'
  return Array.from(value).slice(0, 2).join('')
}
