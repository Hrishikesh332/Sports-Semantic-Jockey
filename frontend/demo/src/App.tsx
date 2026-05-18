/// <reference types="vite/client" />

import Hls from 'hls.js'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import logoFull from '../../assets/logo-full.svg?raw'

const iconModules = import.meta.glob('../../icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const icons = Object.fromEntries(
  Object.entries(iconModules).map(([path, svg]) => [path.replace(/^.*\/icons\//, '').replace('.svg', ''), svg]),
)
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

type Game = {
  tag: string
  label: string
  sport: string
  knowledge_store_id: string
  source_videos?: string[]
  video_reference_map?: Record<string, string>
}

type Clip = {
  start_time: string
  end_time: string
  video_reference: string
  clip_type: string
  category: string
  source_type: 'stats' | 'semantic' | 'stats_semantic'
  description: string
  score_context: string
  selection_reason: string
  confidence: number
  explainability_label: string
}

type HighlightCategory = {
  title: string
  objective: string
  clips: Clip[]
  assembly_notes: string[]
}

type HighlightReels = {
  match_summary: string
  standard_stats: HighlightCategory
  best_plays: HighlightCategory
  emotional_moments: HighlightCategory
  fan_experience: HighlightCategory
  behind_the_scenes: HighlightCategory
}

type CategoryKey = 'best_plays' | 'emotional_moments' | 'fan_experience' | 'behind_the_scenes'
type MapCategoryKey = 'standard_stats' | CategoryKey
type LensKey = 'category' | 'confidence' | 'source_type' | 'video_reference'
type ViewKey = 'discover' | 'workspace' | 'overview'
type ReelFormatKey = '9x16' | '16x9' | '1x1' | '4x5'

type DiscoverItem = {
  id: string
  label: string
  title: string
  subtitle: string
  media: string
  poster: string
  videoName: string
  knowledgeStoreId: string
}

type TwelveLabsStreamInfo = {
  provider: 'twelvelabs'
  type: 'hls'
  asset_id: string
  asset_status: string
  hls_status: string
  manifest_url: string
}

const categories: Array<{ key: CategoryKey; label: string; icon: string }> = [
  { key: 'best_plays', label: 'Best Plays', icon: 'play-boxed' },
  { key: 'emotional_moments', label: 'Emotional Moments', icon: 'speech' },
  { key: 'fan_experience', label: 'Fan Experience', icon: 'members' },
  { key: 'behind_the_scenes', label: 'Behind the Scenes', icon: 'indexes' },
]

const reelFormats: Array<{ key: ReelFormatKey; label: string; detail: string; aspect: string }> = [
  { key: '9x16', label: '9:16 Reel', detail: 'Vertical', aspect: '9 / 16' },
  { key: '16x9', label: '16:9', detail: 'Landscape', aspect: '16 / 9' },
  { key: '1x1', label: '1:1', detail: 'Square', aspect: '1 / 1' },
  { key: '4x5', label: '4:5', detail: 'Feed', aspect: '4 / 5' },
]

const REEL_PADDING_SECONDS = 5
const mapLanes: Array<{ key: MapCategoryKey; label: string; icon: string }> = [
  { key: 'standard_stats', label: 'Event Feed', icon: 'usage' },
  { key: 'best_plays', label: 'Best Plays', icon: 'play-boxed' },
  { key: 'emotional_moments', label: 'Emotion', icon: 'speech' },
  { key: 'fan_experience', label: 'Fans', icon: 'members' },
  { key: 'behind_the_scenes', label: 'BTS', icon: 'indexes' },
]

const lensOptions: Array<{ key: LensKey; label: string; icon: string }> = [
  { key: 'category', label: 'Category', icon: 'grid' },
  { key: 'confidence', label: 'Confidence', icon: 'checkmark' },
]

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: 'discover', label: 'Discover' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'overview', label: 'Overview' },
]

const signalColors: Record<MapCategoryKey, { bg: string; border: string; text: string; track: string }> = {
  standard_stats: { bg: '#1D1C1B', border: '#1D1C1B', text: '#FFFFFF', track: '#D3D1CF' },
  best_plays: { bg: '#00DC82', border: '#00B86E', text: '#1D1C1B', track: '#E8F5E9' },
  emotional_moments: { bg: '#FABA17', border: '#7D5D0C', text: '#7D5D0C', track: '#FDE3A2' },
  fan_experience: { bg: '#6CD5FD', border: '#366B7F', text: '#366B7F', track: '#C4EEFE' },
  behind_the_scenes: { bg: '#FFB0CD', border: '#805867', text: '#805867', track: '#FFDFEB' },
}

const sourceColors: Record<Clip['source_type'], { bg: string; border: string; text: string; track: string }> = {
  stats: { bg: '#1D1C1B', border: '#1D1C1B', text: '#FFFFFF', track: '#D3D1CF' },
  semantic: { bg: '#6CD5FD', border: '#366B7F', text: '#366B7F', track: '#C4EEFE' },
  stats_semantic: { bg: '#00DC82', border: '#00B86E', text: '#1D1C1B', track: '#E8F5E9' },
}

const referencePalette = [
  { bg: '#00DC82', border: '#00B86E', text: '#1D1C1B', track: '#E8F5E9' },
  { bg: '#FABA17', border: '#7D5D0C', text: '#7D5D0C', track: '#FDE3A2' },
  { bg: '#6CD5FD', border: '#366B7F', text: '#366B7F', track: '#C4EEFE' },
  { bg: '#FFB0CD', border: '#805867', text: '#805867', track: '#FFDFEB' },
  { bg: '#FFB592', border: '#805B49', text: '#805B49', track: '#FFD3BE' },
]

function viewFromPath(pathname: string): ViewKey {
  if (pathname.includes('discover')) return 'discover'
  if (pathname.includes('overview')) return 'overview'
  return 'workspace'
}

function pathForView(view: ViewKey) {
  if (view === 'discover') return '/discover'
  if (view === 'overview') return '/overview'
  return '/'
}

function navButtonClass(currentView: ViewKey, itemView: ViewKey) {
  if (currentView === 'discover') {
    return currentView === itemView
      ? 'border-white bg-white text-brand-charcoal'
      : 'border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/10 hover:text-white'
  }
  return currentView === itemView
    ? 'border-accent bg-accent-light text-brand-charcoal'
    : 'border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal'
}

function App() {
  const [games, setGames] = useState<Game[]>([])
  const [selectedTag, setSelectedTag] = useState('')
  const [view, setView] = useState<ViewKey>(() => viewFromPath(window.location.pathname))
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('best_plays')
  const [selectedEnhancedClipIndex, setSelectedEnhancedClipIndex] = useState(0)
  const [selectedStandardClipIndex, setSelectedStandardClipIndex] = useState(0)
  const [featuredSignalCategory, setFeaturedSignalCategory] = useState<MapCategoryKey>('best_plays')
  const [metadataLens, setMetadataLens] = useState<LensKey>('category')
  const [reelsByTag, setReelsByTag] = useState<Record<string, HighlightReels>>({})
  const [gamesError, setGamesError] = useState('')
  const [reelsError, setReelsError] = useState('')
  const [loadingGames, setLoadingGames] = useState(true)
  const [loadingTag, setLoadingTag] = useState('')
  const [explainOpen, setExplainOpen] = useState(true)
  const [selectedSourceVideoName, setSelectedSourceVideoName] = useState<string | null>(null)
  const [pendingWorkspaceVideoName, setPendingWorkspaceVideoName] = useState<string | null>(null)
  const [reelFormat, setReelFormat] = useState<ReelFormatKey>('9x16')
  const requestedTags = useRef<Set<string>>(new Set())
  const selectedGame = useMemo(
    () => games.find((game) => game.tag === selectedTag) || null,
    [games, selectedTag],
  )
  const activeVideoName = selectedGame?.source_videos?.includes(selectedSourceVideoName || '')
    ? selectedSourceVideoName || undefined
    : selectedGame?.source_videos?.[0]
  const selectedReelsKey = selectedTag ? reelCacheKey(selectedTag, activeVideoName) : ''
  const reels = selectedReelsKey ? reelsByTag[selectedReelsKey] : undefined
  const scopedReels = useMemo(
    () => (selectedGame && reels && activeVideoName ? scopeReelsToVideo(selectedGame, reels, activeVideoName) : reels),
    [selectedGame, reels, activeVideoName],
  )
  const enhancedCategory = scopedReels?.[selectedCategory]
  const enhancedClip = enhancedCategory?.clips[selectedEnhancedClipIndex] || enhancedCategory?.clips[0]
  const standardClip = scopedReels?.standard_stats.clips[selectedStandardClipIndex] || scopedReels?.standard_stats.clips[0]
  const featuredClip = featuredSignalCategory === 'standard_stats' ? standardClip : enhancedClip
  const featuredEyebrow = featuredSignalCategory === 'standard_stats'
    ? 'Event Feed'
    : categories.find((category) => category.key === selectedCategory)?.label || 'Enhanced'
  const featuredTitle = featuredSignalCategory === 'standard_stats' ? 'Event Feed Baseline' : 'Jockey Discovery Cut'
  const hasJockeyAnalysis = scopedReels ? hasHighlightClips(scopedReels) : false
  const isLoadingReels = Boolean(selectedReelsKey && loadingTag === selectedReelsKey)

  useEffect(() => {
    let active = true
    fetchJson<{ games: Game[] }>('/games')
      .then((body) => {
        if (!active) return
        setGames(body.games)
        setSelectedTag((current) => current || body.games[0]?.tag || '')
      })
      .catch((error: Error) => {
        if (active) setGamesError(error.message)
      })
      .finally(() => {
        if (active) setLoadingGames(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedTag || !selectedReelsKey || reelsByTag[selectedReelsKey] || requestedTags.current.has(selectedReelsKey)) return
    requestedTags.current.add(selectedReelsKey)
    setLoadingTag(selectedReelsKey)
    setReelsError('')
    fetchJson<HighlightReels>(`/games/${encodeURIComponent(selectedTag)}/highlight-reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activeVideoName ? { video_name: activeVideoName } : {}),
    })
      .then((body) => setReelsByTag((current) => ({ ...current, [selectedReelsKey]: body })))
      .catch((error: Error) => {
        requestedTags.current.delete(selectedReelsKey)
        setReelsError(error.message)
      })
      .finally(() => setLoadingTag(''))
  }, [selectedTag, selectedReelsKey, activeVideoName, reelsByTag])

  useEffect(() => {
    setReelsError('')
  }, [selectedReelsKey])

  useEffect(() => {
    setSelectedEnhancedClipIndex(0)
    setSelectedStandardClipIndex(0)
    setFeaturedSignalCategory(selectedCategory)
  }, [selectedTag, activeVideoName])

  useEffect(() => {
    if (!selectedGame) {
      setSelectedSourceVideoName(null)
      return
    }
    const sourceVideos = selectedGame.source_videos || []
    setSelectedSourceVideoName((current) => (current && sourceVideos.includes(current) ? current : sourceVideos[0] || null))
  }, [selectedGame])

  const selectSignal = (categoryKey: MapCategoryKey, index: number) => {
    if (categoryKey === 'standard_stats') {
      setSelectedStandardClipIndex(index)
      setFeaturedSignalCategory('standard_stats')
      scrollWorkspaceDetailsIntoView()
      return
    }
    setSelectedCategory(categoryKey)
    setSelectedEnhancedClipIndex(index)
    setFeaturedSignalCategory(categoryKey)
    scrollWorkspaceDetailsIntoView()
  }
  const selectCategoryTab = (categoryKey: CategoryKey) => {
    setSelectedCategory(categoryKey)
    setSelectedEnhancedClipIndex(0)
    setFeaturedSignalCategory(categoryKey)
  }
  const navigate = (nextView: ViewKey) => {
    setView(nextView)
    window.history.pushState({}, '', pathForView(nextView))
  }
  const scrollWorkspaceDetailsIntoView = () => {
    window.requestAnimationFrame(() => {
      document.getElementById('workspace-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const selectWorkspaceClipForVideo = (videoName: string, currentGame: Game, currentReels: HighlightReels) => {
    const match = clipSelectionForVideo(currentGame, currentReels, videoName)
    if (!match) return false
    if (match.category === 'standard_stats') {
      setSelectedStandardClipIndex(match.index)
      setFeaturedSignalCategory('standard_stats')
    } else {
      setSelectedCategory(match.category)
      setSelectedEnhancedClipIndex(match.index)
      setFeaturedSignalCategory(match.category)
    }
    return true
  }
  const openSourceInWorkspace = (item: DiscoverItem) => {
    openVideoInWorkspace(item.videoName)
  }
  const openVideoInWorkspace = (videoName: string) => {
    setSelectedSourceVideoName(videoName)
    setSelectedEnhancedClipIndex(0)
    setSelectedStandardClipIndex(0)
    setFeaturedSignalCategory('best_plays')
    setPendingWorkspaceVideoName(videoName)
    navigate('workspace')
    scrollWorkspaceDetailsIntoView()
  }

  useEffect(() => {
    const handlePopState = () => {
      setView(viewFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!pendingWorkspaceVideoName || !selectedGame || !scopedReels || activeVideoName !== pendingWorkspaceVideoName) return
    selectWorkspaceClipForVideo(pendingWorkspaceVideoName, selectedGame, scopedReels)
    setPendingWorkspaceVideoName(null)
    scrollWorkspaceDetailsIntoView()
  }, [pendingWorkspaceVideoName, selectedGame, scopedReels, activeVideoName])

  return (
    <main className="min-h-screen bg-background text-text-primary">
      <div className="flex min-h-screen flex-col">
        <header
          className={[
            'sticky top-0 z-50 border-b shadow-[0_1px_0_rgba(29,28,27,0.04)]',
            view === 'discover' ? 'border-white/10 bg-black text-white' : 'border-border bg-surface',
          ].join(' ')}
        >
          <div
            className={[
              'mx-auto w-full max-w-[1440px] gap-4 px-6 py-6',
              view === 'overview'
                ? 'grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] lg:items-center'
                : 'flex flex-col lg:flex-row lg:items-center lg:justify-between',
            ].join(' ')}
          >
            <div className={['flex items-center gap-4', view === 'overview' ? 'lg:justify-self-start' : ''].join(' ')}>
              <span
                className={[
                  'inline-flex h-9 w-[180px] items-center',
                  view === 'discover' ? 'text-white' : 'text-brand-charcoal',
                ].join(' ')}
                dangerouslySetInnerHTML={{ __html: logoFull }}
              />
              <div className={['h-7 w-px', view === 'discover' ? 'bg-white/20' : 'bg-border'].join(' ')} />
              <div>
                <h1 className={['text-lg font-semibold', view === 'discover' ? 'text-white' : 'text-text-primary'].join(' ')}>Sports Jockey Intelligence</h1>
              </div>
            </div>
            <nav className={['flex items-center gap-2', view === 'overview' ? 'justify-center lg:justify-self-center' : ''].join(' ')}>
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.key)}
                  className={[
                    'h-9 rounded-md border px-4 text-sm font-semibold transition-colors',
                    navButtonClass(view, item.key),
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className={view === 'overview' ? 'lg:justify-self-end' : ''}>
              <LiveApiBadge loading={loadingGames} error={Boolean(gamesError)} />
            </div>
            {view !== 'overview' && <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className={['text-xs font-semibold uppercase tracking-[0.08em]', view === 'discover' ? 'text-white/45' : 'text-text-tertiary'].join(' ')} htmlFor="game-selector">
                Game
              </label>
              <select
                id="game-selector"
                value={selectedTag}
                onChange={(event) => setSelectedTag(event.target.value)}
                disabled={loadingGames || games.length === 0}
                className={[
                  'h-10 min-w-[260px] rounded-md border px-3 text-sm font-medium outline-none shadow-[0_1px_2px_rgba(29,28,27,0.04)] focus:border-accent disabled:cursor-not-allowed disabled:text-text-tertiary',
                  view === 'discover' ? 'border-white/15 bg-white/5 text-white' : 'border-border bg-surface text-text-primary',
                ].join(' ')}
              >
                {games.length === 0 ? (
                  <option value="">No analyzed games</option>
                ) : (
                  games.map((game) => (
                    <option key={game.tag} value={game.tag}>
                      {gameOptionLabel(game)}
                    </option>
                  ))
                )}
              </select>
            </div>}
          </div>
        </header>

        {view === 'discover' ? (
          <DiscoverPage
            game={selectedGame}
            loading={loadingGames}
            error={gamesError || reelsError}
            onOpenInWorkspace={openSourceInWorkspace}
          />
        ) : view === 'overview' ? (
          <OverviewPage onNavigate={navigate} />
        ) : (
        <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-6">
          <section className="flex min-w-0 flex-col gap-6">
            {selectedGame && (
              <WorkspaceVideoCarousel
                game={selectedGame}
                activeVideoName={activeVideoName}
                onSelect={openVideoInWorkspace}
              />
            )}

            <StatusStrip
              loadingGames={loadingGames}
              gamesError={gamesError}
              reelsError={reelsError}
              isLoadingReels={isLoadingReels}
              selectedGame={selectedGame}
              reels={scopedReels}
              activeVideoName={activeVideoName}
              onOpenDiscover={() => navigate('discover')}
            />

            {selectedGame && (
              <CategorySelectorPanel
                className="xl:hidden"
                reels={scopedReels}
                selectedCategory={selectedCategory}
                onSelect={selectCategoryTab}
              />
            )}

            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="flex min-w-0 flex-col gap-6">
                <div id="workspace-details" className="scroll-mt-40">
                  <FeaturedClipPanel
                    title={featuredTitle}
                    eyebrow={featuredEyebrow}
                    clip={featuredClip}
                    game={selectedGame}
                    sourceVideoName={activeVideoName}
                    timelineCategory={featuredSignalCategory === 'standard_stats' ? scopedReels?.standard_stats : enhancedCategory}
                    timelineLabel={featuredEyebrow}
                    selectedTimelineIndex={featuredSignalCategory === 'standard_stats' ? selectedStandardClipIndex : selectedEnhancedClipIndex}
                    onTimelineSelect={(index) => {
                      if (featuredSignalCategory === 'standard_stats') {
                        setSelectedStandardClipIndex(index)
                        setFeaturedSignalCategory('standard_stats')
                        return
                      }
                      setSelectedEnhancedClipIndex(index)
                      setFeaturedSignalCategory(selectedCategory)
                    }}
                    emptyText={isLoadingReels ? 'Generating reel' : featuredSignalCategory === 'standard_stats' ? 'No event feed clips returned' : 'No enhanced clips returned'}
                  />
                </div>

                {scopedReels && (hasJockeyAnalysis ? <SemanticLiftSummary reels={scopedReels} /> : <JockeyIndexNotice game={selectedGame} />)}

                {scopedReels && hasJockeyAnalysis && (
                  <SignalMap
                    reels={scopedReels}
                    lens={metadataLens}
                    onLensChange={setMetadataLens}
                    selectedCategory={selectedCategory}
                    selectedEnhancedIndex={selectedEnhancedClipIndex}
                    selectedStandardIndex={selectedStandardClipIndex}
                    onSelect={selectSignal}
                  />
                )}

                {enhancedCategory && hasJockeyAnalysis && (
                  <ClipRail
                    category={enhancedCategory}
                    selectedIndex={selectedEnhancedClipIndex}
                    onSelect={(index) => {
                      setSelectedEnhancedClipIndex(index)
                      setFeaturedSignalCategory(selectedCategory)
                      scrollWorkspaceDetailsIntoView()
                    }}
                  />
                )}

                {selectedGame && activeVideoName && enhancedCategory && hasJockeyAnalysis && (
                  <ReelBuilder
                    game={selectedGame}
                    videoName={activeVideoName}
                    categoryKey={selectedCategory}
                    category={enhancedCategory}
                    format={reelFormat}
                    onCategoryChange={selectCategoryTab}
                    onFormatChange={setReelFormat}
                  />
                )}
              </section>

              <aside className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-[128px] xl:self-start">
                {selectedGame && (
                  <CategorySelectorPanel
                    className="hidden xl:block"
                    reels={scopedReels}
                    selectedCategory={selectedCategory}
                    onSelect={selectCategoryTab}
                  />
                )}
                <ExplainabilityPanel
                  open={explainOpen}
                  onToggle={() => setExplainOpen((value) => !value)}
                  standardClip={standardClip}
                  enhancedClip={enhancedClip}
                  category={enhancedCategory}
                />
              </aside>
            </div>
          </section>
        </div>
        )}
      </div>
    </main>
  )
}

function WorkspaceVideoCarousel({
  game,
  activeVideoName,
  onSelect,
}: {
  game: Game
  activeVideoName?: string
  onSelect: (videoName: string) => void
}) {
  const uniqueVideos = useMemo(() => uniqueVideoNames(game.source_videos || []), [game.source_videos])
  const loopVideos = useMemo(() => {
    if (uniqueVideos.length === 0) return []
    const minimumItems = Math.max(8, uniqueVideos.length)
    return Array.from({ length: minimumItems }, (_, index) => uniqueVideos[index % uniqueVideos.length])
  }, [uniqueVideos])

  if (uniqueVideos.length === 0) return null

  const renderVideoButton = (videoName: string, index: number, group: string) => {
    const active = videoName === activeVideoName
    return (
      <button
        key={`${group}-${videoName}-${index}`}
        type="button"
        onClick={() => onSelect(videoName)}
        className={[
          'group relative h-[118px] w-[210px] shrink-0 overflow-hidden rounded-md border bg-brand-charcoal text-left shadow-[0_8px_24px_rgba(29,28,27,0.1)]',
          active ? 'border-accent ring-2 ring-accent/35' : 'border-white/10 hover:border-accent/80',
        ].join(' ')}
        aria-label={`Open ${videoName}`}
        aria-current={active ? 'true' : undefined}
      >
        <img
          src={thumbnailForVideoName(game, videoName)}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/18 to-transparent" />
        <span className="absolute bottom-0 left-0 right-0 p-3">
          <span className="line-clamp-2 text-xs font-semibold leading-4 text-white">{videoName}</span>
          {active && (
            <span className="mt-2 inline-flex h-6 items-center rounded-full bg-accent px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-charcoal">
              Active
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="flex items-center justify-between gap-4 border-b border-border-light px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">Video switcher</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-text-primary">{activeVideoName || game.label}</h2>
        </div>
        <div className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-secondary">
          <StrandIcon name="indexes" className="h-4 w-4 text-accent" />
          {uniqueVideos.length} videos
        </div>
      </div>
      <div className="workspace-video-carousel relative overflow-hidden py-4">
        <div className="workspace-video-carousel-track flex w-max gap-3 px-5">
          <div className="flex shrink-0 gap-3">
            {loopVideos.map((videoName, index) => renderVideoButton(videoName, index, 'a'))}
          </div>
          <div className="flex shrink-0 gap-3">
            {loopVideos.map((videoName, index) => renderVideoButton(videoName, index, 'b'))}
          </div>
        </div>
      </div>
    </section>
  )
}

function LiveApiBadge({ loading, error }: { loading: boolean; error: boolean }) {
  if (!loading && !error) return null
  const label = error ? 'API issue' : 'Connecting API'
  return (
    <div
      className={[
        'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold',
        error
          ? 'border-error bg-error-light text-error-dark'
          : loading
            ? 'border-border bg-card text-text-secondary'
            : 'border-accent bg-accent-light text-brand-charcoal',
      ].join(' ')}
    >
      <span className={['h-2 w-2 rounded-full', error ? 'bg-error' : loading ? 'bg-text-tertiary' : 'bg-accent'].join(' ')} />
      {label}
    </div>
  )
}

function OverviewPage({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const problems = [
    {
      icon: 'speech',
      title: 'Missed Emotion',
      body: 'Goals are easy to detect. Tears, pressure, and celebration intensity usually disappear.',
    },
    {
      icon: 'generate',
      title: 'Rigid Content',
      body: 'Storylines like The Comeback or Fan Atmosphere still need manual tags.',
    },
    {
      icon: 'members',
      title: 'Generic Personalization',
      body: 'Every fan gets the same recap instead of moments tuned to what they care about.',
    },
  ]
  const solutionSteps = [
    {
      icon: 'vision',
      label: 'Understand',
      body: 'Read plays, emotion, crowd energy, motion, and context.',
    },
    {
      icon: 'search',
      label: 'Find',
      body: 'Search by story intent instead of only timestamp or manual labels.',
    },
    {
      icon: 'play-boxed',
      label: 'Export',
      body: 'Turn selected moments into tag-wise reels and downloadable formats.',
    },
  ]

  return (
    <div className="flex flex-1 flex-col bg-background">
      <section className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-[1120px] gap-10 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Sports Intelligence</p>
            <h2 className="mt-5 text-4xl font-semibold leading-tight text-text-primary md:text-5xl">Story-aware sports reels</h2>
            <p className="mt-5 text-lg leading-8 text-text-secondary">
              Find the moments that matter in long-form sports footage, then turn them into focused reels with TwelveLabs video understanding.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('discover')}
                className="h-11 rounded-md border border-accent bg-accent px-5 text-sm font-semibold text-brand-charcoal hover:bg-accent-light"
              >
                Discover
              </button>
              <button
                type="button"
                onClick={() => onNavigate('workspace')}
                className="h-11 rounded-md border border-border bg-surface px-5 text-sm font-semibold text-text-primary hover:border-accent hover:bg-accent-light"
              >
                Workspace
              </button>
            </div>
          </div>
          <div className="grid gap-3 text-sm font-semibold text-text-secondary">
            {['Single-video grounded', 'Semantic clip lanes', 'Format-ready reels'].map((item) => (
              <div key={item} className="flex items-center gap-3 border-b border-border-light pb-3 last:border-b-0 last:pb-0">
                <StrandIcon name="checkmark" className="h-4 w-4 text-accent" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1120px] gap-10 px-6 py-14 lg:grid-cols-[330px_minmax(0,1fr)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">Problem</p>
          <h3 className="mt-3 text-2xl font-semibold leading-tight text-text-primary">The story gets lost between events</h3>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Broadcast highlights know what happened. They rarely understand why the moment matters.
          </p>
        </div>
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          {problems.map((problem) => (
            <OverviewRow key={problem.title} icon={problem.icon} title={problem.title} body={problem.body} />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1120px] px-6 pb-16">
        <div className="grid gap-8 rounded-md border border-brand-charcoal bg-brand-charcoal p-6 text-white shadow-[0_12px_32px_rgba(29,28,27,0.12)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Solution</p>
            <h3 className="mt-3 text-2xl font-semibold leading-tight">TwelveLabs adds the semantic layer</h3>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/68">
              The portal moves from raw playback to meaning: context, emotion, search, and export from the same selected video.
            </p>
          </div>
          <div className="grid gap-3">
            {solutionSteps.map((solution, index) => (
              <SolutionStep key={solution.label} icon={solution.icon} title={solution.label} body={solution.body} index={index + 1} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function OverviewRow({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <article className="grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-start">
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-accent bg-accent-light text-brand-charcoal">
        <StrandIcon name={icon} className="h-4 w-4" />
      </span>
      <div>
        <h4 className="text-base font-semibold text-text-primary">{title}</h4>
        <p className="mt-1 text-sm leading-6 text-text-secondary">{body}</p>
      </div>
    </article>
  )
}

function SolutionStep({ icon, title, body, index }: { icon: string; title: string; body: string; index: number }) {
  return (
    <article className="grid gap-4 rounded-md border border-white/12 bg-white/[0.055] p-4 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-semibold text-brand-charcoal">{index}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-white/12 text-accent">
          <StrandIcon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div>
        <h4 className="text-base font-semibold text-white">{title}</h4>
        <p className="mt-1 text-sm leading-6 text-white/[0.68]">{body}</p>
      </div>
    </article>
  )
}

function DiscoverPage({
  game,
  loading,
  error,
  onOpenInWorkspace,
}: {
  game: Game | null
  loading: boolean
  error: string
  onOpenInWorkspace: (item: DiscoverItem) => void
}) {
  const [selectedItem, setSelectedItem] = useState<DiscoverItem | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const sourceVideos = useMemo(() => game?.source_videos || [], [game])
  const items = useMemo(() => (game ? knowledgeBaseItems(game, sourceVideos, searchQuery) : []), [game, sourceVideos, searchQuery])
  const spiralNodes = useMemo(() => discoverySpiralNodes(items), [items])
  const displayItem = selectedItem && items.some((item) => item.id === selectedItem.id) ? selectedItem : items[0] || null

  useEffect(() => {
    setSelectedItem(null)
  }, [game?.tag, searchQuery])

  if (error) {
    return (
      <section className="flex flex-1 items-center justify-center px-6 py-10">
        <Notice tone="error" icon="warning" text={error} />
      </section>
    )
  }

  if (loading || !game) {
    return (
      <section className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm font-semibold text-text-secondary shadow-[0_1px_2px_rgba(29,28,27,0.035)]">
          <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
          Loading sports knowledge base videos
        </div>
      </section>
    )
  }

  return (
    <section className="discovery-page relative flex flex-1 overflow-hidden bg-black px-6 py-6 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_62%_48%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,#000_0%,#030303_58%,#000_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.22)_38%,rgba(0,0,0,0.08)_62%,rgba(0,0,0,0.86)_100%)]" />
      <div className="relative z-10 min-h-[calc(100vh-112px)] w-full overflow-hidden rounded-none">
        <div className="absolute left-0 top-0 z-30 w-[min(360px,calc(100vw-48px))]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-white/5 text-white">
              <StrandIcon name="search" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-lg font-semibold text-white">Sports Knowledge Base</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/45">{items.length}/{sourceVideos.length} videos in Discover</p>
            </div>
          </div>
        </div>

        <div className="discovery-stage absolute inset-0" data-selected={displayItem ? 'true' : 'false'}>
          <div className="discovery-spiral-field absolute left-1/2 top-1/2 h-[1px] w-[1px]">
            {spiralNodes.map((node) => {
              const active = displayItem?.id === node.item.id && node.primary
              return (
                <button
                  key={node.id}
                  type="button"
                  tabIndex={node.primary ? 0 : -1}
                  onClick={() => setSelectedItem(node.item)}
                  className="discovery-card group absolute overflow-hidden border border-white/10 bg-white/5 text-left shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
                  style={node.style}
                  data-active={active ? 'true' : 'false'}
                  data-primary={node.primary ? 'true' : 'false'}
                  aria-label={`Inspect ${node.item.videoName}`}
                >
                  <VideoThumb poster={node.item.poster} title={node.item.title} />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 to-transparent px-3 pb-2 pt-10 text-[11px] font-semibold text-white/88 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {node.item.videoName}
                  </span>
                </button>
              )
            })}
          </div>
          {items.length === 0 && (
            <div className="absolute left-1/2 top-1/2 w-[min(360px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/15 bg-white/10 p-5 text-center text-sm font-medium leading-6 text-white/70 shadow-[0_12px_32px_rgba(0,0,0,0.4)]">
              No registered game videos match this search.
            </div>
          )}
        </div>

        {displayItem && (
          <div className="absolute bottom-20 right-0 z-30 w-[390px] max-w-[calc(100vw-48px)]">
            <DiscoverPopover item={displayItem} onOpenInWorkspace={onOpenInWorkspace} />
          </div>
        )}
        <DiscoverSearchBar value={searchQuery} onChange={setSearchQuery} resultCount={items.length} />
      </div>
    </section>
  )
}

function DiscoverPopover({
  item,
  onOpenInWorkspace,
}: {
  item: DiscoverItem
  onOpenInWorkspace: (item: DiscoverItem) => void
}) {
  return (
    <article className="w-full overflow-hidden rounded-md border border-white/12 bg-[#1B1B1B]/95 text-white shadow-[0_28px_80px_rgba(0,0,0,0.58)] backdrop-blur-md">
      <div className="aspect-video bg-black">
        <VideoThumb poster={item.poster} title={item.title} />
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-white/42">{item.label}</p>
            <h3 className="mt-2 text-base font-semibold leading-5 text-white">{item.title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenInWorkspace(item)}
              className="rounded-md border border-white bg-white p-2 text-brand-charcoal hover:bg-white/85"
              aria-label="Open source video in workspace"
              title="Open in workspace"
            >
              <StrandIcon name="arrow-box-right" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-white/55">{item.subtitle}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <DarkPill>{item.videoName}</DarkPill>
          <DarkPill>Game video</DarkPill>
        </div>
        <div className="mt-5 space-y-4">
          <MetaBlock label="Sports Knowledge Base" value={item.knowledgeStoreId} />
          <MetaBlock label="TwelveLabs Stream Endpoint" value={item.media} />
        </div>
      </div>
    </article>
  )
}

function DiscoverSearchBar({
  value,
  onChange,
  resultCount,
}: {
  value: string
  onChange: (value: string) => void
  resultCount: number
}) {
  return (
    <div className="fixed bottom-6 left-6 z-40 w-[min(560px,calc(100vw-48px))]">
      <div className="flex items-center gap-3 rounded-full border border-white/12 bg-white/10 p-2 shadow-[0_18px_46px_rgba(0,0,0,0.38)] backdrop-blur-md">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-brand-charcoal">
          <StrandIcon name="search" className="h-4 w-4" />
        </div>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-white/35"
          placeholder="Search videos in this sports knowledge base"
        />
        <span className="hidden rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white/62 sm:inline-flex">
          {resultCount} videos
        </span>
      </div>
    </div>
  )
}

function DarkPill({ children }: { children: string }) {
  return <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/75">{children}</span>
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-white/38">{label}</p>
      <p className="mt-1 text-sm leading-5 text-white/62">{value}</p>
    </div>
  )
}

function VideoThumb({ poster, title }: { poster: string; title: string }) {
  return (
    <img
      alt=""
      className="h-full w-full object-cover"
      src={poster}
      title={title}
    />
  )
}

function TwelveLabsVideoPlayer({
  streamInfoUrl,
  startSeconds,
  onDuration,
}: {
  streamInfoUrl: string
  startSeconds: number
  onDuration: (duration: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('Resolving TwelveLabs stream...')

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let disposed = false
    let hls: Hls | null = null
    let handleMetadata: (() => void) | null = null
    const controller = new AbortController()

    setStatus('loading')
    setMessage('Resolving TwelveLabs stream...')
    onDuration(0)
    video.pause()
    video.removeAttribute('src')
    video.load()

    fetchJson<TwelveLabsStreamInfo>(streamInfoUrl, { signal: controller.signal })
      .then((stream) => {
        if (disposed) return
        if (stream.provider !== 'twelvelabs' || stream.type !== 'hls' || !stream.manifest_url) {
          throw new Error('TwelveLabs stream response did not include a playable HLS manifest')
        }
        const manifestUrl = secureHttpsUrl(stream.manifest_url)
        if (!manifestUrl) {
          throw new Error('TwelveLabs stream response did not include a secure HLS manifest')
        }

        handleMetadata = () => {
          if (disposed) return
          const duration = Number.isFinite(video.duration) ? video.duration : 0
          onDuration(duration)
          video.currentTime = clamp(startSeconds, 0, Math.max(duration, startSeconds))
          setStatus('ready')
          setMessage('')
        }
        video.addEventListener('loadedmetadata', handleMetadata)

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = manifestUrl
          return
        }

        if (Hls.isSupported()) {
          hls = new Hls()
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal && !disposed) {
              setStatus('error')
              setMessage('TwelveLabs HLS stream could not be played in this browser')
            }
          })
          hls.loadSource(manifestUrl)
          hls.attachMedia(video)
          return
        }

        throw new Error('This browser cannot play TwelveLabs HLS streams')
      })
      .catch((error: Error) => {
        if (disposed || controller.signal.aborted) return
        setStatus('error')
        setMessage(error.message || 'TwelveLabs stream could not be loaded')
      })

    return () => {
      disposed = true
      controller.abort()
      if (handleMetadata) video.removeEventListener('loadedmetadata', handleMetadata)
      if (hls) hls.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [streamInfoUrl, startSeconds, onDuration])

  return (
    <div className="relative h-full w-full">
      <video ref={videoRef} className="h-full w-full object-contain accent-accent" controls playsInline preload="metadata" />
      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand-charcoal/82 px-6 text-center">
          <p className="max-w-md text-sm font-semibold text-white/92">{message}</p>
        </div>
      )}
    </div>
  )
}

function StatusStrip({
  loadingGames,
  gamesError,
  reelsError,
  isLoadingReels,
  selectedGame,
  reels,
  activeVideoName,
  onOpenDiscover,
}: {
  loadingGames: boolean
  gamesError: string
  reelsError: string
  isLoadingReels: boolean
  selectedGame: Game | null
  reels?: HighlightReels
  activeVideoName?: string
  onOpenDiscover: () => void
}) {
  if (loadingGames) {
    return <Notice tone="neutral" icon="spinner" text="Loading analyzed games" />
  }
  if (gamesError) {
    return <Notice tone="error" icon="warning" text={gamesError} />
  }
  if (!selectedGame) {
    return <Notice tone="neutral" icon="info" text="No analyzed game registrations returned by backend" />
  }
  if (reelsError) {
    return <Notice tone="error" icon="warning" text={reelsError} />
  }
  if (isLoadingReels) {
    return <Notice tone="neutral" icon="spinner" text={`Generating reels for ${selectedGame.label}`} />
  }
  if (reels) {
    const enhancedCount =
      reels.best_plays.clips.length +
      reels.emotional_moments.clips.length +
      reels.fan_experience.clips.length +
      reels.behind_the_scenes.clips.length
    return (
      <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
        <div className="grid gap-4 bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Source video</p>
            <div className="mt-1 flex min-w-0 items-center gap-3">
              <StrandIcon name="play-boxed" className="h-5 w-5 shrink-0 text-accent" />
              <h2 className="truncate text-xl font-semibold text-text-primary">{activeVideoName || selectedGame.label}</h2>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
              <WorkspaceFact icon="usage" label="Sport" value={selectedGame.sport} />
              <WorkspaceFact icon="indexes" label="References" value={String(reels.standard_stats.clips.length)} />
              <WorkspaceFact icon="generate" label="Enhanced" value={String(enhancedCount)} />
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenDiscover}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
          >
            <StrandIcon name="search" className="h-4 w-4" />
            Discover Videos
          </button>
        </div>
      </section>
    )
  }
  return <Notice tone="neutral" icon="hourglass" text="Waiting for Jockey response" />
}

function WorkspaceFact({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="inline-grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
      <StrandIcon name={icon} className="row-span-2 h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0 truncate text-base font-semibold leading-5 text-text-primary">{value}</span>
      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.08em] leading-4 text-text-tertiary">
        {label}
      </span>
    </div>
  )
}

function CategorySelectorPanel({
  className = '',
  reels,
  selectedCategory,
  onSelect,
}: {
  className?: string
  reels?: HighlightReels
  selectedCategory: CategoryKey
  onSelect: (category: CategoryKey) => void
}) {
  return (
    <section className={['rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]', className].join(' ')}>
      <div className="border-b border-border-light bg-card px-4 py-3.5">
        <div className="flex items-center gap-2">
          <StrandIcon name="filter" className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-text-primary">Clip Lanes</h2>
        </div>
        <p className="mt-1 text-sm text-text-secondary">Jockey categories</p>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {categories.map((category) => {
          const count = reels?.[category.key].clips.length ?? 0
          const active = selectedCategory === category.key
          return (
            <button
              key={category.key}
              type="button"
              onClick={() => onSelect(category.key)}
              className={[
                'grid min-h-[48px] grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border px-3 text-left text-sm font-semibold transition-colors',
                active
                  ? 'border-accent bg-accent-light text-brand-charcoal'
                  : 'border-border-light bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal',
              ].join(' ')}
            >
              <StrandIcon name={category.icon} className="h-4 w-4" />
              <span className="truncate">{category.label}</span>
              <span className="rounded-sm bg-card px-2 py-1 text-xs font-semibold text-text-tertiary">{count}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function JockeyIndexNotice({ game }: { game: Game | null }) {
  return (
    <section className="rounded-md border border-warning bg-warning-light p-5 text-warning-dark shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="flex items-start gap-3">
        <StrandIcon name="hourglass" className="mt-0.5 h-5 w-5" />
        <div>
          <h2 className="text-base font-semibold">TwelveLabs semantic analysis is not indexed yet</h2>
          <p className="mt-2 text-sm leading-6">
            {game?.label || 'This sports knowledge base'} has source videos available for playback, but Jockey clips, semantic lift, meta discovery, and explainability require a real TwelveLabs knowledge store with indexed items.
          </p>
          <p className="mt-2 text-sm leading-6">
            Run the upload/index flow first: upload each video as an asset, create or select a TwelveLabs knowledge store, add the assets as items, wait until each item is ready, then generate the Jockey highlight response.
          </p>
        </div>
      </div>
    </section>
  )
}

function SemanticLiftSummary({ reels }: { reels: HighlightReels }) {
  const lift = semanticLift(reels)
  const maxCategoryCount = Math.max(1, ...lift.categoryCounts.map((item) => item.count))
  return (
    <section className="rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[320px_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <StrandIcon name="generate" className="h-4 w-4 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">Semantic Lift Summary</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            +{lift.enhancedCount} Jockey-selected clips layered over {lift.standardCount} verified event-reference clips.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
          <div className="grid grid-cols-3 gap-4">
            <CompactMetric label="Semantic-only" value={String(lift.semanticOnly)} />
            <CompactMetric label="Hybrid" value={String(lift.hybrid)} />
            <CompactMetric label="90+ conf." value={String(lift.highConfidence)} />
          </div>

          <div className="flex flex-col gap-2">
            {lift.categoryCounts.map((item) => {
              const color = signalColors[item.key]
              return (
                <div key={item.key} className="grid grid-cols-[128px_1fr_28px] items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{item.label}</span>
                  <span className="h-2 overflow-hidden rounded-sm bg-border-light">
                    <span
                      className="block h-full rounded-sm"
                      style={{ width: `${(item.count / maxCategoryCount) * 100}%`, backgroundColor: color.bg }}
                    />
                  </span>
                  <span className="text-right text-sm font-semibold text-text-primary">{item.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function SignalMap({
  reels,
  lens,
  onLensChange,
  selectedCategory,
  selectedEnhancedIndex,
  selectedStandardIndex,
  onSelect,
}: {
  reels: HighlightReels
  lens: LensKey
  onLensChange: (lens: LensKey) => void
  selectedCategory: CategoryKey
  selectedEnhancedIndex: number
  selectedStandardIndex: number
  onSelect: (categoryKey: MapCategoryKey, index: number) => void
}) {
  const nodes = mapLanes.flatMap((lane) =>
    reels[lane.key].clips.map((clip, index) => ({
      lane,
      clip,
      index,
      start: secondsFromTime(clip.start_time),
      end: Math.max(secondsFromTime(clip.end_time), secondsFromTime(clip.start_time) + 1),
    })),
  )
  const maxTime = Math.max(1, ...nodes.map((node) => node.end))
  const semanticCount = nodes.filter((node) => node.clip.source_type !== 'stats').length
  const referenceCount = new Set(nodes.map((node) => node.clip.video_reference)).size
  const confidenceValues = nodes.map((node) => node.clip.confidence).filter(hasUsableConfidence)
  const avgConfidence = confidenceValues.length
    ? String(Math.round((confidenceValues.reduce((total, confidence) => total + confidence, 0) / confidenceValues.length) * 100))
    : 'N/A'
  const references = Array.from(new Set(nodes.map((node) => node.clip.video_reference)))
  const referenceColorMap = Object.fromEntries(
    references.map((reference, index) => [reference, referencePalette[index % referencePalette.length]]),
  )
  const referenceLabelMap = Object.fromEntries(
    references.map((reference, index) => [reference, `V${index + 1}`]),
  )

  return (
    <section className="rounded-md border border-border bg-surface shadow-[0_10px_30px_rgba(29,28,27,0.05)]">
      <div className="grid gap-5 border-b border-border-light px-5 py-5 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="flex items-center gap-2">
            <StrandIcon name="neural-network" className="h-4 w-4 text-brand-charcoal" />
            <h2 className="text-base font-semibold text-text-primary">Meta Discovery Map</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
            {semanticCount} semantic or hybrid clips mapped against {referenceCount} indexed video references.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {lensOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onLensChange(option.key)}
                className={[
                  'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors',
                  lens === option.key
                    ? 'border-accent bg-accent-light text-brand-charcoal'
                    : 'border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light',
                ].join(' ')}
              >
                <StrandIcon name={option.icon} className="h-4 w-4" />
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <CompactMetric label="Semantic lift" value={String(semanticCount)} />
          <CompactMetric label="Confidence" value={avgConfidence} />
          <CompactMetric label="References" value={String(referenceCount)} />
        </div>
      </div>

      <div className="overflow-x-auto p-5">
        <div className="min-w-[860px]">
          <div className="mb-5 flex h-9 items-end gap-1 rounded-md border border-border bg-card px-2 py-1.5">
            {nodes.map((node) => {
              const selected = isSelectedSignal(node.lane.key, node.index, selectedCategory, selectedEnhancedIndex, selectedStandardIndex)
              const color = signalColor(node.lane.key, node.clip, lens, referenceColorMap)
              return (
                <button
                  key={`${node.lane.key}-${node.index}-${node.clip.start_time}-dna`}
                  type="button"
                  aria-label={`${node.lane.label} ${node.clip.start_time}`}
                  onClick={() => onSelect(node.lane.key, node.index)}
                  className={[
                    'h-full min-w-[10px] flex-1 rounded-sm border transition-transform hover:-translate-y-0.5',
                    selected ? 'ring-2 ring-brand-charcoal ring-offset-2 ring-offset-card' : '',
                  ].join(' ')}
                  style={{
                    backgroundColor: color.bg,
                    borderColor: color.border,
                            opacity: signalOpacity(node.clip.confidence, 0.42),
                  }}
                />
              )
            })}
          </div>

          <div className="flex flex-col gap-3.5">
            {mapLanes.map((lane) => {
              const laneNodes = nodes.filter((node) => node.lane.key === lane.key)
              const laneTrackColor = lens === 'category' ? signalColors[lane.key].track : '#E8E7E5'
              return (
                <div key={lane.key} className="grid grid-cols-[132px_1fr] items-center gap-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                    <StrandIcon name={lane.icon} className="h-4 w-4" />
                    <span>{lane.label}</span>
                    <span className="ml-auto text-xs font-semibold text-text-tertiary">{laneNodes.length}</span>
                  </div>
                  <div className="relative h-12 rounded-md border border-border-light bg-surface">
                    <div className="absolute left-3 right-3 top-1/2 h-1 -translate-y-1/2 rounded-sm" style={{ backgroundColor: laneTrackColor }} />
                    {laneNodes.map((node) => {
                      const left = clamp((node.start / maxTime) * 100, 0, 97)
                      const width = clamp(((node.end - node.start) / maxTime) * 100, 2.2, 18)
                      const selected = isSelectedSignal(node.lane.key, node.index, selectedCategory, selectedEnhancedIndex, selectedStandardIndex)
                      const color = signalColor(node.lane.key, node.clip, lens, referenceColorMap)
                      return (
                        <button
                          key={`${lane.key}-${node.index}-${node.clip.start_time}`}
                          type="button"
                          onClick={() => onSelect(lane.key, node.index)}
                          aria-label={`${lane.label} ${node.clip.start_time} ${node.clip.description}`}
                          className={[
                            'absolute top-1/2 inline-flex h-5 -translate-y-1/2 items-center justify-center rounded-sm border px-1 text-[10px] font-semibold leading-none shadow-[0_2px_6px_rgba(31,41,33,0.12)] transition-transform hover:scale-110',
                            selected ? 'z-10 ring-2 ring-brand-charcoal ring-offset-2 ring-offset-surface' : '',
                          ].join(' ')}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            minWidth: 24,
                            backgroundColor: color.bg,
                            borderColor: color.border,
                            color: color.text,
                            opacity: signalOpacity(node.clip.confidence, 0.55),
                          }}
                        >
                          {signalLabel(node.clip, lens, referenceLabelMap)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-semibold text-text-tertiary">
            <span>0:00</span>
            <span className="text-center">{formatSeconds(Math.round(maxTime / 2))}</span>
            <span className="text-right">{formatSeconds(maxTime)}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function FeaturedClipPanel({
  title,
  eyebrow,
  clip,
  game,
  sourceVideoName,
  timelineCategory,
  timelineLabel,
  selectedTimelineIndex,
  onTimelineSelect,
  emptyText,
}: {
  title: string
  eyebrow: string
  clip?: Clip
  game: Game | null
  sourceVideoName?: string
  timelineCategory?: HighlightCategory
  timelineLabel: string
  selectedTimelineIndex: number
  onTimelineSelect: (index: number) => void
  emptyText: string
}) {
  const clipVideoName = game && clip ? videoNameForClip(game, clip) : undefined
  const effectiveClip = sourceVideoName && sourceVideoName !== clipVideoName ? undefined : clip
  const streamInfoUrl = game && sourceVideoName ? streamInfoForVideoName(game, sourceVideoName) : game && effectiveClip ? streamInfoForClip(game, effectiveClip) : null
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0)
  const clipStartSeconds = effectiveClip ? secondsFromTime(effectiveClip.start_time) : 0

  useEffect(() => {
    setVideoDurationSeconds(0)
  }, [streamInfoUrl, effectiveClip?.start_time, effectiveClip?.end_time])

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_10px_30px_rgba(29,28,27,0.06)]">
      <div className="flex items-start justify-between gap-4 border-b border-border-light bg-card px-4 py-3.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{eyebrow}</p>
          <h2 className="mt-1 text-base font-semibold text-text-primary">{title}</h2>
        </div>
        {effectiveClip && <Confidence value={effectiveClip.confidence} />}
      </div>
      {streamInfoUrl || effectiveClip ? (
        <div className="grid lg:grid-cols-[minmax(0,1.45fr)_360px]">
          <div className="min-w-0 border-b border-border-light lg:border-b-0 lg:border-r">
            <div className="flex aspect-video items-center justify-center bg-brand-charcoal text-white">
              {streamInfoUrl ? (
                <TwelveLabsVideoPlayer
                  key={`${streamInfoUrl}-${effectiveClip?.start_time || 'source'}-${effectiveClip?.end_time || 'full'}`}
                  streamInfoUrl={streamInfoUrl}
                  startSeconds={clipStartSeconds}
                  onDuration={setVideoDurationSeconds}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <StrandIcon name="info" className="h-8 w-8 text-white/90" />
                  <p className="max-w-sm text-sm font-medium text-white/95">No TwelveLabs stream mapping for this video</p>
                  {effectiveClip && <p className="max-w-md break-all text-xs text-white/70">{effectiveClip.video_reference}</p>}
                </div>
              )}
            </div>
            {timelineCategory && (
              <ClipMarkerLane
                clips={timelineCategory.clips}
                label={timelineLabel}
                selectedIndex={selectedTimelineIndex}
                durationSeconds={videoDurationSeconds}
                onSelect={onTimelineSelect}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4 p-4">
            {effectiveClip ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Start" value={effectiveClip.start_time} />
                  <Detail label="End" value={effectiveClip.end_time} />
                  <Detail label="Type" value={effectiveClip.clip_type} />
                  <Detail label="Source" value={sourceLabel(effectiveClip.source_type)} />
                </div>
                <div className="rounded-md border border-border-light bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selected Moment</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{effectiveClip.description}</p>
                  {effectiveClip.score_context && <p className="mt-2 text-sm leading-5 text-text-secondary">{effectiveClip.score_context}</p>}
                </div>
                <div className="rounded-md border border-border-light bg-surface p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Why Jockey Picked It</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{effectiveClip.explainability_label}</p>
                  <p className="mt-2 text-sm leading-5 text-text-secondary">{effectiveClip.selection_reason}</p>
                  {!hasUsableConfidence(effectiveClip.confidence) && (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Confidence not returned for this clip</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Video" value={sourceVideoName || 'Source video'} />
                  <Detail label="Sport" value={game?.sport || 'Sports'} />
                </div>
                <div className="rounded-md border border-border-light bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Source Video</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{sourceVideoName}</p>
                  <p className="mt-2 text-sm leading-5 text-text-secondary">Full registered game footage loaded directly from the live sports API.</p>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[520px] items-center justify-center p-6 text-sm text-text-tertiary">{emptyText}</div>
      )}
    </section>
  )
}

function ClipMarkerLane({
  clips,
  label,
  selectedIndex,
  durationSeconds,
  onSelect,
}: {
  clips: Clip[]
  label: string
  selectedIndex: number
  durationSeconds: number
  onSelect: (index: number) => void
}) {
  if (clips.length === 0) return null
  const selectedClip = clips[selectedIndex] || clips[0]
  const maxClipEnd = Math.max(
    ...clips.map((clip) => Math.max(secondsFromTime(clip.end_time), secondsFromTime(clip.start_time) + 1)),
  )
  const safeDuration = Math.max(durationSeconds, maxClipEnd, 1)
  return (
    <div className="border-b border-border bg-brand-charcoal px-4 py-3 text-white lg:border-b-0">
      <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
        <span>{clips.length} {label} points</span>
        <span>
          {selectedClip.start_time} - {selectedClip.end_time}
        </span>
      </div>
      <div className="relative mt-3 h-7" aria-label={`${label} clip points on player timeline`}>
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/14" />
        {clips.map((clip, index) => {
          const start = secondsFromTime(clip.start_time)
          const end = Math.max(secondsFromTime(clip.end_time), start + 1)
          const left = clamp((start / safeDuration) * 100, 0, 98)
          const width = clamp(((end - start) / safeDuration) * 100, 1.4, 100 - left)
          const selected = index === selectedIndex
          return (
            <button
              key={`${clip.video_reference}-${clip.start_time}-${index}-player-marker`}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`${label} point ${index + 1}: ${clip.start_time} to ${clip.end_time}`}
              className={[
                'absolute top-1/2 h-3 -translate-y-1/2 rounded-full border transition-transform hover:scale-y-150',
                selected
                  ? 'border-accent bg-accent shadow-[0_0_14px_rgba(0,220,130,0.5)] ring-2 ring-white/80'
                  : 'border-white/38 bg-white/62 hover:border-accent hover:bg-accent',
              ].join(' ')}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                minWidth: selected ? 18 : 12,
                zIndex: index + 1,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function ClipRail({
  category,
  selectedIndex,
  onSelect,
}: {
  category: HighlightCategory
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <section className="rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="flex items-center justify-between gap-4 border-b border-border-light bg-card px-4 py-3.5">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{category.title}</h2>
          <p className="mt-1 text-sm text-text-secondary">{category.objective}</p>
        </div>
        <span className="text-sm font-semibold text-text-tertiary">{category.clips.length} clips</span>
      </div>
      {category.clips.length > 0 ? (
        <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {category.clips.map((clip, index) => (
            <button
              key={`${clip.video_reference}-${clip.start_time}-${index}`}
              type="button"
              onClick={() => onSelect(index)}
              className={[
                'min-h-[120px] rounded-md border p-3 text-left shadow-[0_1px_2px_rgba(31,41,33,0.025)] transition-colors',
                selectedIndex === index
                  ? 'border-accent bg-accent-light text-text-primary'
                  : 'border-border-light bg-surface text-text-secondary hover:border-accent hover:bg-accent-light',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  {clip.start_time} - {clip.end_time}
                </span>
                <Confidence value={clip.confidence} />
              </div>
              <p className="mt-3 line-clamp-3 text-sm font-medium leading-5">{clip.description}</p>
              <p className="mt-3 text-xs font-semibold text-text-tertiary">{clip.explainability_label}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-10 text-sm text-text-tertiary">No clips returned for this category</div>
      )}
    </section>
  )
}

function ReelBuilder({
  game,
  videoName,
  categoryKey,
  category,
  format,
  onCategoryChange,
  onFormatChange,
}: {
  game: Game
  videoName: string
  categoryKey: CategoryKey
  category: HighlightCategory
  format: ReelFormatKey
  onCategoryChange: (category: CategoryKey) => void
  onFormatChange: (format: ReelFormatKey) => void
}) {
  const formatSpec = reelFormats.find((item) => item.key === format) || reelFormats[0]
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="grid gap-4 border-b border-border-light bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_220px_220px] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StrandIcon name="play-boxed" className="h-4 w-4 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">Tag Reels</h2>
          </div>
        </div>
        <label className="min-w-0">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Category</span>
          <select
            value={categoryKey}
            onChange={(event) => onCategoryChange(event.target.value as CategoryKey)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary outline-none focus:border-accent"
          >
            {categories.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Format</span>
          <select
            value={format}
            onChange={(event) => onFormatChange(event.target.value as ReelFormatKey)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-primary outline-none focus:border-accent"
          >
            {reelFormats.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} · {option.detail}
              </option>
            ))}
          </select>
        </label>
      </div>

      {category.clips.length > 0 ? (
        <div className="overflow-x-auto p-4">
          <div className="flex min-w-max snap-x gap-3">
            {category.clips.map((clip, index) => (
              <ReelCard
                key={`${categoryKey}-${clip.start_time}-${index}-reel`}
                game={game}
                videoName={videoName}
                categoryKey={categoryKey}
                clip={clip}
                index={index}
                format={format}
                formatSpec={formatSpec}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 py-10 text-sm text-text-tertiary">No clips available for this reel category.</div>
      )}
    </section>
  )
}

function ReelCard({
  game,
  videoName,
  categoryKey,
  clip,
  index,
  format,
  formatSpec,
}: {
  game: Game
  videoName: string
  categoryKey: CategoryKey
  clip: Clip
  index: number
  format: ReelFormatKey
  formatSpec: { key: ReelFormatKey; label: string; detail: string; aspect: string }
}) {
  const [previewing, setPreviewing] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const paddedRange = paddedRangeForClip(clip)
  const posterUrl = reelThumbnailUrl(game, videoName, clip, format)
  const previewUrl = reelPreviewUrl(game, videoName, clip, categoryKey, index, format)
  const downloadUrl = reelDownloadUrl(game, videoName, clip, categoryKey, index, format)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (previewing) {
      video.currentTime = 0
      video.play().catch(() => undefined)
      return
    }
    video.pause()
    video.currentTime = 0
  }, [previewing, previewUrl])

  return (
    <article
      tabIndex={0}
      aria-label={`Preview reel clip ${index + 1}`}
      className="group w-[224px] shrink-0 snap-start overflow-hidden rounded-md border border-border-light bg-surface shadow-[0_1px_2px_rgba(31,41,33,0.035)] outline-none transition duration-200 hover:-translate-y-1 hover:border-accent hover:bg-accent-light focus:border-accent focus:bg-accent-light focus:ring-2 focus:ring-accent/25 focus-within:border-accent"
      onClick={() => setPreviewing(true)}
      onFocus={() => setPreviewing(true)}
      onPointerEnter={() => setPreviewing(true)}
      onPointerLeave={() => setPreviewing(false)}
      onMouseEnter={() => setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
      onFocusCapture={() => setPreviewing(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) setPreviewing(false)
      }}
    >
      <div className="relative overflow-hidden bg-black" style={{ aspectRatio: formatSpec.aspect }}>
        <img alt="" src={posterUrl} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        {previewing && (
          <video
            key={previewUrl}
            ref={videoRef}
            src={previewUrl}
            poster={posterUrl}
            className="absolute inset-0 h-full w-full object-cover"
            muted
            loop
            playsInline
            preload="metadata"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/18 to-black/16" />
        <div className="absolute left-3 right-3 top-3 flex items-center justify-between gap-2">
          <span className="rounded-full border border-white/18 bg-black/50 px-2 py-1 text-[10px] font-semibold tracking-[0.02em] text-white backdrop-blur-sm">{game.tag}</span>
          <span className="rounded-full border border-white/18 bg-black/34 px-2 py-1 text-[10px] font-semibold tracking-[0.02em] text-white backdrop-blur-sm">{formatSpec.label}</span>
        </div>
        {!previewing && (
          <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/88 opacity-90 backdrop-blur-sm transition group-hover:scale-105 group-hover:bg-accent group-hover:text-brand-charcoal">
            <StrandIcon name="play" className="h-4 w-4" />
          </div>
        )}
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/50">Range</p>
          <p className="mt-1 text-sm font-semibold text-white">{formatSeconds(paddedRange.start)} - {formatSeconds(paddedRange.end)}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Clip {index + 1}</p>
            <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-xs font-semibold text-text-secondary">{Math.round(paddedRange.duration)}s</span>
          </div>
          <p className="mt-2 line-clamp-2 min-h-[40px] text-sm font-semibold leading-5 text-text-primary">{clip.description}</p>
        </div>
        <a
          href={downloadUrl}
          download
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-semibold text-text-primary hover:border-accent hover:bg-accent hover:text-brand-charcoal"
        >
          <StrandIcon name="download" className="h-4 w-4" />
          Download
        </a>
      </div>
    </article>
  )
}

function ExplainabilityPanel({
  open,
  onToggle,
  standardClip,
  enhancedClip,
  category,
}: {
  open: boolean
  onToggle: () => void
  standardClip?: Clip
  enhancedClip?: Clip
  category?: HighlightCategory
}) {
  return (
    <section className="rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 border-b border-border-light bg-card px-4 py-3.5 text-left"
      >
        <span>
          <span className="block text-base font-semibold text-text-primary">Explainability</span>
          {category && <span className="mt-1 block text-sm text-text-secondary">{category.title}</span>}
        </span>
        <StrandIcon name={open ? 'collapse' : 'expand'} className="h-4 w-4 text-text-secondary" />
      </button>
      {open && (
        <div className="flex flex-col gap-4 p-4">
          <ReasonBlock title="Stats-driven" clip={standardClip} expectedSource="stats" />
          <ReasonBlock title="Semantic-driven" clip={enhancedClip} expectedSource="semantic" />
          {category?.assembly_notes.length ? (
            <div className="border-t border-border-light pt-4">
              <h3 className="text-sm font-semibold text-text-primary">Assembly Notes</h3>
              <div className="mt-3 flex flex-col gap-2">
                {category.assembly_notes.map((note, index) => (
                  <p key={`${note}-${index}`} className="rounded-md bg-card px-3 py-2 text-sm leading-5 text-text-secondary">
                    {note}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function ReasonBlock({
  title,
  clip,
  expectedSource,
}: {
  title: string
  clip?: Clip
  expectedSource: 'stats' | 'semantic'
}) {
  const aligned = clip?.source_type === expectedSource || clip?.source_type === 'stats_semantic'
  return (
    <div className="rounded-md border border-border-light bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {clip && (
          <span className={['rounded-sm px-2 py-1 text-xs font-semibold', aligned ? 'bg-accent-light text-brand-charcoal' : 'bg-card text-text-tertiary'].join(' ')}>
            {sourceLabel(clip.source_type)}
          </span>
        )}
      </div>
      {clip ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm font-semibold text-text-primary">{clip.explainability_label}</p>
          <p className="text-sm leading-5 text-text-secondary">{clip.selection_reason}</p>
          <Detail label="Confidence" value={confidenceLabel(clip.confidence)} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-tertiary">No clip selected</p>
      )}
    </div>
  )
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-border pl-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      <p className="mt-1 text-lg font-semibold text-text-primary">{value}</p>
    </div>
  )
}

function Notice({ tone, icon, text }: { tone: 'neutral' | 'error'; icon: string; text: string }) {
  const classes =
    tone === 'error'
      ? 'border-error bg-error-light text-error-dark'
      : 'border-border bg-surface text-text-secondary shadow-[0_1px_2px_rgba(29,28,27,0.035)]'
  return (
    <div className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm font-medium ${classes}`}>
      <StrandIcon name={icon} className={icon === 'spinner' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      <span>{text}</span>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-card px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-text-primary">{value}</p>
    </div>
  )
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="shrink-0 rounded-sm bg-accent-light px-2 py-1 text-xs font-semibold text-brand-charcoal">
      {confidenceLabel(value)}
    </span>
  )
}

function StrandIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const svg = icons[name] || icons.info
  return <span className={`strand-icon inline-flex shrink-0 ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />
}

function sourceLabel(sourceType: Clip['source_type']) {
  if (sourceType === 'stats_semantic') return 'Stats + semantic'
  if (sourceType === 'semantic') return 'Semantic'
  return 'Stats'
}

function semanticLift(reels: HighlightReels) {
  const enhancedClips = categories.flatMap((category) => reels[category.key].clips)
  return {
    standardCount: reels.standard_stats.clips.length,
    enhancedCount: enhancedClips.length,
    semanticOnly: enhancedClips.filter((clip) => clip.source_type === 'semantic').length,
    hybrid: enhancedClips.filter((clip) => clip.source_type === 'stats_semantic').length,
    highConfidence: enhancedClips.filter((clip) => clip.confidence >= 0.9).length,
    categoryCounts: categories.map((category) => ({
      key: category.key,
      label: category.label.replace(' Moments', '').replace(' Experience', '').replace('Behind the Scenes', 'BTS'),
      count: reels[category.key].clips.length,
    })),
  }
}

function hasHighlightClips(reels: HighlightReels) {
  return reels.standard_stats.clips.length > 0 || categories.some((category) => reels[category.key].clips.length > 0)
}

function reelCacheKey(tag: string, videoName?: string) {
  return videoName ? `${tag}::${videoName}` : tag
}

function scopeReelsToVideo(game: Game, reels: HighlightReels, videoName: string): HighlightReels {
  return {
    ...reels,
    match_summary: `${videoName} source-only highlight analysis.`,
    standard_stats: scopeCategoryToVideo(game, reels.standard_stats, videoName),
    best_plays: scopeCategoryToVideo(game, reels.best_plays, videoName),
    emotional_moments: scopeCategoryToVideo(game, reels.emotional_moments, videoName),
    fan_experience: scopeCategoryToVideo(game, reels.fan_experience, videoName),
    behind_the_scenes: scopeCategoryToVideo(game, reels.behind_the_scenes, videoName),
  }
}

function scopeCategoryToVideo(game: Game, category: HighlightCategory, videoName: string): HighlightCategory {
  const normalizedVideoName = videoName.toLowerCase()
  return {
    ...category,
    clips: category.clips.filter((clip) => videoNameForClip(game, clip) === videoName),
    assembly_notes: category.assembly_notes.filter((note) => note.toLowerCase().includes(normalizedVideoName)),
  }
}

function signalColor(
  laneKey: MapCategoryKey,
  clip: Clip,
  lens: LensKey,
  referenceColorMap: Record<string, { bg: string; border: string; text: string; track: string }>,
) {
  if (lens === 'source_type') return sourceColors[clip.source_type]
  if (lens === 'video_reference') return referenceColorMap[clip.video_reference] || referencePalette[0]
  if (lens === 'confidence') return confidenceColor(clip.confidence)
  return signalColors[laneKey]
}

function confidenceColor(confidence: number) {
  if (!hasUsableConfidence(confidence)) return { bg: '#9A9A9A', border: '#707070', text: '#5F5F5F', track: '#E8E7E5' }
  if (confidence >= 0.96) return { bg: '#00DC82', border: '#00B86E', text: '#1D1C1B', track: '#E8F5E9' }
  if (confidence >= 0.9) return { bg: '#60E21B', border: '#30710E', text: '#30710E', track: '#BFF3A4' }
  if (confidence >= 0.82) return { bg: '#FABA17', border: '#7D5D0C', text: '#7D5D0C', track: '#FDE3A2' }
  return { bg: '#FFB592', border: '#805B49', text: '#805B49', track: '#FFD3BE' }
}

function hasUsableConfidence(confidence: number) {
  return Number.isFinite(confidence) && confidence > 0
}

function confidenceLabel(confidence: number) {
  return hasUsableConfidence(confidence) ? String(Math.round(confidence * 100)) : 'N/A'
}

function signalOpacity(confidence: number, minimum: number) {
  return hasUsableConfidence(confidence) ? Math.max(minimum, confidence) : Math.max(minimum, 0.78)
}

function signalLabel(clip: Clip, lens: LensKey, referenceLabelMap: Record<string, string>) {
  void lens
  void referenceLabelMap
  return confidenceLabel(clip.confidence)
}

function maxReelEndSeconds(reels: HighlightReels) {
  const allClips = [
    ...reels.standard_stats.clips,
    ...categories.flatMap((category) => reels[category.key].clips),
  ]
  return Math.max(1, ...allClips.map((clip) => secondsFromTime(clip.end_time)))
}

function secondsFromTime(value: string) {
  const parts = value.split(':').map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function paddedRangeForClip(clip: Clip) {
  const rawStart = secondsFromTime(clip.start_time)
  const rawEnd = Math.max(secondsFromTime(clip.end_time), rawStart + 1)
  const start = Math.max(0, rawStart - REEL_PADDING_SECONDS)
  const end = rawEnd + REEL_PADDING_SECONDS
  return { start, end, duration: end - start }
}

function reelClipParams(
  clip: Clip,
  categoryKey: CategoryKey,
  index: number,
  format: ReelFormatKey,
  download?: boolean,
) {
  const paddedRange = paddedRangeForClip(clip)
  const params = new URLSearchParams({
    start: String(paddedRange.start),
    end: String(paddedRange.end),
    format,
    name: `${categoryKey}-${index + 1}`,
  })
  if (download !== undefined) params.set('download', download ? '1' : '0')
  return params
}

function reelDownloadUrl(
  game: Game,
  videoName: string,
  clip: Clip,
  categoryKey: CategoryKey,
  index: number,
  format: ReelFormatKey,
) {
  const params = reelClipParams(clip, categoryKey, index, format, true)
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/reel/${encodeURIComponent(videoName)}?${params.toString()}`)
}

function reelPreviewUrl(
  game: Game,
  videoName: string,
  clip: Clip,
  categoryKey: CategoryKey,
  index: number,
  format: ReelFormatKey,
) {
  const params = reelClipParams(clip, categoryKey, index, format, false)
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/reel/${encodeURIComponent(videoName)}?${params.toString()}`)
}

function reelThumbnailUrl(game: Game, videoName: string, clip: Clip, format: ReelFormatKey) {
  const paddedRange = paddedRangeForClip(clip)
  const params = new URLSearchParams({
    time: String(paddedRange.start),
    format,
  })
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/reel-thumbnail/${encodeURIComponent(videoName)}?${params.toString()}`)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isSelectedSignal(
  laneKey: MapCategoryKey,
  index: number,
  selectedCategory: CategoryKey,
  selectedEnhancedIndex: number,
  selectedStandardIndex: number,
) {
  if (laneKey === 'standard_stats') return selectedStandardIndex === index
  return selectedCategory === laneKey && selectedEnhancedIndex === index
}

function streamInfoForClip(game: Game, clip: Clip) {
  const mapped = game.video_reference_map?.[clip.video_reference]
  const direct = game.source_videos?.includes(clip.video_reference) ? clip.video_reference : undefined
  const videoName = mapped || direct
  return videoName ? streamInfoForVideoName(game, videoName) : null
}

function streamInfoForVideoName(game: Game, videoName: string) {
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/stream/${encodeURIComponent(videoName)}`)
}

function thumbnailForVideoName(game: Game, videoName: string) {
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/thumbnail/${encodeURIComponent(videoName)}`)
}

function uniqueVideoNames(sourceVideos: string[]) {
  return Array.from(new Set(sourceVideos.filter(Boolean)))
}

function clipSelectionForVideo(game: Game, reels: HighlightReels, videoName: string): { category: MapCategoryKey; index: number } | null {
  const lanes = [
    ...categories.map((category) => category.key),
    'standard_stats' as const,
  ]
  for (const category of lanes) {
    const index = reels[category].clips.findIndex((clip) => videoNameForClip(game, clip) === videoName)
    if (index !== -1) return { category, index }
  }
  return null
}

function videoNameForClip(game: Game, clip: Clip) {
  return game.video_reference_map?.[clip.video_reference] || (game.source_videos?.includes(clip.video_reference) ? clip.video_reference : undefined)
}

function gameOptionLabel(game: Game) {
  return game.label === game.sport ? game.label : `${game.label} · ${game.sport}`
}

function discoverySpiralNodes(items: DiscoverItem[]) {
  if (items.length === 0) return []
  const visualCount = Math.max(24, items.length * 7)
  const primaryStart = Math.floor((visualCount - items.length) / 2)
  return Array.from({ length: visualCount }, (_, index) => {
    const item = items[index % items.length]
    const slot = discoveryNodeSlot(index, visualCount)
    const primary = index >= primaryStart && index < primaryStart + items.length
    const style = {
      '--x': `${Math.round(slot.x)}px`,
      '--y': `${Math.round(slot.y)}px`,
      '--z': `${Math.round(slot.z)}px`,
      '--rotate-y': `${slot.rotateY.toFixed(2)}deg`,
      '--rotate-z': `${slot.rotateZ.toFixed(2)}deg`,
      '--scale': slot.scale.toFixed(3),
      '--opacity': slot.opacity.toFixed(3),
      '--card-width': `${Math.round(slot.width)}px`,
      '--card-ratio': slot.ratio.toFixed(3),
      '--blur': `${slot.blur}px`,
      '--motion-delay': `${(-index * 0.32).toFixed(2)}s`,
      zIndex: Math.round(100 + slot.z),
    } as CSSProperties
    return {
      id: `${item.id}-${index}`,
      item,
      primary,
      style,
    }
  })
}

function discoveryNodeSlot(index: number, count: number) {
  const t = count === 1 ? 0.5 : index / (count - 1)
  const angle = -0.64 * Math.PI + t * 6.45 * Math.PI
  const front = (Math.sin(angle) + 1) / 2
  const radius = 420 + Math.sin(t * Math.PI * 2.2) * 95
  const edgeFade = Math.abs(t - 0.5)
  const aspectCycle = [0.56, 0.62, 0.5, 0.68, 0.44, 0.58]
  return {
    x: Math.cos(angle) * radius + Math.sin(t * Math.PI * 5.2) * 88,
    y: (t - 0.5) * 1460 + Math.sin(angle) * 115,
    z: Math.sin(angle) * 390 - edgeFade * 150,
    scale: 0.58 + front * 0.5,
    opacity: clamp(0.16 + front * 0.76 - edgeFade * 0.16, 0.12, 0.94),
    width: 150 + front * 180 + (index % 5 === 0 ? 34 : 0),
    rotateY: clamp(-Math.cos(angle) * 56, -62, 62),
    rotateZ: Math.sin(angle * 0.42) * 5 + (index % 3 - 1) * 1.5,
    ratio: aspectCycle[index % aspectCycle.length],
    blur: front < 0.16 ? 1.2 : front < 0.28 ? 0.45 : 0,
  }
}

function knowledgeBaseItems(game: Game, sourceVideos: string[], searchQuery: string) {
  const normalized = searchQuery.trim().toLowerCase()
  const uniqueSourceVideos = Array.from(new Set(sourceVideos))
  return uniqueSourceVideos
    .filter((videoName) => {
      const searchable = [videoName, game.label, game.sport, game.knowledge_store_id].join(' ').toLowerCase()
      return !normalized || searchable.includes(normalized)
    })
    .map((videoName, index) => ({
      id: `${game.tag}-${videoName}-${index}`,
      label: 'Sports Knowledge Base Video',
      title: videoName,
      subtitle: `${game.label} · ${game.sport}`,
      media: streamInfoForVideoName(game, videoName),
      poster: thumbnailForVideoName(game, videoName),
      videoName,
      knowledgeStoreId: game.knowledge_store_id,
    }))
}

function shortId(value: string) {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function apiUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

function secureHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const errorValue = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : null
    const message =
      errorValue && typeof errorValue === 'object' && 'message' in errorValue
        ? String((errorValue as { message: unknown }).message)
        : errorValue
          ? String(errorValue)
          : `${response.status} ${response.statusText}`
    throw new Error(message)
  }
  return body as T
}

export default App
