import { Bookmark, Download, FileUp, RefreshCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { TavernChatListItem, TavernChatSession } from '../../types/tauri'
import { normalizeChatList } from '../../lib/chatList'
import { bookmarkMessage, deleteChat, exportChat, importChat, loadChat, searchChats } from '../../lib/tauri'

interface ChatLibraryProps {
  chats: TavernChatListItem[]
  onRefresh: () => Promise<TavernChatListItem[]>
}

export function ChatLibrary({ chats, onRefresh }: ChatLibraryProps) {
  const [query, setQuery] = useState('')
  const [localChats, setLocalChats] = useState<TavernChatListItem[]>(chats)
  const [searchResults, setSearchResults] = useState<TavernChatListItem[] | null>(null)
  const [active, setActive] = useState<TavernChatSession | null>(null)
  const [deletingChatId, setDeletingChatId] = useState('')
  const [exportPath, setExportPath] = useState('')
  const [importPath, setImportPath] = useState('')
  const [status, setStatus] = useState('')
  const visibleChats = useMemo(() => searchResults ?? localChats, [localChats, searchResults])

  useEffect(() => {
    setLocalChats(normalizeChatList(chats))
  }, [chats])

  async function runSearch() {
    const result = await searchChats(query)
    setSearchResults(result)
    setStatus(result.length ? `找到 ${result.length} 个聊天` : '没有匹配的聊天')
  }

  async function openChat(chatId: string) {
    setActive(await loadChat(chatId))
  }

  async function refreshLocalChats() {
    const nextChats = normalizeChatList(await onRefresh())
    setLocalChats(nextChats)
    setSearchResults(query.trim() ? normalizeChatList(await searchChats(query)) : null)
    if (active && !nextChats.some((chat) => chat.id === active.id)) {
      setActive(null)
    }
  }

  async function removeChat(chatId: string) {
    const ok = window.confirm('确定删除这个聊天吗？删除后会移除本地 JSON 文件。')
    if (!ok) return

    try {
      setDeletingChatId(chatId)
      const deletedIndex = Math.max(0, visibleChats.findIndex((chat) => chat.id === chatId))
      const nextChats = normalizeChatList(await deleteChat(chatId))
      setLocalChats(nextChats)
      setSearchResults(query.trim() ? nextChats.filter((chat) => matchesListQuery(chat, query)) : null)
      const refreshedChats = normalizeChatList(await onRefresh())
      setLocalChats(refreshedChats)
      const nextVisibleChats = query.trim() ? normalizeChatList(await searchChats(query)) : refreshedChats
      setSearchResults(query.trim() ? nextVisibleChats : null)
      const fallbackChat =
        nextVisibleChats[deletedIndex] ?? nextVisibleChats[deletedIndex - 1] ?? nextVisibleChats[0]
      setActive(fallbackChat ? await loadChat(fallbackChat.id).catch(() => null) : null)
      setStatus('聊天已删除')
    } catch (error) {
      setStatus(String(error))
    } finally {
      setDeletingChatId('')
    }
  }

  async function toggleBookmark(messageId: string, bookmarked: boolean) {
    if (!active) return
    const next = await bookmarkMessage(active.id, messageId, bookmarked)
    setActive(next)
    await refreshLocalChats()
  }

  async function doImport() {
    try {
      const chat = await importChat(importPath)
      setActive(chat)
      await refreshLocalChats()
      setStatus('聊天已导入')
    } catch (error) {
      setStatus(String(error))
    }
  }

  return (
    <div className="tavern-grid tavern-grid--library">
      <aside className="tavern-list">
        <div className="search-row">
          <input value={query} placeholder="搜索聊天" onChange={(event) => setQuery(event.target.value)} />
          <button className="icon-button" title="搜索" type="button" onClick={() => void runSearch()}>
            <Search size={15} />
          </button>
          <button
            className="icon-button"
            title="刷新"
            type="button"
            onClick={() => {
              setQuery('')
              setSearchResults(null)
              setStatus('已刷新')
              void refreshLocalChats()
            }}
          >
            <RefreshCcw size={15} />
          </button>
        </div>
        {status && <div className="library-status">{status}</div>}
        {visibleChats.map((chat) => (
          <button
            key={chat.id}
            className={`tavern-list-item ${chat.id === active?.id ? 'tavern-list-item--active' : ''}`}
            type="button"
            onClick={() => void openChat(chat.id)}
          >
            <span>{chat.title}</span>
            <small>
              {chat.messageCount} 条 / {chat.lastMessage || '空聊天'}
            </small>
          </button>
        ))}
        {visibleChats.length === 0 && <div className="empty-panel empty-panel--compact">没有聊天记录</div>}
      </aside>

      <section className="tavern-editor">
        {active ? (
          <>
            <div className="chat-library-head">
              <div>
                <h2>{active.title}</h2>
                <p>{active.messages.length} 条消息</p>
              </div>
              <button
                className="icon-button danger-button"
                title="删除聊天"
                type="button"
                disabled={deletingChatId === active.id}
                onClick={() => void removeChat(active.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="chat-transcript">
              {active.messages.map((message) => (
                <div key={message.id} className={`transcript-message transcript-message--${message.role}`}>
                  <button
                    className={`bookmark-button ${message.bookmarked ? 'bookmark-button--on' : ''}`}
                    title="书签"
                    type="button"
                    onClick={() => void toggleBookmark(message.id, !message.bookmarked)}
                  >
                    <Bookmark size={14} />
                  </button>
                  <strong>{message.role}</strong>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-panel">选择一个聊天查看记录</div>
        )}

        <div className="tavern-actions">
          <input
            value={importPath}
            placeholder="C:\\导入\\chat.json"
            onChange={(event) => setImportPath(event.target.value)}
          />
          <button className="secondary-button" type="button" onClick={() => void doImport()}>
            <FileUp size={16} />
            导入聊天
          </button>
          <input
            value={exportPath}
            placeholder="C:\\导出\\chat.json"
            onChange={(event) => setExportPath(event.target.value)}
          />
          <button
            className="secondary-button"
            type="button"
            disabled={!active}
            onClick={() => active && void exportChat(active.id, exportPath)}
          >
            <Download size={16} />
            导出聊天
          </button>
        </div>
      </section>
    </div>
  )
}

function matchesListQuery(chat: TavernChatListItem, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [chat.title, chat.lastMessage, chat.tags.join(' ')].join(' ').toLowerCase().includes(needle)
}
