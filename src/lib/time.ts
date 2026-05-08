export function formatLocalDateTime(value: Date | number | string = new Date()) {
  if (value === '' || value === '0' || value === 0) return ''
  const input = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`
}

export function nowStamp() {
  return String(Date.now())
}
