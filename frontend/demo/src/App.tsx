/// <reference types="vite/client" />

import Hls from 'hls.js'
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logoFull from '../../assets/logo-full.svg?raw'
import logoMark from '../../assets/logo-mark.svg?raw'

const iconModules = import.meta.glob('../../icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const icons = Object.fromEntries(
  Object.entries(iconModules).map(([path, svg]) => [path.replace(/^.*\/icons\//, '').replace('.svg', ''), svg]),
)
const DEFAULT_API_BASE_URL = import.meta.env.PROD ? 'https://sports-semantic-jockey.onrender.com' : ''
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')

type Game = {
  tag: string
  label: string
  sport: string
  knowledge_store_id: string
  marengo_index_id?: string
  source_videos?: string[]
  video_reference_map?: Record<string, string>
  video_asset_ids?: Record<string, string>
  marengo_video_ids?: Record<string, string>
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
  evidence_summary?: string
  visual_evidence?: string[]
  audio_evidence?: string[]
  transcript_evidence?: string[]
  timeline_rationale?: string
  editorial_use?: string
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
  _pegasus_metadata?: PegasusResponseMetadata
}

type CategoryKey = 'best_plays' | 'emotional_moments' | 'fan_experience' | 'behind_the_scenes'
type MapCategoryKey = 'standard_stats' | CategoryKey
type AssemblyModeKey = 'wsc_baseline' | 'twelvelabs_enhanced' | 'hyper_personalized'
type LensKey = 'category' | 'confidence' | 'source_type' | 'video_reference'
type ViewKey = 'discover' | 'workspace' | 'jockey' | 'overview'
type ReelFormatKey = '9x16' | '16x9' | '1x1' | '4x5'
type HighlightReelRequestOptions = { silent?: boolean }

type PegasusResponseMetadata = {
  source?: string
  from_user_metadata?: boolean
  storage?: string
  provider?: string
  model?: string
  index_id?: string
  indexed_asset_id?: string
  asset_id?: string
  source_video_name?: string
  generated_at?: string
  context_hash?: string
  metadata_fields?: string[]
  reels_metadata_field?: string
  detailed_response_metadata_field?: string
  reels_response_chars?: number
  detailed_response_chars?: number
  clip_counts?: Partial<Record<MapCategoryKey, number>>
}

type IndexVideo = {
  id: string
  index_id?: string
  indexed_asset_id?: string | null
  asset_id?: string | null
  name: string
  display_name: string
  source_video_name?: string | null
  status?: string | null
  thumbnail_url?: string | null
  duration_seconds?: number | null
  selectable?: boolean
  has_pegasus_metadata?: boolean
  metadata_generated_at?: string | null
  metadata_source_video_name?: string | null
  metadata_clip_counts?: Partial<Record<MapCategoryKey, number>> | null
}

type IndexVideoResponse = {
  index_id?: string
  index_videos: IndexVideo[]
}

type DiscoverMatch = {
  id: string
  label: string
  text: string
  detail: string
  categoryKey?: MapCategoryKey
  clipIndex?: number
  startTime?: string
  endTime?: string
  confidence?: number
  sourceType?: Clip['source_type']
}

type DiscoverItem = {
  id: string
  label: string
  title: string
  subtitle: string
  media: string
  poster: string
  videoName: string
  knowledgeStoreId: string
  clipCount: number
  semanticCount: number
  matches: DiscoverMatch[]
  matchHeading: string
  searchScore: number
  hasMarengoSearch: boolean
  resultType: 'video' | 'moment' | 'search'
  categoryKey?: MapCategoryKey
  startTime?: string
  endTime?: string
  confidence?: number
  sourceType?: Clip['source_type']
  openTarget?: {
    categoryKey: MapCategoryKey
    clipIndex: number
  }
  searchMoment?: SearchMoment
}

type TwelveLabsStreamInfo = {
  provider: 'twelvelabs'
  type: 'hls'
  asset_id: string
  asset_status: string
  hls_status: string
  manifest_url: string
}

const streamInfoCache = new Map<string, TwelveLabsStreamInfo>()
const streamInfoRequests = new Map<string, Promise<TwelveLabsStreamInfo>>()
const warmedManifestOrigins = new Set<string>()

type MarengoSearchResult = {
  id: string
  provider?: 'marengo'
  video_reference: string
  video_name?: string | null
  timestamp?: string
  start_time?: string
  end_time?: string
  title?: string
  description: string
  relevance: string
  confidence?: number | null
  rank?: number | null
  thumbnail_url?: string | null
  source_asset_id?: string | null
}

type MarengoSearchGroupBy = 'clip'

type MarengoSearchResponse = {
  provider?: 'marengo'
  model?: string
  query: string
  query_interpretation: string
  total_results: number
  search_options?: string[]
  group_by?: MarengoSearchGroupBy
  results: MarengoSearchResult[]
}

type UploadGameVideoResponse = {
  status: 'indexing' | 'ready'
  video_name: string
  asset_id: string
  message?: string
  game: Game
}

type UploadPreviewItem = {
  id: string
  file: File
  url: string
  durationSeconds?: number
}

type SearchMoment = {
  videoName: string
  videoReference: string
  title: string
  description: string
  relevance: string
  startTime?: string
  endTime?: string
  sourceLabel?: string
}

type SegmentRange = {
  startSeconds: number
  endSeconds?: number
  startLabel: string
  endLabel?: string
}

type JockeyManifestClip = {
  id: string
  video_name?: string | null
  video_reference: string
  start_time: string
  end_time: string
  moment_type: string
  emotional_intensity: string
  jockey_rationale: string
  highlight_potential: number
  source_asset_id?: string | null
}

type JockeyChatRequest = {
  message: string
  session_id?: string
  include_reel?: boolean
  video_name?: string
  limit?: number
}

type JockeyChatResponse = {
  session_id?: string | null
  message: string
  narrative_summary: string
  clips: JockeyManifestClip[]
}

type JockeyChatExchange = {
  id: string
  prompt: string
  skillKey?: string
  response?: JockeyChatResponse
  error?: string
  showReel: boolean
}

const categories: Array<{ key: CategoryKey; label: string; icon: string }> = [
  { key: 'best_plays', label: 'Best Plays', icon: 'trophy' },
  { key: 'emotional_moments', label: 'Emotional Moments', icon: 'flame' },
  { key: 'fan_experience', label: 'Fan Experience', icon: 'members' },
  { key: 'behind_the_scenes', label: 'Behind the Scenes', icon: 'indexes' },
]

const assemblyModes: Array<{ key: AssemblyModeKey; label: string; detail: string; icon: string }> = [
  { key: 'wsc_baseline', label: 'Stats Baseline', detail: 'Event-feed baseline', icon: 'usage' },
  { key: 'twelvelabs_enhanced', label: 'TwelveLabs Enhanced', detail: 'Stats plus Pegasus semantic lift', icon: 'vision' },
  { key: 'hyper_personalized', label: 'Hyper-Personalized', detail: 'One lane, social-first', icon: 'filter' },
]

const jockeyProducerSkills: Array<{ key: string; label: string; icon: string; color: string; tint: string; prompt: string }> = [
  {
    key: 'best_plays',
    label: 'Best Plays reel',
    icon: 'trophy',
    color: '#00DC82',
    tint: 'rgba(0,220,130,0.12)',
    prompt: 'Find the top 10 highest-importance scoring events and the 5 seconds of player reaction following each. Return timestamps ranked by stats importance.',
  },
  {
    key: 'emotional_moments',
    label: 'Emotional Moments reel',
    icon: 'flame',
    color: '#FABA17',
    tint: 'rgba(250,186,23,0.14)',
    prompt: 'Identify every moment where a player\'s emotional response is at peak intensity - tears, fist pumps, screaming. Ignore neutral reactions. Return with highlight_potential scores.',
  },
  {
    key: 'fan_experience',
    label: 'Fan Experience reel',
    icon: 'members',
    color: '#6CD5FD',
    tint: 'rgba(108,213,253,0.16)',
    prompt: 'Find all moments of peak crowd energy - sustained roaring, standing ovations, visible fan reactions in the stands. Rank by duration and intensity.',
  },
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
  { key: 'best_plays', label: 'Best Plays', icon: 'trophy' },
  { key: 'emotional_moments', label: 'Emotion', icon: 'flame' },
  { key: 'fan_experience', label: 'Fans', icon: 'members' },
  { key: 'behind_the_scenes', label: 'BTS', icon: 'indexes' },
]

const marengoSearchPresets = [
  'goal celebration teammates',
  'fan going wild in the stands',
  'goalkeeper diving save',
  'coach sideline reaction',
]

const navItems: Array<{ key: ViewKey; label: string; icon: string }> = [
  { key: 'discover', label: 'Discover', icon: 'search-v2' },
  { key: 'workspace', label: 'Dashboard', icon: 'dashboard' },
  { key: 'jockey', label: 'Jockey', icon: 'speech' },
  { key: 'overview', label: 'Overview', icon: 'document-list' },
]

const uploadRequirementLabels = [
  'Duration 4sec-4hr',
  'Resolution 360p-4k',
  'Ratio 1:1-1:2.4',
  'File size ≤4GB per video',
]
const JOCKEY_CHAT_CACHE_PREFIX = 'sports-jockey:jockey-chat:'

const signalColors: Record<MapCategoryKey, { bg: string; border: string; text: string; track: string }> = {
  standard_stats: { bg: '#E8E7E5', border: '#B8B6B3', text: '#4F4F4F', track: '#E8E7E5' },
  best_plays: { bg: '#00DC82', border: '#00B86E', text: '#1D1C1B', track: '#E8F5E9' },
  emotional_moments: { bg: '#FABA17', border: '#7D5D0C', text: '#7D5D0C', track: '#FDE3A2' },
  fan_experience: { bg: '#6CD5FD', border: '#366B7F', text: '#366B7F', track: '#C4EEFE' },
  behind_the_scenes: { bg: '#FFB0CD', border: '#805867', text: '#805867', track: '#FFDFEB' },
}

const sourceColors: Record<Clip['source_type'], { bg: string; border: string; text: string; track: string }> = {
  stats: { bg: '#E8E7E5', border: '#B8B6B3', text: '#4F4F4F', track: '#E8E7E5' },
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
  if (pathname.includes('jockey')) return 'jockey'
  if (pathname.includes('overview')) return 'overview'
  return 'workspace'
}

function pathForView(view: ViewKey) {
  if (view === 'discover') return '/discover'
  if (view === 'jockey') return '/jockey'
  if (view === 'overview') return '/overview'
  return '/'
}

function navButtonClass(currentView: ViewKey, itemView: ViewKey) {
  return currentView === itemView
    ? 'border-accent bg-accent-light text-brand-charcoal'
    : 'border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal'
}

function App() {
  const headerRef = useRef<HTMLElement | null>(null)
  const [laneBarNode, setLaneBarNode] = useState<HTMLElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(76)
  const [laneBarHeight, setLaneBarHeight] = useState(0)
  const [games, setGames] = useState<Game[]>([])
  const [selectedTag, setSelectedTag] = useState('')
  const [view, setView] = useState<ViewKey>(() => viewFromPath(window.location.pathname))
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('best_plays')
  const [selectedEnhancedClipIndex, setSelectedEnhancedClipIndex] = useState(0)
  const [selectedStandardClipIndex, setSelectedStandardClipIndex] = useState(0)
  const [featuredSignalCategory, setFeaturedSignalCategory] = useState<MapCategoryKey>('best_plays')
  const [assemblyMode, setAssemblyMode] = useState<AssemblyModeKey>('twelvelabs_enhanced')
  const [reelsByTag, setReelsByTag] = useState<Record<string, HighlightReels>>({})
  const [indexVideosByTag, setIndexVideosByTag] = useState<Record<string, IndexVideo[]>>({})
  const [gamesError, setGamesError] = useState('')
  const [reelsError, setReelsError] = useState('')
  const [indexVideosError, setIndexVideosError] = useState('')
  const [loadingGames, setLoadingGames] = useState(true)
  const [loadingTag, setLoadingTag] = useState('')
  const [loadingIndexVideosTag, setLoadingIndexVideosTag] = useState('')
  const [selectedSourceVideoName, setSelectedSourceVideoName] = useState<string | null>(null)
  const [pendingWorkspaceVideoName, setPendingWorkspaceVideoName] = useState<string | null>(null)
  const [selectedSearchMoment, setSelectedSearchMoment] = useState<SearchMoment | null>(null)
  const [reelFormat, setReelFormat] = useState<ReelFormatKey>('9x16')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadNotice, setUploadNotice] = useState('')
  const requestedTags = useRef<Set<string>>(new Set())
  const suppressNextVideoReset = useRef(false)
  const selectedGame = useMemo(
    () => games.find((game) => game.tag === selectedTag) || null,
    [games, selectedTag],
  )
  const workspaceIndexVideos = useMemo(
    () => (selectedTag ? indexVideosByTag[selectedTag] || [] : []),
    [indexVideosByTag, selectedTag],
  )
  const workspaceVideoNames = useMemo(
    () => (selectedGame ? workspaceVideoNamesFromIndex(selectedGame, workspaceIndexVideos) : []),
    [selectedGame, workspaceIndexVideos],
  )
  const activeVideoName = workspaceVideoNames.includes(selectedSourceVideoName || '')
    ? selectedSourceVideoName || undefined
    : workspaceVideoNames[0]
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
  const activeSearchMoment = selectedSearchMoment && selectedSearchMoment.videoName === activeVideoName ? selectedSearchMoment : null
  const featuredEyebrow = featuredSignalCategory === 'standard_stats'
    ? 'Event Feed'
    : categories.find((category) => category.key === selectedCategory)?.label || 'Enhanced'
  const featuredTitle = featuredSignalCategory === 'standard_stats' ? 'Event Feed Baseline' : 'Pegasus Discovery Cut'
  const hasHighlightAnalysis = scopedReels ? hasHighlightClips(scopedReels) : false
  const isLoadingReels = Boolean(selectedReelsKey && loadingTag === selectedReelsKey)
  const isLoadingIndexVideos = Boolean(selectedTag && loadingIndexVideosTag === selectedTag)
  const requestHighlightReels = useCallback((videoName?: string, options: HighlightReelRequestOptions = {}) => {
    if (!selectedTag) return
    const cacheKey = reelCacheKey(selectedTag, videoName)
    if (reelsByTag[cacheKey] || requestedTags.current.has(cacheKey)) return
    requestedTags.current.add(cacheKey)
    if (!options.silent) {
      setLoadingTag(cacheKey)
      setReelsError('')
    }
    fetchJson<HighlightReels>(`/games/${encodeURIComponent(selectedTag)}/highlight-reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videoName ? indexVideoRequestPayload(selectedGame, workspaceIndexVideos, videoName) : {}),
    })
      .then((body) => setReelsByTag((current) => ({ ...current, [cacheKey]: body })))
      .catch((error: Error) => {
        requestedTags.current.delete(cacheKey)
        if (!options.silent) setReelsError(error.message)
      })
      .finally(() => {
        if (!options.silent) setLoadingTag((current) => (current === cacheKey ? '' : current))
      })
  }, [reelsByTag, selectedGame, selectedTag, workspaceIndexVideos])

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
    if (!selectedTag || indexVideosByTag[selectedTag]) return
    let active = true
    setLoadingIndexVideosTag(selectedTag)
    setIndexVideosError('')
    fetchJson<IndexVideoResponse>(`/games/${encodeURIComponent(selectedTag)}/index-videos`)
      .then((body) => {
        if (!active) return
        setIndexVideosByTag((current) => ({
          ...current,
          [selectedTag]: uniqueIndexVideos(body.index_videos || []),
        }))
      })
      .catch((error: Error) => {
        if (active) setIndexVideosError(error.message)
      })
      .finally(() => {
        if (active) setLoadingIndexVideosTag((current) => (current === selectedTag ? '' : current))
      })
    return () => {
      active = false
    }
  }, [indexVideosByTag, selectedTag])

  useEffect(() => {
    if (view !== 'workspace' || !activeVideoName) return
    requestHighlightReels(activeVideoName)
  }, [activeVideoName, requestHighlightReels, view])

  useEffect(() => {
    setReelsError('')
  }, [selectedReelsKey])

  useEffect(() => {
    if (suppressNextVideoReset.current) {
      suppressNextVideoReset.current = false
      return
    }
    setSelectedEnhancedClipIndex(0)
    setSelectedStandardClipIndex(0)
    setFeaturedSignalCategory(selectedCategory)
  }, [selectedTag, activeVideoName])

  useEffect(() => {
    if (!selectedGame) {
      setSelectedSourceVideoName(null)
      return
    }
    setSelectedSourceVideoName((current) => (current && workspaceVideoNames.includes(current) ? current : workspaceVideoNames[0] || null))
  }, [selectedGame, workspaceVideoNames])

  useEffect(() => {
    if (!uploadNotice) return
    const timeout = window.setTimeout(() => setUploadNotice(''), 8000)
    return () => window.clearTimeout(timeout)
  }, [uploadNotice])

  const selectSignal = (categoryKey: MapCategoryKey, index: number) => {
    setSelectedSearchMoment(null)
    if (categoryKey === 'standard_stats') {
      setSelectedStandardClipIndex(index)
      setFeaturedSignalCategory('standard_stats')
      setAssemblyMode('wsc_baseline')
      scrollAssemblyHighlightsIntoView()
      return
    }
    setSelectedCategory(categoryKey)
    setSelectedEnhancedClipIndex(index)
    setFeaturedSignalCategory(categoryKey)
    if (assemblyMode === 'wsc_baseline') setAssemblyMode('twelvelabs_enhanced')
    scrollAssemblyHighlightsIntoView()
  }
  const selectCategoryTab = (categoryKey: CategoryKey) => {
    setSelectedSearchMoment(null)
    setSelectedCategory(categoryKey)
    setSelectedEnhancedClipIndex(0)
    setFeaturedSignalCategory(categoryKey)
  }
  const selectWorkspaceLane = (categoryKey: CategoryKey) => {
    selectCategoryTab(categoryKey)
    if (assemblyMode === 'wsc_baseline') setAssemblyMode('hyper_personalized')
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
  const scrollAssemblyHighlightsIntoView = () => {
    window.requestAnimationFrame(() => {
      document.getElementById('assembly-highlights')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    openVideoInWorkspace(item.videoName, item.openTarget, item.searchMoment)
  }
  const openVideoInWorkspace = (videoName: string, target?: DiscoverItem['openTarget'], searchMoment?: SearchMoment) => {
    const dashboardVideoName = workspaceVideoNames.includes(videoName) ? videoName : workspaceVideoNames[0]
    if (!dashboardVideoName) {
      setSelectedSourceVideoName(null)
      setSelectedSearchMoment(null)
      setPendingWorkspaceVideoName(null)
      setSelectedEnhancedClipIndex(0)
      setSelectedStandardClipIndex(0)
      setFeaturedSignalCategory('best_plays')
      navigate('workspace')
      scrollWorkspaceDetailsIntoView()
      return
    }
    const canUseRequestedVideo = dashboardVideoName === videoName
    setSelectedSourceVideoName(dashboardVideoName)
    setSelectedSearchMoment(canUseRequestedVideo ? searchMoment || null : null)
    if (canUseRequestedVideo && searchMoment) setAssemblyMode('twelvelabs_enhanced')
    if (target && canUseRequestedVideo) {
      suppressNextVideoReset.current = true
      if (target.categoryKey === 'standard_stats') {
        setSelectedStandardClipIndex(target.clipIndex)
        setFeaturedSignalCategory('standard_stats')
      } else {
        setSelectedCategory(target.categoryKey)
        setSelectedEnhancedClipIndex(target.clipIndex)
        setFeaturedSignalCategory(target.categoryKey)
      }
      setPendingWorkspaceVideoName(null)
    } else {
      setSelectedEnhancedClipIndex(0)
      setSelectedStandardClipIndex(0)
      setFeaturedSignalCategory(canUseRequestedVideo && searchMoment ? 'standard_stats' : 'best_plays')
      setPendingWorkspaceVideoName(canUseRequestedVideo ? dashboardVideoName : null)
    }
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

  const updateRegisteredGame = (updatedGame: Game, preferredVideoName?: string) => {
    setGames((current) => {
      const exists = current.some((game) => game.tag === updatedGame.tag)
      return exists
        ? current.map((game) => (game.tag === updatedGame.tag ? updatedGame : game))
        : [...current, updatedGame]
    })
    setSelectedTag((current) => current || updatedGame.tag)
    setIndexVideosByTag((current) => {
      const next = { ...current }
      delete next[updatedGame.tag]
      return next
    })
    if (preferredVideoName && (updatedGame.source_videos || []).includes(preferredVideoName)) {
      setSelectedSourceVideoName(preferredVideoName)
    }
  }

  useEffect(() => {
    const header = headerRef.current
    if (!header) return

    const updateHeaderHeight = () => {
      setHeaderHeight(Math.ceil(header.getBoundingClientRect().height))
    }
    updateHeaderHeight()

    const observer = new ResizeObserver(updateHeaderHeight)
    observer.observe(header)
    window.addEventListener('resize', updateHeaderHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHeaderHeight)
    }
  }, [])

  const setWorkspaceLaneBarNode = useCallback((node: HTMLElement | null) => {
    setLaneBarNode(node)
  }, [])

  useEffect(() => {
    if (!laneBarNode) {
      setLaneBarHeight(0)
      return
    }

    const updateLaneBarHeight = () => {
      setLaneBarHeight(Math.ceil(laneBarNode.getBoundingClientRect().height))
    }
    updateLaneBarHeight()

    const observer = new ResizeObserver(updateLaneBarHeight)
    observer.observe(laneBarNode)
    window.addEventListener('resize', updateLaneBarHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateLaneBarHeight)
    }
  }, [laneBarNode])

  const stickyOffsetStyle = {
    '--sj-header-height': `${headerHeight}px`,
    '--sj-lane-height': `${laneBarHeight}px`,
    '--sj-explainability-top': `${headerHeight + laneBarHeight + 16}px`,
  } as CSSProperties

  return (
    <main className="min-h-screen bg-background text-text-primary" style={stickyOffsetStyle}>
      <div className="flex min-h-screen flex-col">
        <header
          ref={headerRef}
          className={[
            'sticky top-0 z-50 border-b shadow-[0_1px_0_rgba(29,28,27,0.04)]',
            'border-border bg-surface',
          ].join(' ')}
        >
          <div
            className={[
              'mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between',
            ].join(' ')}
          >
            <div className="flex items-center gap-4">
              <span
                className={[
                  'inline-flex h-9 w-[180px] items-center',
                  'text-brand-charcoal',
                ].join(' ')}
                dangerouslySetInnerHTML={{ __html: logoFull }}
              />
              <div className="h-7 w-px bg-border" />
              <div>
                <h1 className="text-lg font-semibold text-text-primary">Sports Jockey Intelligence</h1>
              </div>
            </div>
            <nav className="flex w-full items-center gap-2 lg:w-auto lg:flex-1">
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-1.5">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate(item.key)}
                    className={[
                      'inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors sm:px-2.5 sm:text-sm',
                      navButtonClass(view, item.key),
                    ].join(' ')}
                  >
                    <StrandIcon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="hidden shrink-0 sm:block">
                <LiveApiBadge loading={loadingGames} error={Boolean(gamesError)} />
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                disabled={!selectedGame || loadingGames}
                className={[
                  'ml-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors sm:px-3 sm:text-sm',
                  selectedGame && !loadingGames
                    ? 'border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal'
                    : 'cursor-not-allowed border-border bg-card text-text-tertiary',
                ].join(' ')}
                aria-haspopup="dialog"
                title="Add Video"
              >
                <StrandIcon name="plus" className="h-4 w-4" />
                <span>Add Video</span>
              </button>
            </nav>
            <div className="sm:hidden">
              <LiveApiBadge loading={loadingGames} error={Boolean(gamesError)} />
            </div>
          </div>
        </header>

        <UploadVideosModal
          open={uploadModalOpen}
          game={selectedGame}
          onClose={() => setUploadModalOpen(false)}
          onGameUpdated={updateRegisteredGame}
          onUploadQueued={setUploadNotice}
        />

        {uploadNotice && (
          <div className="fixed bottom-5 right-5 z-[120] w-[min(420px,calc(100vw-32px))]">
            <Notice tone="neutral" icon="checkmark" text={uploadNotice} />
          </div>
        )}

        {view === 'workspace' && scopedReels && hasHighlightAnalysis && (
          <WorkspaceLaneBar
            measureRef={setWorkspaceLaneBarNode}
            reels={scopedReels}
            selectedCategory={selectedCategory}
            onSelect={selectWorkspaceLane}
          />
        )}

        {view === 'discover' ? (
        <DiscoverPage
          game={selectedGame}
          loading={loadingGames}
          error={gamesError}
          onOpenInWorkspace={openSourceInWorkspace}
        />
        ) : view === 'jockey' ? (
          <JockeyPage
            game={selectedGame}
            loading={loadingGames}
            error={gamesError}
            onOpenInWorkspace={(videoName, searchMoment) => openVideoInWorkspace(videoName, undefined, searchMoment)}
          />
        ) : view === 'overview' ? (
          <OverviewPage
            onNavigate={navigate}
            game={selectedGame}
            reels={scopedReels}
            loading={loadingGames || isLoadingReels}
          />
        ) : (
          <ProducerCockpit
            loadingGames={loadingGames}
            gamesError={gamesError}
            reelsError={reelsError}
            isLoadingReels={isLoadingReels}
            isLoadingIndexVideos={isLoadingIndexVideos}
            indexVideosError={indexVideosError}
            selectedGame={selectedGame}
            workspaceIndexVideos={workspaceIndexVideos}
            workspaceVideoNames={workspaceVideoNames}
            reels={scopedReels}
            hasHighlightAnalysis={hasHighlightAnalysis}
            activeVideoName={activeVideoName}
            selectedCategory={selectedCategory}
            selectedEnhancedClipIndex={selectedEnhancedClipIndex}
            selectedStandardClipIndex={selectedStandardClipIndex}
            selectedSearchMoment={activeSearchMoment}
            assemblyMode={assemblyMode}
            reelFormat={reelFormat}
            onOpenDiscover={() => navigate('discover')}
            onSourceVideoSelect={openVideoInWorkspace}
            onAssemblyModeChange={setAssemblyMode}
            onReelFormatChange={setReelFormat}
            onSelectSignal={selectSignal}
            onSelectStandardClip={(index) => {
              setSelectedSearchMoment(null)
              setSelectedStandardClipIndex(index)
              setFeaturedSignalCategory('standard_stats')
              scrollWorkspaceDetailsIntoView()
            }}
            onSelectEnhancedClip={(index) => {
              setSelectedSearchMoment(null)
              setSelectedEnhancedClipIndex(index)
              setFeaturedSignalCategory(selectedCategory)
              scrollWorkspaceDetailsIntoView()
            }}
          />
        )}
      </div>
    </main>
  )
}

function JockeyPage({
  game,
  loading,
  error,
  onOpenInWorkspace,
}: {
  game: Game | null
  loading: boolean
  error: string
  onOpenInWorkspace: (videoName: string, searchMoment: SearchMoment) => void
}) {
  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-6">
        <Notice tone="neutral" icon="spinner" text="Loading Jockey" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-6">
        <Notice tone="error" icon="warning" text={error} />
      </div>
    )
  }
  if (!game) {
    return (
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-6">
        <Notice tone="neutral" icon="info" text="No analyzed game selected" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 px-6 py-6">
      <ProducerChatPanel
        game={game}
        onOpenInWorkspace={onOpenInWorkspace}
      />
    </div>
  )
}

function ProducerCockpit({
  loadingGames,
  gamesError,
  reelsError,
  isLoadingReels,
  isLoadingIndexVideos,
  indexVideosError,
  selectedGame,
  workspaceIndexVideos,
  workspaceVideoNames,
  reels,
  hasHighlightAnalysis,
  activeVideoName,
  selectedCategory,
  selectedEnhancedClipIndex,
  selectedStandardClipIndex,
  selectedSearchMoment,
  assemblyMode,
  reelFormat,
  onOpenDiscover,
  onSourceVideoSelect,
  onAssemblyModeChange,
  onReelFormatChange,
  onSelectSignal,
  onSelectStandardClip,
  onSelectEnhancedClip,
}: {
  loadingGames: boolean
  gamesError: string
  reelsError: string
  isLoadingReels: boolean
  isLoadingIndexVideos: boolean
  indexVideosError: string
  selectedGame: Game | null
  workspaceIndexVideos: IndexVideo[]
  workspaceVideoNames: string[]
  reels?: HighlightReels
  hasHighlightAnalysis: boolean
  activeVideoName?: string
  selectedCategory: CategoryKey
  selectedEnhancedClipIndex: number
  selectedStandardClipIndex: number
  selectedSearchMoment: SearchMoment | null
  assemblyMode: AssemblyModeKey
  reelFormat: ReelFormatKey
  onOpenDiscover: () => void
  onSourceVideoSelect: (videoName: string) => void
  onAssemblyModeChange: (mode: AssemblyModeKey) => void
  onReelFormatChange: (format: ReelFormatKey) => void
  onSelectSignal: (categoryKey: MapCategoryKey, index: number) => void
  onSelectStandardClip: (index: number) => void
  onSelectEnhancedClip: (index: number) => void
}) {
  const enhancedCategory = reels?.[selectedCategory]
  const standardClip = reels?.standard_stats.clips[selectedStandardClipIndex] || reels?.standard_stats.clips[0]
  const enhancedClip = enhancedCategory?.clips[selectedEnhancedClipIndex] || enhancedCategory?.clips[0]
  const showProductionTools = Boolean(selectedGame && reels && hasHighlightAnalysis)
  const showExplainabilityRail = Boolean(reels && hasHighlightAnalysis)
  const [explainRailCollapsed, setExplainRailCollapsed] = useState(false)

  const handleAssemblyModeChange = (mode: AssemblyModeKey) => {
    onAssemblyModeChange(mode)
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-6">
      <StatusStrip
        loadingGames={loadingGames}
        gamesError={gamesError}
        reelsError={reelsError}
        isLoadingReels={isLoadingReels}
        isLoadingIndexVideos={isLoadingIndexVideos}
        indexVideosError={indexVideosError}
        selectedGame={selectedGame}
        workspaceVideoCount={workspaceIndexVideos.length}
        reels={reels}
        activeVideoName={activeVideoName}
        onOpenDiscover={onOpenDiscover}
      />

      <WorkspaceModeBar
        mode={assemblyMode}
        onModeChange={handleAssemblyModeChange}
      />

      {reels && !hasHighlightAnalysis && <PegasusIndexNotice game={selectedGame} />}

      <div
        className={[
          'grid min-w-0 gap-6 xl:items-start',
          showExplainabilityRail && !explainRailCollapsed ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : '',
        ].join(' ')}
      >
        <section className="flex min-w-0 flex-col gap-6">
          <div id="workspace-details" className="scroll-mt-40">
            <SplitComparisonStage
              game={selectedGame}
              reels={reels}
              activeVideoName={activeVideoName}
              assemblyMode={assemblyMode}
              selectedCategory={selectedCategory}
              standardClip={standardClip}
              enhancedClip={enhancedClip}
              searchMoment={selectedSearchMoment}
              standardIndex={selectedStandardClipIndex}
              enhancedIndex={selectedEnhancedClipIndex}
              onStandardSelect={onSelectStandardClip}
              onEnhancedSelect={onSelectEnhancedClip}
              emptyText={isLoadingReels ? 'Generating PRD highlight lanes' : 'No clips returned for this source'}
            />
          </div>

          {selectedGame && (
            <WorkspaceVideoCarousel
              game={selectedGame}
              videos={workspaceIndexVideos}
              videoNames={workspaceVideoNames}
              activeVideoName={activeVideoName}
              loading={isLoadingIndexVideos}
              onSelect={onSourceVideoSelect}
            />
          )}

          {showProductionTools && selectedGame && reels && (
            <section id="assembly-highlights" className="flex min-w-0 scroll-mt-[calc(var(--sj-explainability-top)+24px)] flex-col gap-4">
              <ProductionSection icon="play-next" title="Assembly Highlights" detail="Semantic scenes stitched together">
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
                  <ReelSequencePlayer
                    variant="sidecar"
                    game={selectedGame}
                    reels={reels}
                    mode={assemblyMode}
                    categoryKey={selectedCategory}
                    selectedLaneKey={assemblyMode === 'wsc_baseline' ? 'standard_stats' : selectedCategory}
                    selectedClipIndex={assemblyMode === 'wsc_baseline' ? selectedStandardClipIndex : selectedEnhancedClipIndex}
                    onSelect={onSelectSignal}
                  />
                  <SignalMap
                    variant="sidecar"
                    reels={reels}
                    selectedCategory={selectedCategory}
                    selectedEnhancedIndex={selectedEnhancedClipIndex}
                    selectedStandardIndex={selectedStandardClipIndex}
                    onSelect={onSelectSignal}
                  />
                </div>
              </ProductionSection>

              <div className="grid min-w-0 gap-6 border-t border-border-light pt-4">
                {activeVideoName && enhancedCategory && (
                  <ReelBuilder
                    game={selectedGame}
                    videoName={activeVideoName}
                    categoryKey={selectedCategory}
                    category={enhancedCategory}
                    format={reelFormat}
                    onFormatChange={onReelFormatChange}
                  />
                )}
              </div>
            </section>
          )}
        </section>

        {showExplainabilityRail && (
          <aside
            className={[
              'flex min-w-0 flex-col gap-6',
              explainRailCollapsed
                ? 'pointer-events-none fixed right-0 z-50 items-end'
                : 'order-first xl:sticky xl:order-none xl:self-start',
            ].join(' ')}
            style={{
              top: explainRailCollapsed
                ? 'calc(var(--sj-explainability-top) + 8px)'
                : 'var(--sj-explainability-top)',
            }}
          >
            <WorkspaceExplainabilityRail
              collapsed={explainRailCollapsed}
              mode={assemblyMode}
              selectedCategory={selectedCategory}
              activeVideoName={activeVideoName}
              standardClip={standardClip}
              enhancedClip={enhancedClip}
              category={enhancedCategory}
              onToggleCollapse={() => setExplainRailCollapsed((value) => !value)}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

function WorkspaceModeBar({
  mode,
  onModeChange,
}: {
  mode: AssemblyModeKey
  onModeChange: (mode: AssemblyModeKey) => void
}) {
  const activeMode = assemblyModes.find((item) => item.key === mode) || assemblyModes[1]
  return (
    <section className="flex min-w-0 flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent bg-accent-light text-brand-charcoal">
          <ModeGlyph mode={activeMode.key} icon={activeMode.icon} className={activeMode.key === 'twelvelabs_enhanced' ? 'h-5 w-7' : 'h-4 w-4'} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text-primary">{activeMode.label}</h2>
          <p className="mt-0.5 truncate text-xs text-text-secondary">{activeMode.detail}</p>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-3 gap-1.5 sm:flex sm:items-center" aria-label="Workspace mode" role="group">
        {assemblyModes.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onModeChange(option.key)}
            className={[
              'inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-center text-[11px] font-semibold leading-tight transition-colors sm:w-[156px] sm:text-xs',
              mode === option.key
                ? 'border-accent bg-accent-light text-brand-charcoal shadow-[0_1px_4px_rgba(0,220,130,0.14)]'
                : 'border-border-light bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal',
            ].join(' ')}
            title={`${option.label} · ${option.detail}`}
          >
            <ModeGlyph mode={option.key} icon={option.icon} className={option.key === 'twelvelabs_enhanced' ? 'h-4 w-5 shrink-0' : 'h-3.5 w-3.5 shrink-0'} />
            <span className="min-w-0 truncate">{option.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function ModeGlyph({
  mode,
  icon,
  className,
}: {
  mode: AssemblyModeKey
  icon: string
  className?: string
}) {
  if (mode === 'twelvelabs_enhanced') {
    return <span className={['inline-flex text-current [&>svg]:h-full [&>svg]:w-full', className || 'h-4 w-5'].join(' ')} dangerouslySetInnerHTML={{ __html: logoMark }} />
  }
  return <StrandIcon name={icon} className={className} />
}

function WorkspaceLaneBar({
  measureRef,
  reels,
  selectedCategory,
  onSelect,
}: {
  measureRef?: (node: HTMLElement | null) => void
  reels: HighlightReels
  selectedCategory: CategoryKey
  onSelect: (category: CategoryKey) => void
}) {
  const activeCategory = categories.find((category) => category.key === selectedCategory) || categories[0]
  const activeCount = reels[selectedCategory].clips.length
  const activeColor = signalColors[selectedCategory]
  return (
    <section
      ref={measureRef}
      className="sticky top-[var(--sj-header-height)] z-40 w-full border-y border-x-0 bg-surface px-4 py-2 shadow-[0_8px_18px_rgba(29,28,27,0.08)] sm:px-6"
      style={{ borderColor: activeColor.border }}
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
            style={{
              backgroundColor: activeColor.bg,
              borderColor: activeColor.border,
              color: activeColor.text,
            }}
          >
            <StrandIcon name={activeCategory.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">Semantic Lane</p>
            <h2 className="truncate text-sm font-semibold text-text-primary">{activeCategory.label}</h2>
          </div>
          <span className="ml-auto rounded-sm border border-border-light bg-card px-2 py-1 font-mono text-xs font-semibold text-text-primary lg:ml-2">
            {activeCount}
          </span>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4 lg:flex lg:items-center">
          {categories.map((category) => {
            const active = selectedCategory === category.key
            const count = reels[category.key].clips.length
            const color = signalColors[category.key]
            return (
              <button
                key={category.key}
                type="button"
                onClick={() => onSelect(category.key)}
                className={[
                  'inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-center text-xs font-semibold leading-tight transition-colors lg:w-[150px]',
                  active
                    ? 'text-brand-charcoal shadow-[0_1px_4px_rgba(29,28,27,0.12)]'
                    : 'border-border-light bg-card text-text-secondary hover:bg-surface',
                ].join(' ')}
                style={{
                  borderColor: active ? color.border : undefined,
                  backgroundColor: active ? color.track : undefined,
                }}
                title={`${category.label} · ${count} clips`}
              >
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border"
                  style={{
                    backgroundColor: color.bg,
                    borderColor: color.border,
                    color: color.text,
                  }}
                >
                  <StrandIcon name={category.icon} className="h-3 w-3" />
                </span>
                <span className="min-w-0 truncate">{category.label}</span>
                <span className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">{count}</span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function ProductionSection({
  icon,
  title,
  detail,
  children,
}: {
  icon: string
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <section className="min-w-0 border-t border-border-light pt-4">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <StrandIcon name={icon} className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text-primary">{title}</h2>
          <p className="mt-0.5 truncate text-sm text-text-secondary">{detail}</p>
        </div>
      </div>
      <div className="mt-4 min-w-0">
        {children}
      </div>
    </section>
  )
}

function SplitComparisonStage({
  game,
  reels,
  activeVideoName,
  assemblyMode,
  selectedCategory,
  standardClip,
  enhancedClip,
  searchMoment,
  standardIndex,
  enhancedIndex,
  onStandardSelect,
  onEnhancedSelect,
  emptyText,
}: {
  game: Game | null
  reels?: HighlightReels
  activeVideoName?: string
  assemblyMode: AssemblyModeKey
  selectedCategory: CategoryKey
  standardClip?: Clip
  enhancedClip?: Clip
  searchMoment?: SearchMoment | null
  standardIndex: number
  enhancedIndex: number
  onStandardSelect: (index: number) => void
  onEnhancedSelect: (index: number) => void
  emptyText: string
}) {
  const category = reels?.[selectedCategory]
  const rightTitle =
    searchMoment
      ? searchMoment.title
      : assemblyMode === 'wsc_baseline'
      ? 'Event Feed Baseline'
      : assemblyMode === 'hyper_personalized'
        ? category?.title || 'Hyper-Personalized Lane'
        : 'TwelveLabs Enhanced Cut'
  const rightEyebrow =
    searchMoment
      ? searchMoment.sourceLabel || 'Marengo Search'
      : assemblyMode === 'wsc_baseline'
      ? 'Stats Only'
      : categories.find((item) => item.key === selectedCategory)?.label || 'Semantic'
  const rightClip = assemblyMode === 'wsc_baseline' ? standardClip : enhancedClip

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_10px_30px_rgba(29,28,27,0.06)] xl:max-h-[calc(100vh-var(--sj-explainability-top)-24px)] xl:overflow-y-auto">
      <div className="grid gap-4 border-b border-border-light bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-tertiary">Split-View Player</p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">Stats baseline vs Pegasus lift</h2>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <span className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-2.5 text-xs font-semibold text-text-secondary">
            {activeVideoName || game?.label || 'Source footage'}
          </span>
        </div>
      </div>
      <div className="grid min-w-0 xl:grid-cols-2">
        <ComparisonPlayer
          label="Event Feed"
          title="Stats Baseline"
          tone="baseline"
          game={game}
          sourceVideoName={activeVideoName}
          clip={standardClip}
          timelineCategory={reels?.standard_stats}
          timelineLabel="Event Feed"
          selectedTimelineIndex={standardIndex}
          onTimelineSelect={onStandardSelect}
          emptyText={emptyText}
        />
        <ComparisonPlayer
          label={rightEyebrow}
          title={rightTitle}
          tone="enhanced"
          game={game}
          sourceVideoName={activeVideoName}
          clip={searchMoment ? undefined : rightClip}
          searchMoment={searchMoment}
          timelineCategory={searchMoment ? undefined : category}
          timelineLabel={rightEyebrow}
          selectedTimelineIndex={enhancedIndex}
          onTimelineSelect={onEnhancedSelect}
          emptyText={emptyText}
        />
      </div>
    </section>
  )
}

function ComparisonPlayer({
  label,
  title,
  tone,
  game,
  sourceVideoName,
  clip,
  searchMoment,
  timelineCategory,
  timelineLabel,
  selectedTimelineIndex,
  onTimelineSelect,
  emptyText,
}: {
  label: string
  title: string
  tone: 'baseline' | 'enhanced'
  game: Game | null
  sourceVideoName?: string
  clip?: Clip
  searchMoment?: SearchMoment | null
  timelineCategory?: HighlightCategory
  timelineLabel: string
  selectedTimelineIndex: number
  onTimelineSelect: (index: number) => void
  emptyText: string
}) {
  const clipVideoName = game && clip ? videoNameForClip(game, clip) : undefined
  const sourceName = searchMoment?.videoName || clipVideoName || sourceVideoName
  const startTime = searchMoment?.startTime || clip?.start_time
  const endTime = searchMoment?.endTime || clip?.end_time
  const startSeconds = startTime ? secondsFromTime(startTime) : 0
  const endSeconds = endTime ? secondsFromTime(endTime) : undefined
  const streamInfoUrl = game && sourceName ? streamInfoForVideoName(game, sourceName) : null
  const posterUrl = game && sourceName && clip
    ? reelThumbnailUrl(game, sourceName, clip, '16x9')
    : game && sourceName
      ? thumbnailForVideoName(game, sourceName)
      : undefined
  const colorClass = tone === 'baseline' ? 'text-brand-charcoal' : 'text-accent'
  const hasPlayable = Boolean(streamInfoUrl && (searchMoment || clip || sourceName))
  const description = searchMoment?.description || clip?.description || ''
  const metaLabel = searchMoment
    ? `${searchMoment.sourceLabel || 'Marengo search'} match`
    : clip
      ? `${sourceLabel(clip.source_type)} · ${cleanClipTypeLabel(clip.clip_type)}`
      : 'Source video'

  return (
    <article className="min-w-0 border-b border-border-light last:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0">
      <div className="border-b border-border-light bg-surface px-4 py-3.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={['text-xs font-semibold uppercase tracking-[0.1em]', colorClass].join(' ')}>{label}</p>
            <h3 className="mt-1 truncate text-base font-semibold text-text-primary">{title}</h3>
          </div>
          {startTime && (
            <span className="shrink-0 rounded-sm border border-border bg-card px-2 py-1 font-mono text-xs font-semibold text-text-secondary">
              {startTime}{endTime ? ` - ${endTime}` : ''}
            </span>
          )}
        </div>
      </div>
      <div className="flex aspect-video items-center justify-center bg-card text-text-primary">
        {hasPlayable && streamInfoUrl ? (
          <TwelveLabsVideoPlayer
            key={`${streamInfoUrl}-${startTime || 'source'}-${endTime || 'open'}`}
            streamInfoUrl={streamInfoUrl}
            startSeconds={startSeconds}
            endSeconds={endSeconds}
            posterUrl={posterUrl}
            onDuration={() => undefined}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <StrandIcon name="info" className="h-7 w-7 text-text-tertiary" />
            <p className="max-w-sm text-sm font-semibold text-text-secondary">{emptyText}</p>
          </div>
        )}
      </div>
      {timelineCategory && (
        <ClipMarkerLane
          clips={timelineCategory.clips}
          label={timelineLabel}
          selectedIndex={selectedTimelineIndex}
          durationSeconds={0}
          onSelect={onTimelineSelect}
        />
      )}
      <div className="grid gap-3 p-4">
        <div className="min-w-0 rounded-md border border-border-light bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{metaLabel}</p>
          <p className="mt-2 line-clamp-3 text-sm font-semibold leading-5 text-text-primary">
            {description || 'No grounded clip description returned yet.'}
          </p>
        </div>
      </div>
    </article>
  )
}

type SequenceClip = {
  id: string
  title: string
  shortTitle: string
  detail: string
  sourceName: string
  startTime: string
  endTime: string
  laneKey: MapCategoryKey
  sourceIndex: number
}

function ReelSequencePlayer({
  variant = 'standard',
  game,
  reels,
  mode,
  categoryKey,
  selectedLaneKey,
  selectedClipIndex,
  onSelect,
}: {
  variant?: 'standard' | 'sidecar'
  game: Game
  reels: HighlightReels
  mode: AssemblyModeKey
  categoryKey: CategoryKey
  selectedLaneKey: MapCategoryKey
  selectedClipIndex: number
  onSelect?: (categoryKey: MapCategoryKey, index: number) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const clipButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const pointerSelectHandledRef = useRef(false)
  const sequenceClips = useMemo(() => {
    const sequenceCategories = mode === 'wsc_baseline'
      ? [{ key: 'standard_stats' as MapCategoryKey, title: reels.standard_stats.title, clips: reels.standard_stats.clips }]
      : categories.map((category) => ({
        key: category.key as MapCategoryKey,
        title: category.label,
        clips: reels[category.key].clips,
      }))

    const laneOrder: Record<MapCategoryKey, number> = {
      standard_stats: 0,
      best_plays: 1,
      emotional_moments: 2,
      fan_experience: 3,
      behind_the_scenes: 4,
    }

    return sequenceCategories.flatMap((sourceCategory) =>
      sourceCategory.clips
        .map((clip, index): SequenceClip | null => {
          const sourceName = videoNameForClip(game, clip)
          if (!sourceName) return null
          return {
            id: `${mode}-${sourceCategory.key}-${index}-${clip.start_time}`,
            title: sequenceClipTitle(clip, sourceCategory.title, mode, sourceCategory.key),
            shortTitle: sequenceClipShortTitle(sourceCategory.key),
            detail: clip.description,
            sourceName,
            startTime: clip.start_time,
            endTime: clip.end_time,
            laneKey: sourceCategory.key,
            sourceIndex: index,
          }
        })
        .filter((clip): clip is SequenceClip => Boolean(clip)),
    ).sort((left, right) =>
      secondsFromTime(left.startTime) - secondsFromTime(right.startTime) ||
      secondsFromTime(left.endTime) - secondsFromTime(right.endTime) ||
      laneOrder[left.laneKey] - laneOrder[right.laneKey],
    )
  }, [game, mode, reels])
  const activeClip = sequenceClips[activeIndex] || sequenceClips[0]

  useEffect(() => {
    const selectedSequenceClipIndex = sequenceClips.findIndex((clip) =>
      clip.laneKey === selectedLaneKey && clip.sourceIndex === selectedClipIndex,
    )
    if (selectedSequenceClipIndex >= 0) {
      setActiveIndex(selectedSequenceClipIndex)
      return
    }
    if (mode === 'wsc_baseline') {
      setActiveIndex(0)
      return
    }
    const firstCategoryClipIndex = sequenceClips.findIndex((clip) => clip.laneKey === categoryKey)
    setActiveIndex(firstCategoryClipIndex >= 0 ? firstCategoryClipIndex : 0)
  }, [categoryKey, mode, selectedClipIndex, selectedLaneKey, sequenceClips])

  useEffect(() => {
    if (!activeClip) return
    clipButtonRefs.current[activeClip.id]?.scrollIntoView({ block: 'nearest' })
  }, [activeClip])

  if (!activeClip) {
    return (
      <section className="rounded-md border border-border bg-surface p-5 text-sm text-text-tertiary shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
        No sequence clips are available for this assembly mode.
      </section>
    )
  }

  const streamInfoUrl = streamInfoForVideoName(game, activeClip.sourceName)
  const startSeconds = secondsFromTime(activeClip.startTime)
  const endSeconds = secondsFromTime(activeClip.endTime)
  const compact = variant === 'sidecar'
  const progress = ((activeIndex + 1) / Math.max(sequenceClips.length, 1)) * 100
  const activeClipColor = signalColors[activeClip.laneKey]
  const selectSequenceClip = (index: number, clip: SequenceClip) => {
    setActiveIndex(index)
    onSelect?.(clip.laneKey, clip.sourceIndex)
  }

  return (
    <section className="w-full max-w-full min-w-0 overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="grid gap-4 bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StrandIcon name="play-next" className="h-4 w-4 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">Assembly Highlights</h2>
          </div>
          {!compact && <p className="mt-1 text-sm text-text-secondary">Semantic scenes stitched into one source-guided sequence.</p>}
        </div>
        <span className="text-sm font-semibold text-text-tertiary">{activeIndex + 1} / {sequenceClips.length}</span>
      </div>
      <div className="h-1 bg-border-light">
        <span className="block h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className={compact ? 'grid w-full min-w-0 items-start [@media(min-width:720px)]:grid-cols-[minmax(340px,1.35fr)_minmax(260px,0.65fr)]' : 'grid w-full min-w-0 items-start lg:grid-cols-[minmax(0,1.2fr)_360px]'}>
        <div className="flex min-w-0 flex-col bg-surface">
          <div className="m-3 aspect-video min-w-0 overflow-hidden rounded-md bg-card">
            <TwelveLabsVideoPlayer
              key={`${streamInfoUrl}-${activeClip.id}`}
              streamInfoUrl={streamInfoUrl}
              startSeconds={startSeconds}
              endSeconds={endSeconds}
              posterUrl={thumbnailForVideoName(game, activeClip.sourceName)}
              onDuration={() => undefined}
              onRangeComplete={() => setActiveIndex((current) => (current + 1) % sequenceClips.length)}
            />
          </div>
          <div className="min-w-0 border-t border-border-light px-4 py-3">
            <div className="grid gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Now playing</p>
                <h3 className="mt-1 truncate text-sm font-semibold text-text-primary">{activeClip.title}</h3>
                <p className="mt-1 line-clamp-3 text-sm leading-5 text-text-secondary">{activeClip.detail}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border-light bg-card px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Range</p>
                  <p className="mt-1 font-mono text-xs font-semibold text-text-primary">{activeClip.startTime} - {activeClip.endTime}</p>
                </div>
                <div className="rounded-md border border-border-light bg-card px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Tag</p>
                  <p className="mt-1 truncate text-xs font-semibold text-text-primary">{activeClip.title}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-border-light px-4 py-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Assembly</span>
              <span
                className="inline-flex max-w-[72px] truncate rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                style={{
                  backgroundColor: activeClipColor.track,
                  borderColor: activeClipColor.border,
                  color: activeClipColor.text,
                }}
              >
                {activeClip.shortTitle}
              </span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-text-primary">{activeIndex + 1}</span>
              <span className="font-mono text-xs font-semibold text-text-tertiary">/ {sequenceClips.length}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border-light">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <div className={compact ? 'relative grid min-w-0 gap-2 border-t border-border-light px-4 py-3 [@media(min-width:720px)]:max-h-[560px] [@media(min-width:720px)]:overflow-y-auto [@media(min-width:720px)]:border-l [@media(min-width:720px)]:border-t-0 [@media(min-width:720px)]:px-2' : 'relative flex min-w-0 flex-col gap-2 border-t border-border-light px-3 py-4 lg:border-l lg:border-t-0'}>
          <span className="pointer-events-none absolute bottom-5 left-[44px] top-5 z-0 w-px bg-border [@media(min-width:720px)]:left-[36px]" aria-hidden="true" />
          {sequenceClips.map((clip, index) => {
            const active = index === activeIndex
            const selectedLane = mode === 'wsc_baseline' || clip.laneKey === categoryKey
            const muted = !active && !selectedLane
            const color = signalColors[clip.laneKey]
            const laneIcon = mapLanes.find((lane) => lane.key === clip.laneKey)?.icon || 'play-boxed'
            return (
              <button
                key={clip.id}
                ref={(node) => {
                  clipButtonRefs.current[clip.id] = node
                }}
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault()
                  pointerSelectHandledRef.current = true
                  selectSequenceClip(index, clip)
                }}
                onClick={() => {
                  if (pointerSelectHandledRef.current) {
                    pointerSelectHandledRef.current = false
                    return
                  }
                  selectSequenceClip(index, clip)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectSequenceClip(index, clip)
                  }
                }}
                className={[
                  'relative z-10 grid min-w-0 grid-cols-[40px_minmax(0,1fr)_42px] items-center gap-2 rounded-md border px-2 py-2.5 text-left transition-colors',
                  active
                    ? 'border-accent bg-accent-light text-brand-charcoal shadow-[0_8px_22px_rgba(0,220,130,0.12)]'
                    : selectedLane
                      ? 'border-border-light bg-surface text-text-secondary hover:border-accent hover:bg-accent-light'
                      : 'border-border-light bg-surface text-text-tertiary hover:border-border hover:bg-card',
                ].join(' ')}
              >
                <span className="relative z-10 flex min-w-0 flex-col items-center gap-1">
                  <span
                    className={[
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold leading-none',
                      active ? 'shadow-[0_0_0_3px_rgba(0,220,130,0.18)]' : '',
                      muted ? 'opacity-50' : '',
                    ].join(' ')}
                    style={{
                      backgroundColor: active ? color.bg : color.track,
                      borderColor: color.border,
                      color: active ? color.text : color.border,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span className={['font-mono text-[11px] font-semibold text-text-tertiary', muted ? 'opacity-60' : ''].join(' ')}>
                    {formatSeconds(secondsFromTime(clip.startTime))}
                  </span>
                </span>
                <span className={['relative z-10 min-w-0 text-sm font-semibold leading-5', muted ? 'text-text-tertiary' : 'text-text-primary'].join(' ')}>
                  <span className="line-clamp-2">{clip.detail || `${clip.startTime} - ${clip.endTime}`}</span>
                </span>
                <span
                  className={['relative z-10 inline-flex h-8 w-8 items-center justify-center justify-self-end rounded-md border', muted ? 'opacity-50' : ''].join(' ')}
                  style={{
                    backgroundColor: color.track,
                    borderColor: color.border,
                    color: color.text,
                  }}
                  title={clip.title}
                  aria-label={clip.title}
                >
                  <StrandIcon name={laneIcon} className="h-4 w-4" />
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function ProducerChatPanel({
  game,
  onOpenInWorkspace,
}: {
  game: Game
  onOpenInWorkspace: (videoName: string, searchMoment: SearchMoment) => void
}) {
  const [draft, setDraft] = useState('')
  const [exchanges, setExchanges] = useState<JockeyChatExchange[]>(() => readJockeyChatCache(game.tag))
  const [loading, setLoading] = useState(false)
  const [activeSkillKey, setActiveSkillKey] = useState('')
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const hydratedCacheTag = useRef<string | null>(null)
  const canSubmit = Boolean(draft.trim()) && !loading
  const activeSkill = jockeyProducerSkills.find((skill) => skill.key === activeSkillKey)
  const showSuggestions = exchanges.length === 0 && !loading && !draft.trim()

  useEffect(() => {
    hydratedCacheTag.current = null
    setExchanges(readJockeyChatCache(game.tag))
    setDraft('')
    setActiveSkillKey('')
  }, [game.tag])

  useEffect(() => {
    if (hydratedCacheTag.current !== game.tag) {
      hydratedCacheTag.current = game.tag
      return
    }
    writeJockeyChatCache(game.tag, exchanges)
  }, [exchanges, game.tag])

  useEffect(() => {
    if (showSuggestions) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [exchanges, loading, showSuggestions])

  const loadSkillPrompt = (skill: (typeof jockeyProducerSkills)[number]) => {
    setActiveSkillKey(skill.key)
    setDraft(skill.prompt)
    window.requestAnimationFrame(() => composerRef.current?.focus())
  }

  const submitPrompt = (prompt: string) => {
    const message = prompt.trim()
    if (!message || loading) return
    const submittedSkill = activeSkill || jockeySkillForPrompt(message)
    const showReel = jockeyPromptRequestsReel(message, submittedSkill)
    const reelLimit = showReel && jockeyPromptRequestsSpecificClip(message) ? 1 : 8
    const currentExchange: JockeyChatExchange = {
      id: `jockey-exchange-${Date.now()}`,
      prompt: message,
      skillKey: submittedSkill?.key,
      showReel,
    }
    setExchanges((current) => [...current, currentExchange])
    setDraft('')
    setLoading(true)
    const body: JockeyChatRequest = {
      message,
      include_reel: showReel,
      limit: showReel ? reelLimit : 0,
    }
    fetchJson<JockeyChatResponse>(`/games/${encodeURIComponent(game.tag)}/jockey-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((response) => {
        setExchanges((current) =>
          current.map((exchange) => (exchange.id === currentExchange.id ? { ...currentExchange, response } : exchange)),
        )
      })
      .catch((error: Error) => {
        setExchanges((current) =>
          current.map((exchange) => (exchange.id === currentExchange.id ? { ...currentExchange, error: error.message } : exchange)),
        )
      })
      .finally(() => setLoading(false))
  }

  return (
    <section className="flex min-h-[calc(100vh-132px)] w-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-8">
        {showSuggestions ? (
          <div className="mx-auto flex min-h-[440px] w-full max-w-3xl flex-col justify-center">
            <div className="grid gap-2">
              {jockeyProducerSkills.map((skill) => (
                <button
                  key={skill.key}
                  type="button"
                  onClick={() => loadSkillPrompt(skill)}
                  className="group grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-md border border-border-light bg-surface px-4 py-3 text-left text-text-secondary shadow-[0_1px_2px_rgba(31,41,33,0.035)] transition-colors hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center" style={{ color: skill.color }}>
                    <StrandIcon name={skill.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-primary">{skill.label}</span>
                    <span className="mt-1 line-clamp-2 block text-xs font-medium leading-5 text-text-secondary group-hover:text-brand-charcoal">{skill.prompt}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-4">
            {exchanges.map((exchange) => (
              <JockeyExchangeView
                key={exchange.id}
                game={game}
                exchange={exchange}
                onOpenInWorkspace={onOpenInWorkspace}
              />
            ))}
            {loading && (
              <div className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-text-secondary">
                <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
                Jockey is answering
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-border-light bg-background/95 px-1 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-end gap-3 rounded-md border border-border bg-surface px-3 py-2 shadow-[0_10px_30px_rgba(29,28,27,0.08)]">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            className="max-h-[132px] min-h-[48px] flex-1 resize-none bg-transparent px-2 py-3 text-sm font-medium leading-6 text-text-primary outline-none placeholder:text-text-tertiary"
            placeholder={activeSkill ? activeSkill.label : 'Ask Jockey a question or ask for a clip.'}
          />
          <button
            type="button"
            onClick={() => submitPrompt(draft)}
            disabled={!canSubmit}
            className={[
              'mb-1 inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-semibold',
              canSubmit
                ? 'border-accent bg-accent-light text-brand-charcoal hover:bg-accent'
                : 'cursor-not-allowed border-border bg-card text-text-tertiary',
            ].join(' ')}
          >
            <StrandIcon name={loading ? 'spinner' : 'generate'} className={['h-4 w-4', loading ? 'animate-spin' : ''].join(' ')} />
            Send
          </button>
        </div>
      </div>
    </section>
  )
}

function JockeyExchangeView({
  game,
  exchange,
  onOpenInWorkspace,
}: {
  game: Game
  exchange: JockeyChatExchange
  onOpenInWorkspace: (videoName: string, searchMoment: SearchMoment) => void
}) {
  return (
    <div className="min-w-0">
      <div
        className="ml-auto max-w-3xl rounded-md border px-4 py-3 text-sm font-semibold leading-6 text-brand-charcoal"
        style={{
          borderColor: jockeySkillForKey(exchange.skillKey)?.color || '#00DC82',
          backgroundColor: jockeySkillForKey(exchange.skillKey)?.tint || 'rgba(0,220,130,0.12)',
        }}
      >
        <p>{exchange.prompt}</p>
      </div>
      {exchange.error ? (
        <div className="mt-4 max-w-3xl rounded-md border border-error bg-error-light px-4 py-3 text-sm font-semibold leading-6 text-error-dark">
          {exchange.error}
        </div>
      ) : exchange.response ? (
        <JockeyResponseShowcase
          game={game}
          response={exchange.response}
          skill={jockeySkillForKey(exchange.skillKey)}
          showReel={exchange.showReel}
          onOpenInWorkspace={onOpenInWorkspace}
        />
      ) : null}
    </div>
  )
}

function JockeyResponseShowcase({
  game,
  response,
  skill,
  showReel,
  onOpenInWorkspace,
}: {
  game: Game
  response: JockeyChatResponse
  skill?: (typeof jockeyProducerSkills)[number]
  showReel: boolean
  onOpenInWorkspace: (videoName: string, searchMoment: SearchMoment) => void
}) {
  if (showReel) {
    return (
      <div className="mt-4">
        {response.clips.length ? (
          <JockeyClipShowcase
            game={game}
            clips={response.clips}
            onOpenInWorkspace={onOpenInWorkspace}
          />
        ) : (
          <p className="mt-4 text-sm font-semibold text-text-tertiary">No grounded reel clips returned.</p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4 max-w-4xl rounded-md border border-border-light bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(31,41,33,0.035)]">
      <div className="flex items-center gap-2">
        <StrandIcon name={skill?.icon || 'speech'} className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Jockey</h3>
      </div>
      <p className="mt-3 text-sm font-medium leading-6 text-text-secondary">{response.narrative_summary}</p>
    </div>
  )
}

function JockeyClipShowcase({
  game,
  clips,
  onOpenInWorkspace,
}: {
  game: Game
  clips: JockeyManifestClip[]
  onOpenInWorkspace: (videoName: string, searchMoment: SearchMoment) => void
}) {
  const showSliderRow = clips.length > 3

  return (
    <div className={showSliderRow ? 'mt-4 max-w-4xl overflow-x-auto pb-3' : 'mt-4 max-w-[680px]'}>
      <div className={showSliderRow ? 'flex w-max snap-x gap-3' : 'grid grid-cols-[repeat(auto-fit,minmax(164px,196px))] gap-3'}>
        {clips.map((clip, index) => {
          const sourceName = jockeyClipVideoName(game, clip)
          const streamInfoUrl = sourceName ? streamInfoForVideoName(game, sourceName) : null
          const downloadUrl = sourceName ? jockeyReelDownloadUrl(game, sourceName, clip, index) : null
          const posterUrl = sourceName ? thumbnailForVideoName(game, sourceName) : undefined
          const workspaceMoment = sourceName ? jockeyClipSearchMoment(sourceName, clip) : null
          const paddedRange = paddedRangeForClip(clip)

          return (
            <article
              key={clip.id}
              className={[
                'min-w-0 overflow-hidden rounded-md border border-border-light bg-surface shadow-[0_8px_18px_rgba(29,28,27,0.055)]',
                showSliderRow ? 'w-[196px] shrink-0 snap-start' : '',
              ].join(' ')}
            >
            <div className="relative m-1.5 aspect-[9/16] overflow-hidden rounded-md bg-brand-charcoal ring-1 ring-black/5">
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download
                  className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/28 bg-brand-charcoal/78 text-white shadow-[0_8px_18px_rgba(0,0,0,0.2)] backdrop-blur-sm hover:border-accent hover:bg-accent hover:text-brand-charcoal"
                  aria-label={`Download ${clip.start_time} reel`}
                  title="Download reel"
                >
                  <StrandIcon name="download" className="h-4 w-4" />
                </a>
              )}
              {streamInfoUrl ? (
                <TwelveLabsVideoPlayer
                  key={`${streamInfoUrl}-${clip.id}`}
                  streamInfoUrl={streamInfoUrl}
                  startSeconds={paddedRange.start}
                  endSeconds={paddedRange.end}
                  posterUrl={posterUrl}
                  segmentRange={{
                    startSeconds: paddedRange.start,
                    endSeconds: paddedRange.end,
                    startLabel: formatSeconds(paddedRange.start),
                    endLabel: formatSeconds(paddedRange.end),
                  }}
                  variant="minimal"
                  fit="cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-5 text-center text-sm font-semibold text-white/82">
                  Clip source is not mapped to a registered video.
                </div>
              )}
            </div>

            <div className="px-3 pb-3 pt-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 truncate font-mono text-xs font-semibold text-text-primary">
                  {formatSeconds(paddedRange.start)} - {formatSeconds(paddedRange.end)}
                </p>
                {workspaceMoment && sourceName && (
                  <button
                    type="button"
                    onClick={() => onOpenInWorkspace(sourceName, workspaceMoment)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:bg-accent-light hover:text-brand-charcoal"
                    aria-label={`Open ${clip.start_time} clip in Workspace`}
                    title="Open in Workspace"
                  >
                    <StrandIcon name="arrow-diagonal" className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="mt-1 truncate text-xs font-semibold text-text-primary">{clip.moment_type || `Reel ${index + 1}`}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-text-secondary">{clip.jockey_rationale}</p>
              <p className="mt-2 truncate text-xs font-medium text-text-tertiary">
                {sourceName || clip.video_reference}
              </p>
            </div>
          </article>
          )
        })}
      </div>
    </div>
  )
}

function WorkspaceExplainabilityRail({
  collapsed,
  mode,
  selectedCategory,
  activeVideoName,
  standardClip,
  enhancedClip,
  category,
  onToggleCollapse,
}: {
  collapsed: boolean
  mode: AssemblyModeKey
  selectedCategory: CategoryKey
  activeVideoName?: string
  standardClip?: Clip
  enhancedClip?: Clip
  category?: HighlightCategory
  onToggleCollapse: () => void
}) {
  const modeLabel = assemblyModes.find((item) => item.key === mode)?.label || 'Assembly'
  const lane = categories.find((item) => item.key === selectedCategory) || categories[0]
  const selectedClip = mode === 'wsc_baseline' ? standardClip : enhancedClip
  const selectedRange = selectedClip ? `${selectedClip.start_time} - ${selectedClip.end_time}` : 'No clip selected'

  if (collapsed) {
    return (
      <section className="pointer-events-auto">
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            onToggleCollapse()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onToggleCollapse()
            }
          }}
          className="group inline-flex min-h-[118px] w-10 flex-col items-center justify-center gap-2 rounded-l-md border border-r-0 border-border bg-surface px-1 py-3 text-text-secondary shadow-[0_10px_28px_rgba(29,28,27,0.12)] transition hover:border-accent hover:bg-accent-light hover:text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-accent/30"
          aria-expanded="false"
          aria-label="Expand explainability sidebar"
          title="Expand explainability"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-accent bg-accent-light text-brand-charcoal">
            <StrandIcon name="vision" className="h-4 w-4" />
          </span>
          <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-[0.08em]">
            Explainability
          </span>
        </button>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_10px_30px_rgba(29,28,27,0.06)] xl:max-h-[calc(100vh-156px)] xl:overflow-y-auto">
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <StrandIcon name="vision" className="h-4 w-4 shrink-0 text-accent" />
            <h2 className="truncate text-base font-semibold text-text-primary">Explainability</h2>
          </div>
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              onToggleCollapse()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggleCollapse()
              }
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2 text-text-secondary transition hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            aria-expanded="true"
            aria-label="Collapse explainability sidebar"
            title="Collapse explainability"
          >
            <StrandIcon name="collapse" className="h-4 w-4" />
            <span className="text-xs font-semibold">Hide</span>
          </button>
        </div>
        <p className="mt-1 text-sm leading-5 text-text-secondary">
          Selected clip evidence stays pinned while you move through Workspace.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex min-w-0 items-center rounded-sm border border-border-light bg-card px-2.5 py-1 text-xs font-semibold text-text-secondary">
            {modeLabel}
          </span>
          <span className="inline-flex min-w-0 items-center rounded-sm border border-accent/50 bg-accent-light px-2.5 py-1 text-xs font-semibold text-brand-charcoal">
            {mode === 'wsc_baseline' ? 'Event Feed' : lane.label}
          </span>
        </div>

        <div className="mt-4 rounded-md border border-accent/45 bg-accent-light/70 px-3 py-3 shadow-[0_1px_0_rgba(0,220,130,0.08)]">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="inline-flex min-w-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-charcoal">
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_rgba(0,220,130,0.14)]" />
              <span className="truncate">Active evidence</span>
            </p>
            <span className="shrink-0 rounded-sm border border-accent/30 bg-surface/85 px-2 py-1 font-mono text-[11px] font-semibold text-text-secondary">
              {selectedRange}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-text-primary">
            {selectedClip?.description || activeVideoName || 'Select a clip from the player or discovery map'}
          </p>
        </div>
      </div>

      <div className="border-t border-border-light px-4">
        <ReasonBlock title="Stats trigger" clip={standardClip} expectedSource="stats" />
        <ReasonBlock title="TwelveLabs signal" clip={enhancedClip} expectedSource="semantic" />
        {category?.assembly_notes.length ? (
          <div className="border-t border-border-light py-4">
            <h3 className="text-sm font-semibold text-text-primary">Assembly Notes</h3>
            <ul className="mt-3 grid gap-2">
              {category.assembly_notes.map((note, index) => (
                <li key={`${note}-${index}`} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-sm leading-5 text-text-secondary">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function WorkspaceVideoCarousel({
  game,
  videos,
  videoNames,
  activeVideoName,
  loading,
  onSelect,
}: {
  game: Game
  videos: IndexVideo[]
  videoNames: string[]
  activeVideoName?: string
  loading: boolean
  onSelect: (videoName: string) => void
}) {
  const uniqueVideos = useMemo(
    () => (videos.length ? uniqueIndexVideos(videos) : videoNames.map(fallbackIndexVideo)),
    [videoNames, videos],
  )
  const loopVideos = useMemo(() => {
    if (uniqueVideos.length === 0) return []
    const minimumItems = Math.max(8, uniqueVideos.length)
    return Array.from({ length: minimumItems }, (_, index) => uniqueVideos[index % uniqueVideos.length])
  }, [uniqueVideos])

  if (loading && uniqueVideos.length === 0) {
    return (
      <section className="overflow-hidden rounded-md border border-border bg-card px-5 py-4 shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
        <div className="flex items-center gap-3 text-sm font-semibold text-text-secondary">
          <StrandIcon name="spinner" className="h-4 w-4 animate-spin text-accent" />
          Loading indexed videos
        </div>
      </section>
    )
  }

  if (uniqueVideos.length === 0) return null

  const renderVideoButton = (video: IndexVideo, index: number, group: string) => {
    const videoName = indexVideoWorkspaceName(game, video)
    const active = videoName === activeVideoName
    const title = video.display_name || video.name || videoName
    const subtitle = shortIndexId(video.indexed_asset_id || video.asset_id || video.id)
    const poster = video.thumbnail_url || ''
    return (
      <button
        key={`${group}-${videoName}-${index}`}
        type="button"
        onClick={() => onSelect(videoName)}
        className={[
          'group relative h-[118px] w-[210px] shrink-0 overflow-hidden rounded-md border bg-card text-left shadow-[0_8px_24px_rgba(29,28,27,0.08)]',
          active ? 'border-accent ring-2 ring-accent/35' : 'border-border-light hover:border-accent/80',
        ].join(' ')}
        aria-label={`Open ${videoName}`}
        aria-current={active ? 'true' : undefined}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-surface">
            <StrandIcon name="play-boxed" className="h-9 w-9 text-accent" />
          </div>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-surface/92 p-3 shadow-[0_-8px_24px_rgba(29,28,27,0.08)] backdrop-blur-sm">
          <span className="line-clamp-2 text-xs font-semibold leading-4 text-text-primary">{title}</span>
          {subtitle ? <span className="mt-1 block truncate font-mono text-[10px] font-semibold text-text-tertiary">{subtitle}</span> : null}
        </span>
      </button>
    )
  }

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="workspace-video-carousel relative overflow-hidden py-4">
        <div className="workspace-video-carousel-track flex w-max gap-3 px-5">
          <div className="flex shrink-0 gap-3">
            {loopVideos.map((video, index) => renderVideoButton(video, index, 'a'))}
          </div>
          <div className="flex shrink-0 gap-3">
            {loopVideos.map((video, index) => renderVideoButton(video, index, 'b'))}
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

function OverviewPage({
  onNavigate,
}: {
  onNavigate: (view: ViewKey) => void
  game: Game | null
  reels?: HighlightReels
  loading: boolean
}) {
  const comparisonRows = [
    {
      label: 'Core job',
      standard: 'Automated sports highlight creation, personalization, and distribution at real-time scale.',
      enhanced: 'The same event baseline, plus search and reasoning over the meaning inside the footage.',
    },
    {
      label: 'Signal depth',
      standard: 'Sport-trained event indexing: plays, game-state changes, and metadata that move quickly to publish.',
      enhanced: 'Multimodal semantics: actions, speech, audio, OCR, emotion, crowd, scene context, and timestamped citations.',
    },
    {
      label: 'Search',
      standard: 'Best when the moment is already known by feed label, event type, player, or timestamp.',
      enhanced: 'Best when the editor asks for intent: pressure, rivalry, atmosphere, celebration, setup, or narrative payoff.',
    },
    {
      label: 'Editorial review',
      standard: 'Fast clipping and format workflows for high-volume publishing.',
      enhanced: 'Playable evidence with selection rationale, so teams can see why a clip belongs in the story.',
    },
    {
      label: 'Edge',
      standard: 'Speed, scale, rights-holder workflows, and platform delivery.',
      enhanced: 'Long-tail discovery, explainability, and richer fan stories beyond the scoreboard event.',
    },
  ]
  const jockeyAdds = [
    { icon: 'search', label: 'Natural-language moment search' },
    { icon: 'vision', label: 'Visual, speech, audio, and text understanding' },
    { icon: 'speech', label: 'Emotion and atmosphere retrieval' },
    { icon: 'document-list', label: 'Grounded clip rationale' },
  ]

  return (
    <div className="flex flex-1 bg-background">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-6 py-6">
        <section className="grid gap-5 border-b border-border pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">Overview</p>
            <h2 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight text-text-primary">
              WSC Standard vs TwelveLabs Jockey
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">
              WSC is the speed-and-scale benchmark for automated sports highlights. Jockey keeps that event baseline, then adds multimodal search, semantic context, and clip-level reasoning for the moments the feed does not fully explain.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => onNavigate('discover')}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-accent bg-accent-light px-4 text-sm font-semibold text-brand-charcoal hover:bg-accent"
            >
              <StrandIcon name="search" className="h-4 w-4" />
              Discover
            </button>
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary hover:border-accent hover:bg-accent-light"
            >
              <StrandIcon name="play-boxed" className="h-4 w-4" />
              Workspace
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
          <div className="grid md:grid-cols-2">
            <div className="border-b border-border-light bg-card p-5 md:border-b-0 md:border-r">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">Baseline</p>
                  <h3 className="mt-1 text-base font-semibold text-text-primary">WSC Standard</h3>
                </div>
                <StrandIcon name="usage" className="h-5 w-5 text-text-tertiary" />
              </div>
              <div className="mt-4 aspect-video rounded-md border border-dashed border-border bg-surface" />
            </div>

            <div className="bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">Enhanced</p>
                  <h3 className="mt-1 text-base font-semibold text-text-primary">TwelveLabs Jockey</h3>
                </div>
                <StrandIcon name="vision" className="h-5 w-5 text-text-tertiary" />
              </div>
              <div className="mt-4 aspect-video rounded-md border border-dashed border-border bg-surface" />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_360px]">
          <div className="rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
            <div className="border-b border-border-light bg-card px-5 py-4">
              <div className="flex items-center gap-2">
                <StrandIcon name="scalable" className="h-4 w-4 text-accent" />
                <h3 className="text-base font-semibold text-text-primary">Comparison Matrix</h3>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
                WSC is strongest at real-time automated production. Jockey is strongest when editors need the why behind a moment, not only the event that triggered it.
              </p>
            </div>
            <div className="divide-y divide-border-light">
              {comparisonRows.map((row) => (
                <OverviewComparisonRow key={row.label} label={row.label} standard={row.standard} enhanced={row.enhanced} />
              ))}
            </div>
          </div>

          <aside className="rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
            <div className="border-b border-border-light bg-card px-5 py-4">
              <div className="flex items-center gap-2">
                <StrandIcon name="generate" className="h-4 w-4 text-accent" />
                <h3 className="text-base font-semibold text-text-primary">What Jockey Adds</h3>
              </div>
            </div>
            <div className="grid gap-3 p-5">
              {jockeyAdds.map((item) => (
                <div key={item.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border border-border-light bg-card px-3 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-text-secondary">
                    <StrandIcon name={item.icon} className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold leading-5 text-text-primary">{item.label}</span>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}

function OverviewMetric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-surface px-3 py-3">
      <div className="flex items-center gap-2">
        <StrandIcon name={icon} className="h-4 w-4 text-accent" />
        <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      </div>
      <p className="mt-2 truncate text-base font-semibold text-text-primary">{value}</p>
    </div>
  )
}

function OverviewField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-border-light pb-3 last:border-b-0 last:pb-0">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      <p className={['mt-1 break-words text-sm font-semibold text-text-primary', mono ? 'font-mono' : ''].join(' ')}>{value}</p>
    </div>
  )
}

function OverviewCount({ icon, label, value, detail }: { icon: string; label: string; value: number; detail: string }) {
  return (
    <div className="min-w-0 border-l border-border pl-3">
      <div className="flex items-center gap-2">
        <StrandIcon name={icon} className="h-4 w-4 text-accent" />
        <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      </div>
      <p className="mt-1 text-xl font-semibold leading-none text-text-primary">{value}</p>
      <p className="mt-1 truncate text-xs text-text-tertiary">{detail}</p>
    </div>
  )
}

function OverviewComparisonSide({ icon, title, label, body }: { icon: string; title: string; label: string; body: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 px-5 py-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-text-secondary">
        <StrandIcon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
        <h4 className="mt-1 text-base font-semibold text-text-primary">{title}</h4>
        <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">{body}</p>
      </div>
    </div>
  )
}

function OverviewComparisonRow({ label, standard, enhanced }: { label: string; standard: string; enhanced: string }) {
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      <p className="text-sm leading-6 text-text-secondary">{standard}</p>
      <p className="text-sm font-medium leading-6 text-text-primary">{enhanced}</p>
    </div>
  )
}

function OverviewLaneRow({ icon, label, count, width }: { icon: string; label: string; count: number; width: number }) {
  return (
    <div className="grid min-w-0 grid-cols-[156px_minmax(0,1fr)_44px] items-center gap-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-secondary">
        <StrandIcon name={icon} className="h-4 w-4 text-accent" />
        <span className="truncate">{label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-border-light">
        <span className="block h-full rounded-sm bg-accent" style={{ width: `${width}%` }} />
      </div>
      <span className="text-right text-sm font-semibold text-text-primary">{count}</span>
    </div>
  )
}

function OverviewStage({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-5 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-text-secondary">
        <StrandIcon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
        <p className="mt-1 text-sm leading-5 text-text-secondary">{detail}</p>
      </div>
    </article>
  )
}

function UploadVideosModal({
  open,
  game,
  onClose,
  onGameUpdated,
  onUploadQueued,
}: {
  open: boolean
  game: Game | null
  onClose: () => void
  onGameUpdated: (game: Game, preferredVideoName?: string) => void
  onUploadQueued: (message: string) => void
}) {
  const [selectedFiles, setSelectedFiles] = useState<UploadPreviewItem[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const selectedFilesRef = useRef<UploadPreviewItem[]>([])

  useEffect(() => {
    selectedFilesRef.current = selectedFiles
  }, [selectedFiles])

  useEffect(() => {
    return () => {
      selectedFilesRef.current.forEach((item) => window.URL.revokeObjectURL(item.url))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, uploading])

  const clearFiles = useCallback(() => {
    setSelectedFiles((current) => {
      current.forEach((item) => window.URL.revokeObjectURL(item.url))
      return []
    })
    setUploadError('')
  }, [])

  useEffect(() => {
    if (!open) {
      clearFiles()
      setDragActive(false)
      setUploading(false)
    }
  }, [clearFiles, open])

  const closeModal = useCallback(() => {
    if (uploading) return
    onClose()
  }, [onClose, uploading])

  const addFiles = useCallback((fileList?: FileList | null) => {
    if (!fileList) return
    const nextFiles = Array.from(fileList).filter(isVideoFile)
    if (!nextFiles.length) return
    setUploadError('')
    setSelectedFiles((current) => {
      const existingKeys = new Set(current.map((item) => uploadFileKey(item.file)))
      const additions = nextFiles
        .filter((file) => !existingKeys.has(uploadFileKey(file)))
        .map((file) => ({
          id: `${uploadFileKey(file)}-${Math.random().toString(36).slice(2)}`,
          file,
          url: window.URL.createObjectURL(file),
        }))
      return [...current, ...additions]
    })
  }, [])

  const removeFile = useCallback((id: string) => {
    if (uploading) return
    setSelectedFiles((current) => {
      const removed = current.find((item) => item.id === id)
      if (removed) window.URL.revokeObjectURL(removed.url)
      return current.filter((item) => item.id !== id)
    })
  }, [uploading])

  const updateDuration = useCallback((id: string, durationSeconds: number) => {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return
    setSelectedFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, durationSeconds } : item)),
    )
  }, [])

  const openFilePicker = useCallback(() => {
    if (uploading) return
    fileInputRef.current?.click()
  }, [uploading])

  const openFilePickerFromSurface = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (uploading) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('button')) return
    openFilePicker()
  }, [openFilePicker, uploading])

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!uploading) setDragActive(true)
  }
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    if (!uploading) addFiles(event.dataTransfer.files)
  }

  const uploadSelectedVideos = useCallback(async () => {
    if (!game || !selectedFiles.length || uploading) return
    setUploading(true)
    setUploadError('')
    const uploadedNames: string[] = []
    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const item = selectedFiles[index]
        const formData = new FormData()
        formData.set('method', 'direct')
        formData.set('file', item.file)
        const response = await fetchJson<UploadGameVideoResponse>(`/games/${encodeURIComponent(game.tag)}/upload`, {
          method: 'POST',
          body: formData,
        })
        uploadedNames.push(response.video_name)
        onGameUpdated(response.game, response.video_name)
      }
      onUploadQueued(
        uploadedNames.length === 1
          ? `${uploadedNames[0]} uploaded. Index and knowledge-base updates will finish in a few minutes.`
          : `${uploadedNames.length} videos uploaded. Index and knowledge-base updates will finish in a few minutes.`,
      )
      onClose()
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [game, onClose, onGameUpdated, onUploadQueued, selectedFiles, uploading])

  if (!open) return null

  const hasFiles = selectedFiles.length > 0
  const knownDuration = selectedFiles.reduce((total, item) => total + (item.durationSeconds || 0), 0)
  const uploadDisabled = !game || !hasFiles || uploading

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-5">
      <div
        className="flex max-h-[calc(100vh-40px)] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] bg-white px-5 py-4 text-[#202020] shadow-[0_20px_56px_rgba(0,0,0,0.24)] sm:px-6 sm:py-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-videos-title"
      >
        <div className="flex items-start justify-between gap-6">
          <h2 id="upload-videos-title" className="text-xl font-semibold leading-none tracking-normal sm:text-2xl">
            Upload videos
          </h2>
          <span className="rounded-[7px] border-2 border-[#918d88] px-2 py-0.5 text-sm font-semibold leading-none text-[#918d88]">
            2/2
          </span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            addFiles(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />

        <div className="mt-4 min-h-0 overflow-y-auto">
          <div
            className={[
              'flex min-h-[180px] flex-col rounded-[20px] border-2 border-dashed px-4 py-4 transition-colors sm:min-h-[200px] sm:px-5 sm:py-4',
              uploading ? 'cursor-not-allowed' : 'cursor-pointer',
              dragActive ? 'border-[#202020] bg-[#fafafa]' : 'border-[#c6c3c0] bg-white',
            ].join(' ')}
            onClick={openFilePickerFromSurface}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {hasFiles ? (
              <>
                <div className="flex items-start justify-between gap-6">
                  <p className="text-base font-semibold leading-none">
                    {selectedFiles.length} {selectedFiles.length === 1 ? 'video' : 'videos'}
                  </p>
                  <button
                    type="button"
                    onClick={openFilePicker}
                    disabled={uploading}
                    className="rounded-[10px] border-2 border-[#202020] px-3 py-1.5 text-sm font-medium leading-none text-[#202020] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Browse
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap gap-x-4 gap-y-5">
                  {selectedFiles.map((item) => (
                    <div key={item.id} className="min-w-0 w-[126px] sm:w-[136px]">
                      <div className="relative">
                        <div className="aspect-video overflow-hidden rounded-[14px] bg-[#efefef]">
                          <video
                            src={item.url}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-cover"
                            onLoadedMetadata={(event) => {
                              updateDuration(item.id, event.currentTarget.duration)
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(item.id)}
                          disabled={uploading}
                          className="absolute -right-1.5 -top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#4b4b4b] text-white shadow-[0_2px_8px_rgba(29,28,27,0.2)] hover:bg-[#202020] disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Remove ${item.file.name}`}
                          title={`Remove ${item.file.name}`}
                        >
                          <StrandIcon name="close" className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold leading-tight">{item.file.name}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-auto flex justify-end pt-5">
                  <p className="text-sm font-semibold leading-none">
                    Total video duration is {knownDuration ? formatUploadDuration(knownDuration) : 'calculating'}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex min-h-[150px] flex-1 flex-col items-center justify-center text-center">
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={uploading}
                  className="flex flex-col items-center gap-2.5 rounded-[12px] px-4 py-2.5 text-[#202020] hover:bg-[#f7f7f7] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex flex-col items-center text-[#202020]" aria-hidden="true">
                    <span className="text-3xl font-light leading-[0.75]">↑</span>
                    <span className="mt-1 h-0.5 w-7 rounded-full bg-[#202020]" />
                  </span>
                  <span className="text-lg font-medium leading-tight sm:text-xl">Drop videos or browse files</span>
                </button>
                <div className="mt-6 flex flex-wrap justify-center gap-1.5">
                  {uploadRequirementLabels.map((label) => (
                    <span key={label} className="rounded-[6px] border border-[#202020] px-1.5 py-0.5 text-[11px] font-medium leading-none sm:text-xs">
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {uploadError && (
            <div className="mt-4">
              <Notice tone="error" icon="warning" text={uploadError} />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeModal}
            disabled={uploading}
            className="rounded-[12px] border-2 border-[#202020] bg-white px-5 py-2 text-sm font-medium leading-none text-[#202020] hover:bg-[#f7f7f7] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={uploadSelectedVideos}
            disabled={uploadDisabled}
            className={[
              'rounded-[12px] border-2 px-5 py-2 text-sm font-semibold leading-none',
              uploadDisabled
                ? 'cursor-not-allowed border-[#dad8d6] bg-[#ecebea] text-[#8d8985]'
                : 'border-[#202020] bg-[#202020] text-white hover:bg-[#343434]',
            ].join(' ')}
          >
            Upload
          </button>
        </div>
      </div>
    </div>
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
  const [searchQuery, setSearchQuery] = useState('')
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState('')
  const [searchResponse, setSearchResponse] = useState<MarengoSearchResponse | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null)
  const sourceVideos = useMemo(() => game?.source_videos || [], [game])
  const normalizedQuery = normalizeSearchText(submittedSearchQuery)
  const trimmedSearchQuery = submittedSearchQuery.trim()
  const draftSearchQuery = searchQuery.trim()
  const items = useMemo(() => {
    if (!game) return []
    if (normalizedQuery) return searchResponse ? searchResultItems(game, searchResponse) : []
    return sourceVideoItems(game, sourceVideos)
  }, [game, normalizedQuery, searchResponse, sourceVideos])
  const resultLabel = normalizedQuery
    ? searchLoading
      ? 'Searching'
      : `${items.length} results`
    : `${items.length} videos`
  const searchSummary = normalizedQuery
    ? searchResponse?.query_interpretation || 'Matching visual and audio evidence in the footage.'
    : 'Search source footage for visual and audio moments that are not captured in the event feed.'

  useEffect(() => {
    const firstSearchItem = normalizedQuery ? items.find((item) => item.resultType === 'search') : null
    setActivePreviewId(firstSearchItem?.id || null)
  }, [items, normalizedQuery])

  const submitSearch = useCallback(() => {
    const nextQuery = searchQuery.trim()
    setSubmittedSearchQuery(nextQuery)
    if (!nextQuery) {
      setSearchResponse(null)
      setSearchError('')
      setSearchLoading(false)
    }
  }, [searchQuery])

  const updateSearchQuery = useCallback((value: string) => {
    setSearchQuery(value)
    if (!value.trim()) {
      setSubmittedSearchQuery('')
      setSearchResponse(null)
      setSearchError('')
      setSearchLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!game || !trimmedSearchQuery) {
      setSearchResponse(null)
      setSearchError('')
      setSearchLoading(false)
      return
    }

    let active = true
    const controller = new AbortController()
    setSearchLoading(true)
    setSearchError('')
    const timeout = window.setTimeout(() => {
      fetchJson<MarengoSearchResponse>(`/games/${encodeURIComponent(game.tag)}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: trimmedSearchQuery,
          limit: 12,
          group_by: 'clip',
          search_options: ['visual', 'audio'],
        }),
      })
        .then((body) => {
          if (active) setSearchResponse(body)
        })
        .catch((fetchError: Error) => {
          if (active && !controller.signal.aborted) {
            setSearchResponse(null)
            setSearchError(fetchError.message)
          }
        })
        .finally(() => {
          if (active) setSearchLoading(false)
        })
    }, 360)

    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [game, trimmedSearchQuery])

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
          Loading sports videos
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-1 bg-background">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-6 py-8">
        <div className="grid gap-5 border-b border-border pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <div className="inline-flex h-8 items-center rounded-full bg-accent-light px-4 text-xs font-semibold uppercase tracking-[0.18em] text-brand-charcoal">
              Marengo Search
            </div>
            <h2 className="mt-5 max-w-4xl text-4xl font-semibold leading-tight text-text-primary lg:text-5xl">
              {normalizedQuery ? submittedSearchQuery : game.label}
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-text-secondary">{searchSummary}</p>
          </div>
        </div>

        <DiscoverSearchPanel
          value={searchQuery}
          onChange={updateSearchQuery}
          onSubmit={submitSearch}
          resultLabel={resultLabel}
          searchLoading={searchLoading}
          canSearch={Boolean(draftSearchQuery) && !searchLoading}
          presets={marengoSearchPresets}
          onPresetSelect={(preset) => {
            setSearchQuery(preset)
            setSubmittedSearchQuery(preset)
          }}
        />

        <section className="min-w-0">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              <StrandIcon name={searchLoading ? 'spinner' : 'search'} className={['h-4 w-4', searchLoading ? 'animate-spin' : ''].join(' ')} />
              {resultLabel} · click to open
            </div>
          </div>

          {searchError && (
            <div className="mb-4">
              <Notice tone="error" icon="warning" text={searchError} />
            </div>
          )}

          {searchLoading && items.length === 0 ? (
            <div className="flex min-h-[320px] items-center justify-center rounded-md border border-border bg-card p-8 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-text-secondary">
                  <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-text-primary">Searching video</h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">Matching the query against visual and audio evidence.</p>
              </div>
            </div>
          ) : items.length > 0 ? (
            <div className="grid auto-rows-fr gap-5 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <DiscoverResultCard
                  key={item.id}
                  item={item}
                  onOpenInWorkspace={onOpenInWorkspace}
                  isPreviewActive={activePreviewId === item.id}
                  onTogglePreview={() => setActivePreviewId((current) => (current === item.id ? null : item.id))}
                />
              ))}
            </div>
          ) : (
            <DiscoverEmptyState searchQuery={searchQuery} />
          )}
        </section>
      </div>
    </section>
  )
}

function DiscoverSearchPanel({
  value,
  onChange,
  onSubmit,
  resultLabel,
  searchLoading,
  canSearch,
  presets,
  onPresetSelect,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  resultLabel: string
  searchLoading: boolean
  canSearch: boolean
  presets: string[]
  onPresetSelect: (value: string) => void
}) {
  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4 shadow-[0_8px_24px_rgba(29,28,27,0.045)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <label htmlFor="discover-search" className="sr-only">
        Search source videos
      </label>
      <div className="grid gap-3">
        <div className="flex min-h-12 min-w-0 items-center gap-3 rounded-md border border-border bg-surface pl-4 pr-2 focus-within:border-accent">
          <StrandIcon name={searchLoading ? 'spinner' : 'search'} className={['h-4 w-4 text-text-tertiary', searchLoading ? 'animate-spin' : ''].join(' ')} />
          <input
            id="discover-search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmit()
            }}
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-text-primary outline-none placeholder:text-text-tertiary"
            placeholder="Search visual/audio moments: player celebration, crowd roar, diving save..."
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-text-secondary hover:border-accent hover:text-brand-charcoal"
              aria-label="Clear search"
              title="Clear search"
            >
              <StrandIcon name="close" className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSearch}
            className={[
              'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold',
              canSearch
                ? 'border-accent bg-accent-light text-brand-charcoal hover:bg-accent'
                : 'cursor-not-allowed border-border bg-card text-text-tertiary',
            ].join(' ')}
          >
            <StrandIcon name="search" className="h-4 w-4" />
            Search
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onPresetSelect(preset)}
              className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-surface px-3 text-xs font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            >
              <StrandIcon name="vision" className="h-3.5 w-3.5 text-accent" />
              <span className="truncate">{preset}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border-light pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-text-tertiary lg:col-span-2">
        <span>{resultLabel}</span>
      </div>
    </div>
  )
}

function DiscoverMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-none text-text-primary">{value}</p>
    </div>
  )
}

function DiscoverResultCard({
  item,
  onOpenInWorkspace,
  isPreviewActive,
  onTogglePreview,
}: {
  item: DiscoverItem
  onOpenInWorkspace: (item: DiscoverItem) => void
  isPreviewActive: boolean
  onTogglePreview: () => void
}) {
  const category = item.categoryKey ? mapLanes.find((lane) => lane.key === item.categoryKey) : null
  const isMomentResult = item.resultType === 'moment' || item.resultType === 'search'
  const canOpen = Boolean(item.videoName)
  const canPreviewSegment = item.resultType === 'search' && Boolean(item.media && item.searchMoment && item.startTime)
  const actionLabel = isMomentResult ? `Open moment in ${item.videoName}` : `Open details for ${item.videoName}`
  const timeRange = item.startTime ? `${item.startTime}${item.endTime ? ` - ${item.endTime}` : ''}` : ''
  const previewStartSeconds = item.startTime ? secondsFromTime(item.startTime) : 0
  const previewEndSeconds = item.endTime ? secondsFromTime(item.endTime) : undefined
  const segmentRange: SegmentRange | undefined = canPreviewSegment
    ? {
        startSeconds: previewStartSeconds,
        endSeconds: previewEndSeconds,
        startLabel: item.startTime || formatSeconds(previewStartSeconds),
        endLabel: item.endTime,
      }
    : undefined
  const primaryMatch = item.matches[0]

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="relative m-3 overflow-hidden rounded-md border border-border-light bg-card">
        {canPreviewSegment && isPreviewActive ? (
          <div className="aspect-video">
            <TwelveLabsVideoPlayer
              key={`${item.id}-${item.startTime || 'start'}-${item.endTime || 'end'}`}
              streamInfoUrl={item.media}
              startSeconds={previewStartSeconds}
              endSeconds={previewEndSeconds}
              posterUrl={item.poster}
              segmentRange={segmentRange}
              variant="minimal"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={canPreviewSegment ? onTogglePreview : () => onOpenInWorkspace(item)}
            disabled={!canPreviewSegment && !canOpen}
            className="relative block aspect-video w-full overflow-hidden bg-card text-left disabled:cursor-not-allowed"
            aria-label={canPreviewSegment ? `Play result in ${item.videoName}` : actionLabel}
            title={canPreviewSegment ? `Play result in ${item.videoName}` : actionLabel}
          >
            <VideoThumb poster={item.poster} title={item.title} />
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-accent bg-accent-light text-brand-charcoal shadow-[0_8px_20px_rgba(29,28,27,0.12)]">
                <StrandIcon name={canPreviewSegment ? 'play' : 'arrow-diagonal'} className="h-4 w-4" />
              </span>
            </span>
            {segmentRange && <DiscoverSearchSegmentMarker range={segmentRange} />}
          </button>
        )}
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-24px)] flex-wrap gap-2">
          {item.resultType !== 'search' && item.startTime && (
            <span className="rounded-md border border-border bg-surface/92 px-2 py-1 font-mono text-xs font-semibold text-text-primary backdrop-blur-sm">
              {timeRange}
            </span>
          )}
          {item.resultType !== 'search' && primaryMatch && (
            <span className="rounded-md border border-border bg-surface/92 px-2 py-1 text-xs font-semibold text-text-primary backdrop-blur-sm">
              {primaryMatch.label}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">{item.label}</p>
            <h4 className="mt-2 line-clamp-2 text-lg font-semibold leading-6 text-text-primary">{item.title}</h4>
            {item.subtitle && <p className="mt-2 line-clamp-2 text-sm leading-5 text-text-secondary">{item.subtitle}</p>}
          </div>
        </div>

        {item.resultType === 'search' && primaryMatch?.text && (
          <p className="mt-4 rounded-md border border-border-light bg-surface px-3 py-3 text-sm font-medium leading-5 text-text-primary">
            {primaryMatch.text}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {category && <DiscoverBadge icon={category.icon}>{category.label}</DiscoverBadge>}
          {item.sourceType && <DiscoverBadge icon="vision">{sourceLabel(item.sourceType)}</DiscoverBadge>}
        </div>

        <DiscoverMatchList heading={item.matchHeading} matches={item.matches} />

        {item.resultType === 'search' && (
          <div className="mt-auto flex flex-wrap gap-2 pt-5">
            <button
              type="button"
              onClick={() => onOpenInWorkspace(item)}
              disabled={!canOpen}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal disabled:cursor-not-allowed disabled:opacity-60"
            >
              <StrandIcon name="arrow-diagonal" className="h-4 w-4" />
              Open in Workspace
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

function DiscoverSearchSegmentMarker({ range }: { range: SegmentRange }) {
  const segmentEndSeconds = Math.max(range.endSeconds ?? range.startSeconds + 1, range.startSeconds + 1)
  const safeDuration = Math.max(segmentEndSeconds, range.startSeconds + 1, 1)
  const startPercent = clamp((range.startSeconds / safeDuration) * 100, 0, 100)
  const endPercent = clamp((segmentEndSeconds / safeDuration) * 100, startPercent, 100)
  const widthPercent = Math.max(6, endPercent - startPercent)
  const leftPercent = clamp(startPercent, 0, 100 - widthPercent)
  const rightPercent = leftPercent + widthPercent

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-3 bottom-3 z-10 rounded-md border border-accent/35 bg-brand-charcoal/94 px-2.5 py-2 text-white shadow-[0_8px_22px_rgba(29,28,27,0.22)]"
    >
      <span className="relative block h-2.5 overflow-hidden rounded-full bg-white/24">
        <span
          className="absolute top-0 h-full rounded-full bg-accent shadow-[0_0_12px_rgba(0,220,130,0.55)]"
          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
        />
        <span
          className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${leftPercent}%` }}
        />
        <span
          className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${rightPercent}%` }}
        />
      </span>
      <span className="mt-1 flex justify-between gap-3 font-mono text-[10px] font-semibold leading-none text-white/70">
        <span>{range.startLabel}</span>
        <span>{range.endLabel || formatSeconds(Math.round(segmentEndSeconds))}</span>
      </span>
    </span>
  )
}

function DiscoverMatchList({ heading, matches }: { heading: string; matches: DiscoverMatch[] }) {
  if (matches.length === 0) return null
  return (
    <div className="mt-4 border-t border-border-light pt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">{heading}</p>
      <div className="mt-3 flex flex-col gap-3">
        {matches.map((match) => (
          <div key={match.id} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
              <span className="truncate">{match.label}</span>
              {match.startTime && <span className="shrink-0">{match.startTime}</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-text-primary">{match.text}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{match.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function DiscoverBadge({ icon, children }: { icon: string; children: string }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border-light bg-surface px-2 text-xs font-semibold text-text-secondary">
      <StrandIcon name={icon} className="h-3.5 w-3.5 text-accent" />
      <span className="truncate">{children}</span>
    </span>
  )
}

function DiscoverEmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-md border border-dashed border-border bg-card p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-text-secondary">
          <StrandIcon name="search" className="h-4 w-4" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-text-primary">No matches</h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{searchQuery ? `"${searchQuery}" did not match any moment.` : 'No source videos are available.'}</p>
      </div>
    </div>
  )
}

function VideoThumb({ poster, title }: { poster: string; title: string }) {
  if (!poster) {
    return (
      <div className="flex h-full w-full items-center justify-center px-5 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">{title}</span>
      </div>
    )
  }
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
  endSeconds,
  posterUrl,
  onDuration,
  onRangeComplete,
  onStatusChange,
  segmentRange,
  variant = 'default',
  fit = 'contain',
  autoPlay = false,
  muted = false,
  showSegmentControls = true,
  showStatusOverlay = true,
  statusOverlayStyle = 'message',
}: {
  streamInfoUrl: string
  startSeconds: number
  endSeconds?: number
  posterUrl?: string
  onDuration?: (duration: number) => void
  onRangeComplete?: () => void
  onStatusChange?: (status: 'loading' | 'ready' | 'error') => void
  segmentRange?: SegmentRange
  variant?: 'default' | 'minimal'
  fit?: 'contain' | 'cover'
  autoPlay?: boolean
  muted?: boolean
  showSegmentControls?: boolean
  showStatusOverlay?: boolean
  statusOverlayStyle?: 'message' | 'loader'
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('Resolving TwelveLabs stream...')
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [currentSeconds, setCurrentSeconds] = useState(startSeconds)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let disposed = false
    let hls: Hls | null = null
    let handleMetadata: (() => void) | null = null
    let handleReadyFrame: (() => void) | null = null
    let handleTimeUpdate: (() => void) | null = null
    let handlePlay: (() => void) | null = null
    let handlePause: (() => void) | null = null
    let rangeCompleted = false
    let readyFrame = false
    let warmingFirstFrame = false
    let mutedBeforeWarm = muted
    let readinessPoll: number | null = null
    const controller = new AbortController()
    const startLoadAt = Math.max(0, startSeconds)
    const segmentBufferLength = segmentRange
      ? clamp(((endSeconds && endSeconds > startLoadAt ? endSeconds : startLoadAt + 12) - startLoadAt) + 8, 12, 36)
      : 36

    setStatus('loading')
    setMessage('Resolving TwelveLabs stream...')
    setDurationSeconds(0)
    setCurrentSeconds(startSeconds)
    setPlaying(false)
    onDuration?.(0)
    video.pause()
    video.removeAttribute('src')
    video.load()

    fetchTwelveLabsStreamInfo(streamInfoUrl, controller.signal)
      .then((stream) => {
        if (disposed) return
        if (stream.provider !== 'twelvelabs' || stream.type !== 'hls' || !stream.manifest_url) {
          throw new Error('TwelveLabs stream response did not include a playable HLS manifest')
        }
        const manifestUrl = secureHttpsUrl(stream.manifest_url)
        if (!manifestUrl) {
          throw new Error('TwelveLabs stream response did not include a secure HLS manifest')
        }
        preconnectManifestOrigin(manifestUrl)
        setMessage('Loading TwelveLabs HLS stream...')
        const playWhenReady = () => {
          if (!autoPlay || disposed) return
          video.play().catch(() => undefined)
        }
        const warmFirstFrame = () => {
          if (autoPlay || disposed || variant === 'minimal') return
          mutedBeforeWarm = video.muted
          warmingFirstFrame = true
          video.muted = true
          video.play()
            .then(() => {
              if (disposed || autoPlay || !warmingFirstFrame) return
              warmingFirstFrame = false
              video.pause()
              video.muted = mutedBeforeWarm
            })
            .catch(() => {
              warmingFirstFrame = false
              if (!disposed) video.muted = mutedBeforeWarm
            })
        }
        const finishWarmup = () => {
          if (!warmingFirstFrame || autoPlay || disposed) return
          warmingFirstFrame = false
          video.pause()
          video.muted = mutedBeforeWarm
        }
        const markReady = () => {
          if (disposed || readyFrame) return
          readyFrame = true
          setStatus('ready')
          setMessage('')
          playWhenReady()
          finishWarmup()
        }

        handleMetadata = () => {
          if (disposed) return
          const duration = Number.isFinite(video.duration) ? video.duration : 0
          setDurationSeconds(duration)
          onDuration?.(duration)
          video.currentTime = clamp(startLoadAt, 0, Math.max(duration, startLoadAt))
          setCurrentSeconds(video.currentTime)
          setMessage('Opening TwelveLabs stream...')
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markReady()
        }
        handleReadyFrame = () => {
          markReady()
        }
        handleTimeUpdate = () => {
          if (disposed) return
          setCurrentSeconds(video.currentTime)
          if (!readyFrame && video.currentTime > 0) markReady()
          if (rangeCompleted || !endSeconds || endSeconds <= startSeconds) return
          if (video.currentTime >= endSeconds - 0.15) {
            rangeCompleted = true
            video.pause()
            onRangeComplete?.()
          }
        }
        handlePlay = () => {
          if (disposed) return
          rangeCompleted = false
          if (endSeconds && endSeconds > startSeconds && video.currentTime >= endSeconds - 0.15) {
            video.currentTime = startSeconds
            setCurrentSeconds(startSeconds)
          }
          if (video.currentTime < startSeconds - 0.15) {
            video.currentTime = startSeconds
            setCurrentSeconds(startSeconds)
          }
          setPlaying(true)
        }
        handlePause = () => {
          if (!disposed) setPlaying(false)
        }
        video.addEventListener('loadedmetadata', handleMetadata)
        video.addEventListener('loadeddata', handleReadyFrame)
        video.addEventListener('canplay', handleReadyFrame)
        video.addEventListener('timeupdate', handleTimeUpdate)
        video.addEventListener('play', handlePlay)
        video.addEventListener('pause', handlePause)
        readinessPoll = window.setInterval(() => {
          if (disposed || readyFrame) return
          if (video.readyState >= 2 || video.currentTime > 0) markReady()
        }, 250)

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = manifestUrl
          video.load()
          warmFirstFrame()
          playWhenReady()
          return
        }

        if (Hls.isSupported()) {
          hls = new Hls({
            autoStartLoad: false,
            startPosition: startLoadAt,
            maxBufferLength: segmentBufferLength,
            maxMaxBufferLength: Math.max(segmentBufferLength, 45),
            backBufferLength: 0,
            lowLatencyMode: true,
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal && !disposed) {
              setStatus('error')
              setMessage('TwelveLabs HLS stream could not be played in this browser')
            }
          })
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (disposed) return
            hls?.startLoad(startLoadAt)
            warmFirstFrame()
            playWhenReady()
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
      if (readinessPoll !== null) window.clearInterval(readinessPoll)
      if (handleMetadata) video.removeEventListener('loadedmetadata', handleMetadata)
      if (handleReadyFrame) {
        video.removeEventListener('loadeddata', handleReadyFrame)
        video.removeEventListener('canplay', handleReadyFrame)
      }
      if (handleTimeUpdate) video.removeEventListener('timeupdate', handleTimeUpdate)
      if (handlePlay) video.removeEventListener('play', handlePlay)
      if (handlePause) video.removeEventListener('pause', handlePause)
      if (hls) hls.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [streamInfoUrl, startSeconds, endSeconds, onDuration, onRangeComplete])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (autoPlay) {
      if (status === 'ready') {
        if (endSeconds && endSeconds > startSeconds && video.currentTime >= endSeconds - 0.15) {
          video.currentTime = startSeconds
          setCurrentSeconds(startSeconds)
        }
        if (video.currentTime < startSeconds - 0.15) {
          video.currentTime = startSeconds
          setCurrentSeconds(startSeconds)
        }
      }
      video.play().catch(() => undefined)
      return
    }
    video.pause()
  }, [autoPlay, endSeconds, startSeconds, status])

  const togglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video || status !== 'ready') return
    if (video.paused) {
      if (endSeconds && endSeconds > startSeconds && video.currentTime >= endSeconds - 0.15) {
        video.currentTime = startSeconds
        setCurrentSeconds(startSeconds)
      }
      if (video.currentTime < startSeconds - 0.15) {
        video.currentTime = startSeconds
        setCurrentSeconds(startSeconds)
      }
      video.play().catch(() => {
        setStatus('error')
        setMessage('Video playback could not be started')
      })
      return
    }
    video.pause()
  }, [endSeconds, startSeconds, status])

  const seekToPosition = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const video = videoRef.current
    if (!video || status !== 'ready') return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
    const seekStart = segmentRange ? segmentRange.startSeconds : 0
    const seekEnd = segmentRange
      ? Math.max(segmentRange.endSeconds ?? segmentRange.startSeconds + 1, segmentRange.startSeconds + 1)
      : Math.max(durationSeconds, endSeconds || startSeconds + 1, 1)
    video.currentTime = seekStart + ratio * Math.max(1, seekEnd - seekStart)
    setCurrentSeconds(video.currentTime)
  }, [durationSeconds, endSeconds, segmentRange, startSeconds, status])

  return (
    <div className="relative h-full w-full min-w-0">
      <video
        ref={videoRef}
        className={['h-full w-full min-w-0 accent-accent', fit === 'cover' ? 'object-cover' : 'object-contain'].join(' ')}
        controls={!segmentRange}
        muted={muted}
        playsInline
        preload="auto"
        poster={posterUrl}
      />
      {segmentRange && showSegmentControls && (
        <TwelveLabsSegmentControls
          currentSeconds={currentSeconds}
          durationSeconds={durationSeconds}
          disabled={status !== 'ready'}
          playing={playing}
          range={segmentRange}
          variant={variant}
          onSeek={seekToPosition}
          onTogglePlayback={togglePlayback}
        />
      )}
      {status !== 'ready' && showStatusOverlay && (
        <div
          className={[
            'pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center',
            variant === 'minimal' ? 'bg-brand-charcoal/74 text-white backdrop-blur-[2px]' : 'bg-surface/96 text-text-primary',
          ].join(' ')}
        >
          {statusOverlayStyle === 'loader' ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-brand-charcoal/78 px-3 py-2 text-white shadow-[0_8px_20px_rgba(0,0,0,0.24)]">
              <StrandIcon name={status === 'error' ? 'warning' : 'spinner'} className={['h-4 w-4', status === 'loading' ? 'animate-spin' : ''].join(' ')} />
              <span className="text-xs font-semibold">{status === 'error' ? message : 'Preparing reel'}</span>
            </div>
          ) : (
            <p className={['max-w-md text-sm font-semibold', variant === 'minimal' ? 'text-white' : 'text-text-primary'].join(' ')}>{message}</p>
          )}
        </div>
      )}
    </div>
  )
}

function TwelveLabsSegmentControls({
  currentSeconds,
  durationSeconds,
  disabled,
  playing,
  range,
  variant = 'default',
  onSeek,
  onTogglePlayback,
}: {
  currentSeconds: number
  durationSeconds: number
  disabled: boolean
  playing: boolean
  range: SegmentRange
  variant?: 'default' | 'minimal'
  onSeek: (event: MouseEvent<HTMLButtonElement>) => void
  onTogglePlayback: () => void
}) {
  const segmentEndSeconds = Math.max(range.endSeconds ?? range.startSeconds + 1, range.startSeconds + 1)
  const safeDuration = Math.max(durationSeconds, segmentEndSeconds, range.startSeconds + 1, 1)
  const startPercent = clamp((range.startSeconds / safeDuration) * 100, 0, 100)
  const endPercent = clamp((segmentEndSeconds / safeDuration) * 100, startPercent, 100)
  const widthPercent = Math.max(6, endPercent - startPercent)
  const leftPercent = clamp(startPercent, 0, 100 - widthPercent)
  const rightPercent = leftPercent + widthPercent
  const currentPercent = clamp((currentSeconds / safeDuration) * 100, 0, 100)
  const segmentDuration = Math.max(1, segmentEndSeconds - range.startSeconds)
  const segmentCurrentPercent = clamp(((currentSeconds - range.startSeconds) / segmentDuration) * 100, 0, 100)

  if (variant === 'minimal') {
    return (
      <div className="absolute inset-x-3 bottom-3 z-20">
        <div className="grid grid-cols-[32px_minmax(0,1fr)_52px] items-center gap-2 rounded-md bg-brand-charcoal/82 px-2 py-1.5 text-white shadow-[0_8px_20px_rgba(29,28,27,0.18)] backdrop-blur-sm">
          <button
            type="button"
            onClick={onTogglePlayback}
            disabled={disabled}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-brand-charcoal hover:bg-accent disabled:cursor-not-allowed disabled:bg-white/35 disabled:text-white/60"
            aria-label={playing ? 'Pause video' : 'Play video'}
            title={playing ? 'Pause video' : 'Play video'}
          >
            <StrandIcon name={playing ? 'pause' : 'play'} className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onSeek}
            disabled={disabled}
            className="relative h-7 min-w-0 rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Seek video"
            title="Seek video"
          >
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25" />
            <span
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent"
              style={{ left: 0, width: '100%' }}
            />
            <span
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/70"
              style={{ width: `${segmentCurrentPercent}%` }}
            />
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-accent shadow-sm"
              style={{ left: `${segmentCurrentPercent}%` }}
            />
          </button>
          <span className="text-right font-mono text-[10px] font-semibold tabular-nums text-white/78">
            {formatSeconds(Math.round(currentSeconds))}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-x-3 bottom-3 z-20 rounded-md border border-border bg-surface/96 px-3 py-2 text-text-primary shadow-[0_8px_24px_rgba(29,28,27,0.22)]">
      <div className="grid grid-cols-[34px_minmax(0,1fr)_64px] items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlayback}
          disabled={disabled}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-accent bg-accent text-brand-charcoal hover:bg-accent-light disabled:cursor-not-allowed disabled:border-border disabled:bg-card disabled:text-text-tertiary"
          aria-label={playing ? 'Pause video' : 'Play video'}
          title={playing ? 'Pause video' : 'Play video'}
        >
          <StrandIcon name={playing ? 'pause' : 'play'} className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onSeek}
          disabled={disabled}
          className="relative h-9 min-w-0 rounded-md disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Seek video"
          title="Seek video"
        >
          <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border-light" />
          <span
            className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-text-tertiary/45"
            style={{ width: `${currentPercent}%` }}
          />
          <span
            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_rgba(0,220,130,0.55)]"
            style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
          />
          <span
            className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `${leftPercent}%` }}
          />
          <span
            className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `${rightPercent}%` }}
          />
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-charcoal bg-card shadow-sm"
            style={{ left: `${currentPercent}%` }}
          />
        </button>
        <span className="text-right font-mono text-[10px] font-semibold text-text-secondary">
          {formatSeconds(Math.round(currentSeconds))}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-3 pl-12 pr-16 font-mono text-[10px] font-semibold text-text-tertiary">
        <span>{range.startLabel}</span>
        <span>{range.endLabel || formatSeconds(Math.round(segmentEndSeconds))}</span>
      </div>
    </div>
  )
}

function StatusStrip({
  loadingGames,
  gamesError,
  reelsError,
  isLoadingReels,
  isLoadingIndexVideos,
  indexVideosError,
  selectedGame,
  workspaceVideoCount,
  reels,
  activeVideoName,
  onOpenDiscover,
}: {
  loadingGames: boolean
  gamesError: string
  reelsError: string
  isLoadingReels: boolean
  isLoadingIndexVideos: boolean
  indexVideosError: string
  selectedGame: Game | null
  workspaceVideoCount: number
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
  if (isLoadingIndexVideos && !activeVideoName) {
    return <Notice tone="neutral" icon="spinner" text="Loading videos from the TwelveLabs index" />
  }
  if (indexVideosError && workspaceVideoCount === 0) {
    return <Notice tone="error" icon="warning" text={`Index videos could not load: ${indexVideosError}`} />
  }
  if (!activeVideoName) {
    return <Notice tone="neutral" icon="info" text="No indexed videos returned for this workspace" />
  }
  if (reelsError) {
    return <Notice tone="error" icon="warning" text={reelsError} />
  }
  if (isLoadingReels) {
    return <Notice tone="neutral" icon="spinner" text={`Reading saved metadata for ${activeVideoName}`} />
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
              <WorkspaceFact icon="neural-network" label="Enhanced" value={String(enhancedCount)} />
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
        <div className="border-t border-border-light bg-card px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <StrandIcon name="document-list" className="h-4 w-4 shrink-0 text-accent" />
            <h3 className="truncate text-base font-semibold text-text-primary">Analysis Summary</h3>
          </div>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-text-secondary">
            {displayAnalysisSummary(reels.match_summary)}
          </p>
        </div>
      </section>
    )
  }
  return <Notice tone="neutral" icon="hourglass" text="Select an indexed video to load its saved metadata" />
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

function PegasusIndexNotice({ game }: { game: Game | null }) {
  return (
    <section className="rounded-md border border-warning bg-warning-light p-5 text-warning-dark shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="flex items-start gap-3">
        <StrandIcon name="hourglass" className="mt-0.5 h-5 w-5" />
        <div>
          <h2 className="text-base font-semibold">Analysis is not ready yet</h2>
          <p className="mt-2 text-sm leading-6">
            {game?.label || 'This sports workspace'} has source videos available for playback, but this source does not have a saved analysis package yet.
          </p>
          <p className="mt-2 text-sm leading-6">
            Once the saved analysis is available, the summary, clip lanes, explainability, and reel tools will appear here.
          </p>
        </div>
      </div>
    </section>
  )
}

function SignalMap({
  variant = 'standard',
  reels,
  selectedCategory,
  selectedEnhancedIndex,
  selectedStandardIndex,
  onSelect,
}: {
  variant?: 'standard' | 'sidecar'
  reels: HighlightReels
  selectedCategory: CategoryKey
  selectedEnhancedIndex: number
  selectedStandardIndex: number
  onSelect: (categoryKey: MapCategoryKey, index: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const pointerToggleHandledRef = useRef(false)
  const toggleCollapsed = () => setCollapsed((value) => !value)
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
  const compact = variant === 'sidecar'
  const mapLens: LensKey = 'category'

  return (
    <section className="rounded-md border border-border bg-surface shadow-[0_10px_30px_rgba(29,28,27,0.05)]">
      <div
        className={[
          'flex flex-wrap items-center justify-between gap-3',
          collapsed ? '' : 'border-b border-border-light',
          compact ? 'px-4 py-3' : 'px-5 py-4',
        ].join(' ')}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <StrandIcon name="neural-network" className="h-4 w-4 text-brand-charcoal" />
            <h2 className="text-base font-semibold text-text-primary">Meta Discovery Map</h2>
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <MapMetricPill label="Lift" value={String(semanticCount)} />
              <MapMetricPill label="Conf." value={avgConfidence} />
            </div>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-3 sm:justify-end">
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              pointerToggleHandledRef.current = true
              toggleCollapsed()
            }}
            onClick={() => {
              if (pointerToggleHandledRef.current) {
                pointerToggleHandledRef.current = false
                return
              }
              toggleCollapsed()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggleCollapsed()
              }
            }}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-semibold text-text-secondary transition hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand Meta Discovery Map' : 'Collapse Meta Discovery Map'}
            title={collapsed ? 'Expand map' : 'Collapse map'}
          >
            <StrandIcon name={collapsed ? 'expand' : 'collapse'} className="h-4 w-4" />
            <span>{collapsed ? 'Show' : 'Hide'}</span>
          </button>
        </div>
      </div>

      {!collapsed && <div className={compact ? 'px-4 py-3' : 'overflow-x-auto px-5 py-4'}>
        <div className={compact ? 'min-w-0' : 'min-w-[860px]'}>
          <div className="flex flex-col gap-3.5">
            {mapLanes.map((lane) => {
              const laneNodes = nodes.filter((node) => node.lane.key === lane.key)
              const laneTrackColor = mapLens === 'category' ? signalColors[lane.key].track : '#E8E7E5'
              return (
                <div key={lane.key} className={['grid items-center', compact ? 'grid-cols-[86px_1fr] gap-2' : 'grid-cols-[132px_1fr] gap-4'].join(' ')}>
                  <div className={['flex items-center gap-2 font-semibold text-text-secondary', compact ? 'text-xs' : 'text-sm'].join(' ')}>
                    <StrandIcon name={lane.icon} className="h-4 w-4" />
                    <span className="truncate">{lane.label}</span>
                    <span className="ml-auto text-xs font-semibold text-text-tertiary">{laneNodes.length}</span>
                  </div>
                  <div className={['relative rounded-md border border-border-light bg-surface', compact ? 'h-10' : 'h-12'].join(' ')}>
                    <div className="absolute left-3 right-3 top-1/2 h-1 -translate-y-1/2 rounded-sm" style={{ backgroundColor: laneTrackColor }} />
                    {laneNodes.map((node) => {
                      const left = clamp((node.start / maxTime) * 100, 0, 97)
                      const width = clamp(((node.end - node.start) / maxTime) * 100, 2.2, 18)
                      const selected = isSelectedSignal(node.lane.key, node.index, selectedCategory, selectedEnhancedIndex, selectedStandardIndex)
                      const color = signalColor(node.lane.key, node.clip, mapLens, referenceColorMap)
                      return (
                        <button
                          key={`${lane.key}-${node.index}-${node.clip.start_time}`}
                          type="button"
                          onPointerDown={(event) => {
                            event.preventDefault()
                            onSelect(lane.key, node.index)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              onSelect(lane.key, node.index)
                            }
                          }}
                          onClick={() => onSelect(lane.key, node.index)}
                          aria-label={`${lane.label} ${node.clip.start_time}, confidence ${confidenceLabel(node.clip.confidence)}. ${node.clip.description}`}
                          title={`${lane.label} · Confidence ${confidenceLabel(node.clip.confidence)} · ${node.clip.start_time}-${node.clip.end_time}`}
                          className={[
                            'absolute top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-sm border font-mono font-bold leading-none shadow-[0_2px_6px_rgba(31,41,33,0.12)] transition-transform hover:scale-110',
                            compact ? 'h-6 px-1.5 text-[9px]' : 'h-5 px-1 text-[10px]',
                            selected ? 'z-10 ring-2 ring-accent ring-offset-2 ring-offset-surface' : '',
                          ].join(' ')}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            minWidth: compact ? 30 : 24,
                            backgroundColor: color.bg,
                            borderColor: color.border,
                            color: color.text,
                            opacity: signalOpacity(node.clip.confidence, 0.55),
                          }}
                        >
                          {signalLabel(node.clip, mapLens, referenceLabelMap)}
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
      </div>}
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
  searchMoment,
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
  searchMoment?: SearchMoment | null
  onTimelineSelect: (index: number) => void
  emptyText: string
}) {
  const clipVideoName = game && clip ? videoNameForClip(game, clip) : undefined
  const effectiveClip = sourceVideoName && sourceVideoName !== clipVideoName ? undefined : clip
  const streamInfoUrl = game && sourceVideoName ? streamInfoForVideoName(game, sourceVideoName) : game && effectiveClip ? streamInfoForClip(game, effectiveClip) : null
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0)
  const searchStartSeconds = searchMoment?.startTime ? secondsFromTime(searchMoment.startTime) : 0
  const clipStartSeconds = effectiveClip ? secondsFromTime(effectiveClip.start_time) : searchStartSeconds
  const clipRangeLabel = effectiveClip
    ? `${effectiveClip.start_time} - ${effectiveClip.end_time}`
    : searchMoment?.startTime
      ? `${searchMoment.startTime}${searchMoment.endTime ? ` - ${searchMoment.endTime}` : ''}`
      : ''
  const sourceName = sourceVideoName || searchMoment?.videoName || (effectiveClip && game ? videoNameForClip(game, effectiveClip) : undefined)
  const posterUrl = game && sourceName && effectiveClip
    ? reelThumbnailUrl(game, sourceName, effectiveClip, '16x9')
    : game && sourceName
      ? thumbnailForVideoName(game, sourceName)
      : undefined

  useEffect(() => {
    setVideoDurationSeconds(0)
  }, [streamInfoUrl, effectiveClip?.start_time, effectiveClip?.end_time, searchMoment?.startTime, searchMoment?.endTime])

  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_10px_30px_rgba(29,28,27,0.06)]">
      <div className="grid gap-4 border-b border-border-light bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">{title}</h2>
          {sourceName && <p className="mt-2 truncate text-sm text-text-secondary">{sourceName}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {clipRangeLabel && (
            <span className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 font-mono text-xs font-semibold text-text-secondary">
              {clipRangeLabel}
            </span>
          )}
          {effectiveClip && <Confidence value={effectiveClip.confidence} />}
        </div>
      </div>
      {streamInfoUrl || effectiveClip ? (
        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_380px]">
          <div className="min-w-0 border-b border-border-light lg:border-b-0 lg:border-r">
            <div className="flex aspect-video items-center justify-center bg-card text-text-primary">
              {streamInfoUrl ? (
                <TwelveLabsVideoPlayer
                  key={`${streamInfoUrl}-${effectiveClip?.start_time || 'source'}-${effectiveClip?.end_time || 'full'}`}
                  streamInfoUrl={streamInfoUrl}
                  startSeconds={clipStartSeconds}
                  posterUrl={posterUrl}
                  onDuration={setVideoDurationSeconds}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <StrandIcon name="info" className="h-8 w-8 text-text-tertiary" />
                  <p className="max-w-sm text-sm font-medium text-text-secondary">No TwelveLabs stream mapping for this video</p>
                  {effectiveClip && <p className="max-w-md break-all text-xs text-text-tertiary">{effectiveClip.video_reference}</p>}
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
            {searchMoment ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Timecode" value={clipRangeLabel} />
                  <Detail label="Source" value={searchMoment.sourceLabel || 'Marengo search'} />
                  <Detail label="Reference" value={searchMoment.videoReference} />
                </div>
                <div className="rounded-md border border-border-light bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Grounded Match</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{searchMoment.description}</p>
                  <p className="mt-2 text-sm leading-5 text-text-secondary">{searchMoment.relevance}</p>
                </div>
              </>
            ) : effectiveClip ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Timecode" value={clipRangeLabel} />
                  <Detail label="Source" value={sourceLabel(effectiveClip.source_type)} />
                  <Detail label="Clip type" value={cleanClipTypeLabel(effectiveClip.clip_type)} />
                  <Detail label="Reference" value={effectiveClip.video_reference} />
                </div>
                <div className="rounded-md border border-border-light bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Grounded Citation</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{effectiveClip.description}</p>
                  {effectiveClip.score_context && <p className="mt-2 text-sm leading-5 text-text-secondary">{effectiveClip.score_context}</p>}
                </div>
                <div className="rounded-md border border-border-light bg-surface p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selection Signal</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{effectiveClip.explainability_label}</p>
                  {effectiveClip.evidence_summary && (
                    <p className="mt-2 text-sm leading-5 text-text-primary">{effectiveClip.evidence_summary}</p>
                  )}
                  <p className="mt-2 text-sm leading-5 text-text-secondary">{effectiveClip.selection_reason}</p>
                  <EvidenceStack clip={effectiveClip} />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Sport" value={game?.sport || 'Sports'} />
                </div>
                <div className="rounded-md border border-border-light bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Source Video</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{sourceName}</p>
                  <p className="mt-2 text-sm leading-5 text-text-secondary">Full registered game footage is available while clip-level citations are resolving for this source.</p>
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
    <div className="border-b border-border bg-card px-4 py-3 text-text-secondary lg:border-b-0">
      <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        <span>{clips.length} {label} points</span>
        <span>
          {selectedClip.start_time} - {selectedClip.end_time}
        </span>
      </div>
      <div className="relative mt-3 h-7" aria-label={`${label} clip points on player timeline`}>
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border-light" />
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
                  ? 'border-accent bg-accent shadow-[0_0_14px_rgba(0,220,130,0.35)] ring-2 ring-accent/25'
                  : 'border-border bg-surface hover:border-accent hover:bg-accent',
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

function ReelBuilder({
  game,
  videoName,
  categoryKey,
  category,
  format,
  onFormatChange,
}: {
  game: Game
  videoName: string
  categoryKey: CategoryKey
  category: HighlightCategory
  format: ReelFormatKey
  onFormatChange: (format: ReelFormatKey) => void
}) {
  const formatSpec = reelFormats.find((item) => item.key === format) || reelFormats[0]
  const activeCategory = categories.find((item) => item.key === categoryKey) || categories[0]
  const activeColor = signalColors[categoryKey]
  const firstClip = category.clips[0]
  const lastClip = category.clips[category.clips.length - 1]
  const reelRange = firstClip && lastClip ? `${firstClip.start_time} - ${lastClip.start_time}` : 'No clips'
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="grid gap-4 border-b border-border-light bg-surface px-5 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] xl:items-end">
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"
              style={{
                backgroundColor: activeColor.bg,
                borderColor: activeColor.border,
                color: activeColor.text,
              }}
            >
              <StrandIcon name={activeCategory.icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-text-primary">Tag Reels</h2>
                <span
                  className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs font-semibold"
                  style={{
                    backgroundColor: activeColor.track,
                    borderColor: activeColor.border,
                    color: activeColor.text,
                  }}
                >
                  <span className="truncate">{activeCategory.label}</span>
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-text-secondary">{videoName}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                <span>{category.clips.length} clips</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>{formatSpec.label}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="normal-case tracking-normal">{reelRange}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Format</span>
            <span className="text-xs font-semibold text-text-secondary">{formatSpec.detail}</span>
          </div>
          <div className="grid min-w-0 grid-cols-4 overflow-hidden rounded-md border border-border-light bg-card p-0.5" aria-label="Reel format" role="group">
            {reelFormats.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onFormatChange(option.key)}
                className={[
                  'h-8 min-w-0 rounded-sm px-2 text-center text-xs font-semibold transition-colors',
                  format === option.key
                    ? 'bg-accent-light text-brand-charcoal ring-1 ring-accent'
                    : 'text-text-secondary hover:bg-surface hover:text-brand-charcoal',
                ].join(' ')}
                title={`${option.label} · ${option.detail}`}
              >
                <span className="truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {category.clips.length > 0 ? (
        <div className="overflow-x-auto px-4 py-4">
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
  const [hoverPreviewing, setHoverPreviewing] = useState(false)
  const [previewLocked, setPreviewLocked] = useState(false)
  const [playerStatus, setPlayerStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const paddedRange = paddedRangeForClip(clip)
  const streamInfoUrl = streamInfoForVideoName(game, videoName)
  const posterUrl = reelThumbnailUrl(game, videoName, clip, format)
  const downloadUrl = reelDownloadUrl(game, videoName, clip, categoryKey, index, format)
  const categoryLabel = categories.find((category) => category.key === categoryKey)?.label || 'Reel'
  const segmentRange = useMemo(() => ({
    startSeconds: paddedRange.start,
    endSeconds: paddedRange.end,
    startLabel: formatSeconds(paddedRange.start),
    endLabel: formatSeconds(paddedRange.end),
  }), [paddedRange.end, paddedRange.start])
  const previewing = hoverPreviewing || previewLocked

  useEffect(() => {
    setPlayerStatus('loading')
  }, [format, segmentRange.endSeconds, segmentRange.startSeconds, streamInfoUrl])

  return (
    <article
      tabIndex={0}
      aria-label={`Preview reel clip ${index + 1}`}
      aria-busy={playerStatus === 'loading'}
      className="group w-[224px] shrink-0 snap-start cursor-pointer overflow-hidden rounded-md border border-border-light bg-surface shadow-[0_1px_2px_rgba(31,41,33,0.035)] outline-none transition duration-200 hover:-translate-y-1 hover:border-accent hover:bg-accent-light focus:border-accent focus:bg-accent-light focus:ring-2 focus:ring-accent/25 focus-within:border-accent"
      onClick={() => {
        setHoverPreviewing(true)
        setPreviewLocked(true)
      }}
      onFocus={() => setHoverPreviewing(true)}
      onPointerEnter={() => setHoverPreviewing(true)}
      onPointerLeave={() => setHoverPreviewing(false)}
      onMouseEnter={() => setHoverPreviewing(true)}
      onMouseLeave={() => setHoverPreviewing(false)}
      onFocusCapture={() => setHoverPreviewing(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) setHoverPreviewing(false)
      }}
    >
      <div className="relative overflow-hidden bg-card" style={{ aspectRatio: formatSpec.aspect }}>
        <img alt="" src={posterUrl} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        <div className="absolute inset-0">
          <TwelveLabsVideoPlayer
            key={`${streamInfoUrl}-${segmentRange.startSeconds}-${segmentRange.endSeconds}-${format}`}
            streamInfoUrl={streamInfoUrl}
            startSeconds={segmentRange.startSeconds}
            endSeconds={segmentRange.endSeconds}
            posterUrl={posterUrl}
            segmentRange={segmentRange}
            variant="minimal"
            fit="cover"
            autoPlay={previewing}
            muted
            showSegmentControls={false}
            showStatusOverlay
            statusOverlayStyle="loader"
            onStatusChange={setPlayerStatus}
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/62 to-transparent" />
        <div className="absolute left-3 right-3 top-3 flex min-w-0 items-start justify-between gap-2">
          <span
            className="min-w-0 max-w-[136px] truncate rounded-md border border-white/24 bg-brand-charcoal/92 px-2.5 py-1.5 font-mono text-[11px] font-bold leading-none tracking-[0.02em] text-white shadow-[0_8px_18px_rgba(0,0,0,0.2)] backdrop-blur-sm"
            title={categoryLabel}
          >
            {categoryLabel}
          </span>
          <a
            href={downloadUrl}
            download
            aria-label={`Download ${categoryLabel} reel clip ${index + 1}`}
            title="Download reel"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/24 bg-brand-charcoal/92 text-white shadow-[0_8px_18px_rgba(0,0,0,0.2)] backdrop-blur-sm transition hover:border-accent hover:bg-accent hover:text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <StrandIcon name="download" className="h-4 w-4" />
          </a>
        </div>
        {!previewing && playerStatus === 'ready' && (
          <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-text-primary opacity-95 backdrop-blur-sm transition group-hover:scale-105 group-hover:border-accent group-hover:bg-accent">
            <StrandIcon name="play" className="h-4 w-4" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/68 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex min-w-0 items-center justify-between gap-2">
          <span className="shrink-0 rounded-md border border-accent/70 bg-accent px-2 py-1.5 text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-brand-charcoal shadow-[0_8px_18px_rgba(0,0,0,0.18)]">
            Range
          </span>
          <span
            className="min-w-0 truncate rounded-md border border-white/24 bg-brand-charcoal/92 px-2.5 py-1.5 font-mono text-[11px] font-bold leading-none tracking-[0.02em] text-white shadow-[0_8px_18px_rgba(0,0,0,0.2)] backdrop-blur-sm"
            title={`${formatSeconds(paddedRange.start)} - ${formatSeconds(paddedRange.end)}`}
          >
            {formatSeconds(paddedRange.start)} - {formatSeconds(paddedRange.end)}
          </span>
        </div>
      </div>
    </article>
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
    <div className="border-t border-border-light py-4 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {clip && (
          <span className={['rounded-sm px-2 py-1 text-xs font-semibold', aligned ? 'bg-accent-light text-brand-charcoal' : 'bg-card text-text-tertiary'].join(' ')}>
            {sourceLabel(clip.source_type)}
          </span>
        )}
      </div>
      {clip ? (
        <div className="mt-2">
          <p className="text-sm font-semibold text-text-primary">{clip.explainability_label}</p>
          {clip.evidence_summary && <p className="mt-2 text-sm leading-5 text-text-primary">{clip.evidence_summary}</p>}
          <p className="mt-2 text-sm leading-5 text-text-secondary">{clip.selection_reason}</p>
          <EvidenceTrail clip={clip} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-tertiary">No clip selected</p>
      )}
    </div>
  )
}

function EvidenceTrail({ clip }: { clip: Clip }) {
  const evidenceRows = [
    { label: 'Visual', values: clip.visual_evidence || [] },
    { label: 'Audio', values: clip.audio_evidence || [] },
    { label: 'Transcript', values: clip.transcript_evidence || [] },
  ].filter((row) => row.values.length)
  const contextRows = [
    clip.timeline_rationale ? { label: 'Timing', value: clip.timeline_rationale } : null,
    clip.editorial_use ? { label: 'Edit', value: clip.editorial_use } : null,
  ].filter(Boolean) as { label: string; value: string }[]
  if (!evidenceRows.length && !contextRows.length) return null

  return (
    <div className="mt-3 grid gap-2">
      {evidenceRows.map((row) => (
        <div key={row.label} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <p className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{row.label}</p>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {row.values.slice(0, 4).map((value, index) => (
              <span key={`${row.label}-${index}`} className="min-w-0 max-w-full rounded-sm bg-card px-2 py-1 text-xs font-medium leading-4 text-text-secondary">
                {value}
              </span>
            ))}
          </div>
        </div>
      ))}
      {contextRows.map((row) => (
        <div key={row.label} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <p className="pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{row.label}</p>
          <p className="min-w-0 text-sm leading-5 text-text-secondary">{row.value}</p>
        </div>
      ))}
    </div>
  )
}

function EvidenceStack({ clip, compact = false }: { clip: Clip; compact?: boolean }) {
  const rows = [
    { label: 'Visual', values: clip.visual_evidence || [] },
    { label: 'Audio', values: clip.audio_evidence || [] },
    { label: 'Transcript', values: clip.transcript_evidence || [] },
  ].filter((row) => row.values.length)
  const contextRows = [
    clip.timeline_rationale ? { label: 'Timing', value: clip.timeline_rationale } : null,
    clip.editorial_use ? { label: 'Edit', value: clip.editorial_use } : null,
  ].filter(Boolean) as { label: string; value: string }[]
  if (!rows.length && !contextRows.length) return null

  return (
    <div className={compact ? 'flex flex-col gap-2' : 'mt-3 flex flex-col gap-2'}>
      {rows.map((row) => (
        <div key={row.label} className="rounded-md border border-border-light bg-card px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{row.label}</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm leading-5 text-text-secondary">
            {row.values.slice(0, 3).map((value, index) => (
              <li key={`${row.label}-${index}`}>{value}</li>
            ))}
          </ul>
        </div>
      ))}
      {contextRows.map((row) => (
        <Detail key={row.label} label={row.label} value={row.value} />
      ))}
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

function MapMetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-light bg-card px-2 text-xs font-semibold text-text-secondary">
      <span className="uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span className="font-mono text-sm text-text-primary">{value}</span>
    </span>
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
    <span className="shrink-0 rounded-sm border border-border bg-card px-2 py-1 font-mono text-xs font-semibold text-text-primary">
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

function sequenceClipTitle(clip: Clip, fallbackTitle: string, mode: AssemblyModeKey, categoryKey: MapCategoryKey) {
  const laneKey: MapCategoryKey = mode === 'wsc_baseline' ? 'standard_stats' : categoryKey
  const laneTitles: Record<MapCategoryKey, string> = {
    standard_stats: 'Event Moment',
    best_plays: 'Best Play',
    emotional_moments: 'Emotional Moment',
    fan_experience: 'Crowd Moment',
    behind_the_scenes: 'Behind the Scenes',
  }
  return laneTitles[laneKey] || cleanClipTypeLabel(clip.clip_type) || fallbackTitle || 'Reel Moment'
}

function sequenceClipShortTitle(laneKey: MapCategoryKey) {
  const shortTitles: Record<MapCategoryKey, string> = {
    standard_stats: 'Event',
    best_plays: 'Best',
    emotional_moments: 'Emotion',
    fan_experience: 'Fans',
    behind_the_scenes: 'BTS',
  }
  return shortTitles[laneKey]
}

function cleanClipTypeLabel(clipType?: string) {
  if (!clipType) return ''
  const normalized = clipType.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (/^game event$/i.test(normalized)) return 'Event Moment'
  if (/^highlight$/i.test(normalized)) return 'Highlight Moment'
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayAnalysisSummary(summary: string) {
  return summary
    .replace(/^.+?\.mp4\s+Workspace highlights generated with\s+\S+\.\s*/i, '')
    .replace(/^Workspace highlights generated with\s+\S+\.\s*/i, '')
    .trim() || summary
}

function semanticLift(reels: HighlightReels) {
  const enhancedClips = categories.flatMap((category) => reels[category.key].clips)
  return {
    standardCount: reels.standard_stats.clips.length,
    enhancedCount: enhancedClips.length,
    semanticOnly: enhancedClips.filter((clip) => clip.source_type === 'semantic').length,
    hybrid: enhancedClips.filter((clip) => clip.source_type === 'stats_semantic').length,
    highConfidence: enhancedClips.filter((clip) => clip.confidence >= 0.9).length,
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
    match_summary: reels.match_summary || `${videoName} source-only highlight analysis.`,
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

function jockeySkillForKey(skillKey?: string) {
  return jockeyProducerSkills.find((skill) => skill.key === skillKey)
}

function jockeySkillForPrompt(prompt: string) {
  const normalizedPrompt = prompt.trim().toLowerCase()
  return jockeyProducerSkills.find((skill) => normalizedPrompt === skill.prompt.toLowerCase())
}

function jockeyPromptRequestsReel(prompt: string, skill?: (typeof jockeyProducerSkills)[number]) {
  const clipLanguage = /\b(reels?|clips?|moments?|showcase|play|highlights?)\b|\bshow\s+me\b.*\b(clip|moment|highlight|play|reel)\b/i
  return clipLanguage.test(prompt) || clipLanguage.test(skill?.label || '')
}

function jockeyPromptRequestsSpecificClip(prompt: string) {
  return /\b(one|single|specific|that|this)\b.*\b(reel|clip|moment|highlight|play)\b|\b(showcase|show\s+me|play)\b.*\b(clip|moment|highlight|play)\b/i.test(prompt)
}

function jockeyChatCacheKey(tag: string) {
  return `${JOCKEY_CHAT_CACHE_PREFIX}${tag}`
}

function readJockeyChatCache(tag: string): JockeyChatExchange[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(jockeyChatCacheKey(tag))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isJockeyChatExchange)
  } catch {
    return []
  }
}

function writeJockeyChatCache(tag: string, exchanges: JockeyChatExchange[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      jockeyChatCacheKey(tag),
      JSON.stringify(exchanges),
    )
  } catch {
    // Ignore private-mode/quota storage failures; the live chat still works.
  }
}

function isJockeyChatExchange(value: unknown): value is JockeyChatExchange {
  if (!value || typeof value !== 'object') return false
  const exchange = value as Partial<JockeyChatExchange>
  return typeof exchange.id === 'string'
    && typeof exchange.prompt === 'string'
    && typeof exchange.showReel === 'boolean'
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

function paddedRangeForClip(clip: Pick<Clip, 'start_time' | 'end_time'>) {
  const rawStart = secondsFromTime(clip.start_time)
  const rawEnd = Math.max(secondsFromTime(clip.end_time), rawStart + 1)
  const start = Math.max(0, rawStart - REEL_PADDING_SECONDS)
  const end = rawEnd + REEL_PADDING_SECONDS
  return { start, end, duration: end - start }
}

function reelClipParamsForRange(
  clip: Pick<Clip, 'start_time' | 'end_time'>,
  name: string,
  format: ReelFormatKey,
  download?: boolean,
) {
  const paddedRange = paddedRangeForClip(clip)
  const params = new URLSearchParams({
    start: String(paddedRange.start),
    end: String(paddedRange.end),
    format,
    name,
  })
  if (download !== undefined) params.set('download', download ? '1' : '0')
  return params
}

function reelClipParams(
  clip: Clip,
  categoryKey: CategoryKey,
  index: number,
  format: ReelFormatKey,
  download?: boolean,
) {
  return reelClipParamsForRange(clip, `${categoryKey}-${index + 1}`, format, download)
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

function jockeyReelDownloadUrl(game: Game, videoName: string, clip: Pick<Clip, 'start_time' | 'end_time'>, index: number) {
  const params = reelClipParamsForRange(clip, `jockey-${index + 1}`, '9x16', true)
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/reel/${encodeURIComponent(videoName)}?${params.toString()}`)
}

function reelThumbnailUrl(game: Game, videoName: string, clip: Pick<Clip, 'start_time' | 'end_time'>, format: ReelFormatKey) {
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
  const videoName = videoNameForReference(game, clip.video_reference)
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

function uniqueIndexVideos(videos: IndexVideo[]) {
  const seen = new Set<string>()
  const ordered = orderIndexVideosForMetadataFirst(videos)
  return ordered.filter((video) => {
    const key = cleanString(video.indexed_asset_id) || cleanString(video.asset_id) || cleanString(video.id) || cleanString(video.name)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function orderIndexVideosForMetadataFirst(videos: IndexVideo[]) {
  return [...videos].sort((left, right) => Number(Boolean(right.has_pegasus_metadata)) - Number(Boolean(left.has_pegasus_metadata)))
}

function workspaceVideoNamesFromIndex(game: Game, videos: IndexVideo[]) {
  return uniqueVideoNames(uniqueIndexVideos(videos).map((video) => indexVideoWorkspaceName(game, video)))
}

function indexVideoRequestPayload(game: Game | null, videos: IndexVideo[], videoName: string) {
  const video = game ? videos.find((item) => indexVideoWorkspaceName(game, item) === videoName) : undefined
  return {
    video_name: videoName,
    indexed_asset_id: video?.indexed_asset_id || undefined,
    asset_id: video?.asset_id || undefined,
  }
}

function indexVideoWorkspaceName(_game: Game, video: IndexVideo) {
  return (
    cleanString(video.source_video_name)
    || cleanString(video.metadata_source_video_name)
    || cleanString(video.name)
    || cleanString(video.display_name)
    || cleanString(video.indexed_asset_id)
    || cleanString(video.asset_id)
    || cleanString(video.id)
    || 'Indexed video'
  )
}

function fallbackIndexVideo(videoName: string): IndexVideo {
  return {
    id: videoName,
    name: videoName,
    display_name: videoName,
    source_video_name: videoName,
    selectable: true,
  }
}

function shortIndexId(value?: string | null) {
  const cleanValue = cleanString(value)
  if (!cleanValue) return ''
  if (cleanValue.length <= 12) return cleanValue
  return `${cleanValue.slice(0, 6)}...${cleanValue.slice(-4)}`
}

function cleanString(value?: string | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
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
  return videoNameForReference(game, clip.video_reference)
}

function jockeyClipVideoName(game: Game, clip: JockeyManifestClip) {
  return clip.video_name || videoNameForReference(game, clip.video_reference)
}

function jockeyClipSearchMoment(videoName: string, clip: JockeyManifestClip): SearchMoment {
  const potential = typeof clip.highlight_potential === 'number' && Number.isFinite(clip.highlight_potential)
    ? `Highlight potential: ${Math.round(clip.highlight_potential * 100)}`
    : ''
  const relevance = [
    clip.emotional_intensity ? `Intensity: ${clip.emotional_intensity}` : '',
    potential,
  ].filter(Boolean).join(' · ')

  return {
    videoName,
    videoReference: clip.video_reference,
    title: clip.moment_type || 'Jockey clip',
    description: clip.jockey_rationale,
    relevance: relevance || 'Jockey Chat reel selection',
    startTime: clip.start_time,
    endTime: clip.end_time,
    sourceLabel: 'Jockey Chat',
  }
}

function videoNameForReference(game: Game, reference: string) {
  if (!reference) return undefined
  const sourceVideos = game.source_videos || []
  const mapped = game.video_reference_map?.[reference]
  if (mapped) return mapped
  if (sourceVideos.includes(reference)) return reference

  const assetMatch = Object.entries(game.video_asset_ids || {}).find(([, assetId]) => assetId === reference)?.[0]
  if (assetMatch) return assetMatch
  const embeddedAssetMatch = Object.entries(game.video_asset_ids || {}).find(([, assetId]) => Boolean(assetId && reference.includes(assetId)))?.[0]
  if (embeddedAssetMatch) return embeddedAssetMatch
  const marengoMatch = Object.entries(game.marengo_video_ids || {}).find(([, marengoVideoId]) => marengoVideoId === reference)?.[0]
  if (marengoMatch) return marengoMatch
  const embeddedMarengoMatch = Object.entries(game.marengo_video_ids || {}).find(([, marengoVideoId]) => Boolean(marengoVideoId && reference.includes(marengoVideoId)))?.[0]
  if (embeddedMarengoMatch) return embeddedMarengoMatch

  const basename = reference.split('/').pop() || reference
  if (sourceVideos.includes(basename)) return basename
  const normalizedReference = normalizeSearchText(reference)
  return sourceVideos.find((videoName) => {
    const normalizedVideo = normalizeSearchText(videoName)
    const stem = normalizeSearchText(videoName.replace(/\.[^.]+$/, ''))
    return normalizedReference === normalizedVideo || normalizedReference.includes(normalizedVideo) || normalizedReference.includes(stem) || normalizedVideo.includes(normalizedReference)
  })
}

function gameOptionLabel(game: Game) {
  return game.label === game.sport ? game.label : `${game.label} · ${game.sport}`
}

function searchResultItems(game: Game, response: MarengoSearchResponse): DiscoverItem[] {
  return response.results
    .map((result, index) => discoverItemFromSearchResult(game, result, index))
    .filter((item): item is DiscoverItem => Boolean(item))
}

function discoverItemFromSearchResult(game: Game, result: MarengoSearchResult, index: number): DiscoverItem | null {
  const videoName = result.video_name || videoNameForReference(game, result.video_reference)
  if (!videoName) return null
  const startTime = result.start_time || result.timestamp
  const endTime = result.end_time
  const title = result.title || result.description
  const subtitle = `${videoName}${startTime ? ` · ${startTime}${endTime ? `-${endTime}` : ''}` : ''}`
  const searchMoment: SearchMoment = {
    videoName,
    videoReference: result.video_reference,
    title,
    description: result.description,
    relevance: result.relevance,
    startTime,
    endTime,
  }
  return {
    id: `${game.tag}-${result.id || `search-${index}`}`,
    label: 'Marengo Match',
    title,
    subtitle,
    media: streamInfoForVideoName(game, videoName),
    poster: result.thumbnail_url || thumbnailForVideoName(game, videoName),
    videoName,
    knowledgeStoreId: game.knowledge_store_id,
    clipCount: 1,
    semanticCount: 1,
    matches: [{
      id: `${result.id || index}-match`,
      label: result.rank ? `Marengo Rank ${result.rank}` : 'Visual/Audio Match',
      text: result.description,
      detail: result.relevance,
      startTime,
      endTime,
    }],
    matchHeading: 'Matched Evidence',
    searchScore: responseScore(result, index),
    hasMarengoSearch: true,
    resultType: 'search',
    startTime,
    endTime,
    searchMoment,
  }
}

function responseScore(result: MarengoSearchResult, index: number) {
  return typeof result.confidence === 'number' && Number.isFinite(result.confidence)
    ? result.confidence
    : 1 / (index + 1)
}

function sourceVideoItems(game: Game, sourceVideos: string[]): DiscoverItem[] {
  return Array.from(new Set(sourceVideos)).map((videoName, index) => ({
    id: `${game.tag}-${videoName}-${index}`,
    label: 'Source Video',
    title: videoName,
    subtitle: '',
    media: streamInfoForVideoName(game, videoName),
    poster: thumbnailForVideoName(game, videoName),
    videoName,
    knowledgeStoreId: game.knowledge_store_id,
    clipCount: 0,
    semanticCount: 0,
    matches: [],
    matchHeading: 'Matched Evidence',
    searchScore: 0,
    hasMarengoSearch: false,
    resultType: 'video',
  }))
}

function discoverStats(sourceVideos: string[], reelsByVideo: Record<string, HighlightReels | undefined>) {
  const uniqueVideos = uniqueVideoNames(sourceVideos)
  const entries = uniqueVideos.flatMap((videoName) => {
    const reels = reelsByVideo[videoName]
    if (!reels) return []
    return mapLanes.flatMap((lane) => reels[lane.key].clips)
  })
  return {
    videoCount: uniqueVideos.length,
    clipCount: entries.length,
    semanticCount: entries.filter((clip) => clip.source_type !== 'stats').length,
  }
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function shortId(value?: string) {
  if (!value) return ''
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name)
}

function uploadFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

function formatUploadDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  if (hours) return `${hours}hr ${minutes}min ${remainder}sec`
  if (minutes) return `${minutes}min ${remainder}sec`
  return `${remainder}sec`
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

function preconnectManifestOrigin(manifestUrl: string) {
  if (typeof document === 'undefined') return
  try {
    const origin = new URL(manifestUrl).origin
    if (warmedManifestOrigins.has(origin)) return
    warmedManifestOrigins.add(origin)

    const preconnect = document.createElement('link')
    preconnect.rel = 'preconnect'
    preconnect.href = origin
    preconnect.crossOrigin = 'anonymous'
    document.head.appendChild(preconnect)

    const dnsPrefetch = document.createElement('link')
    dnsPrefetch.rel = 'dns-prefetch'
    dnsPrefetch.href = origin
    document.head.appendChild(dnsPrefetch)
  } catch {
    // Playback validation surfaces malformed stream URLs to the user.
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

async function fetchTwelveLabsStreamInfo(url: string, signal?: AbortSignal): Promise<TwelveLabsStreamInfo> {
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError')
  }
  const cached = streamInfoCache.get(url)
  if (cached) return cached

  let request = streamInfoRequests.get(url)
  if (!request) {
    request = fetchJson<TwelveLabsStreamInfo>(url)
      .then((stream) => {
        streamInfoCache.set(url, stream)
        return stream
      })
      .finally(() => {
        streamInfoRequests.delete(url)
      })
    streamInfoRequests.set(url, request)
  }

  const stream = await request
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError')
  }
  return stream
}

export default App
