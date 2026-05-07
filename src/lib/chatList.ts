import type { TavernChatListItem } from '../types/tauri'

export function normalizeChatList(chats: TavernChatListItem[]) {
  const seen = new Set<string>()
  return chats.filter((chat) => {
    if (seen.has(chat.id)) return false
    seen.add(chat.id)
    return true
  })
}

export function formatChatOption(chat: TavernChatListItem) {
  return `${chat.title} · ${chat.messageCount}条`
}
