import { CheckCircle2, Download, PackagePlus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BuiltinAssetKind, BuiltinAssetSummary } from '../../types/tauri'

interface BuiltinLibraryPanelProps {
  assets: BuiltinAssetSummary[]
  onInstall: (ids: string[]) => Promise<void>
}

type FilterId = 'all' | BuiltinAssetKind

const filters: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'character', label: '角色' },
  { id: 'worldbook', label: '世界书' },
  { id: 'preset', label: '预设' },
]

const kindLabels: Record<BuiltinAssetKind, string> = {
  character: '角色',
  worldbook: '世界书',
  preset: '预设',
}

function countByKind(assets: BuiltinAssetSummary[], kind: BuiltinAssetKind) {
  return assets.filter((asset) => asset.kind === kind).length
}

export function BuiltinLibraryPanel({ assets, onInstall }: BuiltinLibraryPanelProps) {
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [installingId, setInstallingId] = useState('')
  const installedCount = assets.filter((asset) => asset.installed).length
  const pendingIds = assets.filter((asset) => !asset.installed).map((asset) => asset.id)
  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return assets.filter((asset) => {
      const matchesKind = filter === 'all' || asset.kind === filter
      const haystack = [asset.name, asset.description, asset.tags.join(' ')].join(' ').toLowerCase()
      return matchesKind && (!needle || haystack.includes(needle))
    })
  }, [assets, filter, query])

  async function install(ids: string[], marker: string) {
    setInstallingId(marker)
    try {
      await onInstall(ids)
    } finally {
      setInstallingId('')
    }
  }

  return (
    <div className="builtin-library">
      <section className="builtin-library-hero">
        <div>
          <h3>内置内容库</h3>
          <p>手动导入多风格角色、公用世界书和预设；不会自动写入，也不会覆盖你改过的内容。</p>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!pendingIds.length || installingId === 'all'}
          onClick={() => void install(assets.map((asset) => asset.id), 'all')}
        >
          <PackagePlus size={16} />
          {pendingIds.length ? '一键导入推荐包' : '已全部安装'}
        </button>
      </section>

      <section className="builtin-library-stats">
        <div>
          <strong>{countByKind(assets, 'character')}</strong>
          <span>角色</span>
        </div>
        <div>
          <strong>{countByKind(assets, 'worldbook')}</strong>
          <span>世界书</span>
        </div>
        <div>
          <strong>{countByKind(assets, 'preset')}</strong>
          <span>预设</span>
        </div>
        <div>
          <strong>{installedCount}</strong>
          <span>已安装</span>
        </div>
      </section>

      <div className="builtin-library-tools">
        <div className="segmented-control" role="tablist" aria-label="内容类型">
          {filters.map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
              type="button"
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="builtin-library-search">
          <Search size={15} />
          <input value={query} placeholder="搜索名称、标签或简介" onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      <div className="builtin-asset-list">
        {visibleAssets.length ? (
          visibleAssets.map((asset) => (
            <article key={asset.id} className={`builtin-asset-card builtin-asset-card--${asset.kind}`}>
              <div className="builtin-asset-card__main">
                <div className="builtin-asset-card__title">
                  <strong>{asset.name}</strong>
                  <span>{kindLabels[asset.kind]}</span>
                </div>
                <p>{asset.description}</p>
                <div className="builtin-asset-tags">
                  {asset.tags.map((tag) => (
                    <em key={tag}>{tag}</em>
                  ))}
                </div>
              </div>
              {asset.installed ? (
                <button className="secondary-button builtin-installed-button" type="button" disabled>
                  <CheckCircle2 size={15} />
                  已安装
                </button>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={installingId === asset.id}
                  onClick={() => void install([asset.id], asset.id)}
                >
                  <Download size={15} />
                  导入
                </button>
              )}
            </article>
          ))
        ) : (
          <div className="empty-panel">没有找到符合条件的内置内容</div>
        )}
      </div>
    </div>
  )
}
