/// <reference types="vite/client" />

import Hls from 'hls.js'
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logoFull from '../../assets/logo-full.svg?raw'
import logoMark from '../../assets/logo-mark.svg?raw'
import overviewCompareLift from '../../assets/overview-compare-lift.png'
import overviewHeroJockey from '../../assets/overview-hero-jockey.png'

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
type AssemblyModeKey = 'wsc_baseline' | 'twelvelabs_enhanced'
type ViewKey = 'discover' | 'workspace' | 'jockey' | 'overview'
type ReelFormatKey = '9x16' | '16x9' | '1x1' | '4x5'
type HighlightReelRequestOptions = { silent?: boolean }
type EntityTrackingRequestOptions = { silent?: boolean }
type TutorialStep = {
  id: string
  view: ViewKey
  targetId: string
  title: string
  body: string
  actionLabel?: string
}

type WorkspaceAnalysisResponse = {
  video_name?: string
  highlight_reels: HighlightReels
  entity_tracking?: EntityTrackingResponse
}

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
  has_jockey_highlight_metadata?: boolean
  jockey_highlight_generated_at?: string | null
  jockey_highlight_clip_counts?: Partial<Record<MapCategoryKey, number>> | null
  has_jockey_entity_tracking_metadata?: boolean
  jockey_entity_tracking_generated_at?: string | null
  jockey_entity_tracking_entity_count?: number | null
  has_jockey_workspace_metadata?: boolean
  jockey_workspace_updated_at?: string | null
  jockey_workspace_counts?: {
    clip_analysis?: number
    jockey_turn?: number
    total?: number
  } | null
  metadata_generated_at?: string | null
  metadata_source_video_name?: string | null
  metadata_clip_counts?: Partial<Record<MapCategoryKey, number>> | null
}

type IndexVideoResponse = {
  index_id?: string
  index_videos: IndexVideo[]
}

type DiscoverVideo = {
  video_name: string
  thumbnail_url?: string | null
  thumbnail_path?: string | null
  stream_info_path?: string | null
  indexed?: boolean
  in_live_index?: boolean
  playback_ready?: boolean
  discoverable?: boolean
  stale_registration?: boolean
  repair_available?: boolean
  has_local_thumbnail?: boolean
  indexed_asset_id?: string | null
  asset_id?: string | null
  status?: string | null
}

type JockeyWorkspaceSaveResponse = {
  game_tag: string
  video_name: string
  item: {
    id: string
    kind: string
    saved_at: string
  }
  duplicate: boolean
  summary?: {
    counts?: {
      clip_analysis?: number
      jockey_turn?: number
      total?: number
    }
  }
}

type JockeyWorkspaceBatchSaveResponse = {
  saved: Array<{
    video_name: string
    item_id: string
    duplicate: boolean
  }>
}

type JockeyWorkspaceItem = {
  id: string
  kind: 'clip_analysis' | 'jockey_turn' | string
  saved_at?: string | null
  video_name?: string | null
  model?: string | null
  source?: string | null
  title?: string | null
  clip_bounds?: {
    start_time?: string | null
    end_time?: string | null
  } | null
  payload?: {
    analysis?: Partial<SelectedClipAnalysis>
    search_context?: Record<string, unknown>
    prompt?: string | null
    skill_key?: string | null
    show_reel?: boolean
    session_id?: string | null
    narrative_summary?: string | null
    clips?: Array<Partial<JockeyManifestClip>>
  } | null
}

type JockeyWorkspaceMetadataResponse = {
  game_tag: string
  video_name: string
  workspace?: {
    updated_at?: string | null
    saved_items?: JockeyWorkspaceItem[]
  }
  summary?: {
    updated_at?: string | null
    counts?: {
      clip_analysis?: number
      jockey_turn?: number
      total?: number
    }
  }
  storage?: string
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
  searchRank?: number
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
const manifestWarmupRequests = new Map<string, Promise<void>>()
const warmedManifestOrigins = new Set<string>()
const HLS_DEFAULT_BUFFER_SECONDS = 12
const HLS_SEGMENT_BUFFER_PADDING_SECONDS = 2
const HLS_MAX_BUFFER_BYTES = 12 * 1000 * 1000
const HLS_FATAL_RECOVERY_ATTEMPTS = 2
const REEL_PREVIEW_HOVER_DELAY_MS = 260

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

type DiscoverSearchSession = {
  searchQuery: string
  submittedSearchQuery: string
  searchResponse: MarengoSearchResponse | null
  activePreviewId: string | null
  searchError: string
}

type WorkspaceUiSession = {
  selectedSourceVideoName: string | null
  selectedSearchMoment: SearchMoment | null
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
  dashboardVideoName?: string
  query?: string
  sourceAssetId?: string | null
  title: string
  description: string
  relevance: string
  startTime?: string
  endTime?: string
  sourceLabel?: string
}

type SelectedClipAnalysis = {
  provider: string
  model: string
  source: string
  response_id?: string | null
  game_tag: string
  video_name: string
  video_reference: string
  asset_id?: string | null
  start_time: string
  end_time: string
  analyze_window?: {
    start_time: string
    end_time: string
  }
  description: string
  emotional_tone: string
  key_action: string
  participants: Array<{
    name: string
    role: string
    team_or_group: string
    evidence: string
  }>
  moment_types: string[]
  tags: string[]
  score_context: string
  visual_evidence: string[]
  audio_evidence: string[]
  transcript_evidence: string[]
  producer_summary: string
  story_arc: string
  editorial_use: string
  recommended_formats: string[]
  clip_boundary_notes: string
  rights_safety_notes: string
  confidence: number
  _jockey_metadata?: {
    source?: string
    from_user_metadata?: boolean
    saved_at?: string | null
    stored_to_user_metadata?: boolean
    duplicate?: boolean
    workspace_item_id?: string | null
  }
}

type EntityTrackingAppearance = {
  start_time: string
  end_time: string
  action: string
  emotion: string
  context: string
}

type EntityTrack = {
  name: string
  entity_type: string
  team_or_group: string
  role: string
  description: string
  confidence: number
  appearances: EntityTrackingAppearance[]
}

type EntityRelationship = {
  entity: string
  related_entity: string
  timestamp: string
  interaction_type: string
  description: string
}

type EntityTrackingResponse = {
  provider: string
  model: string
  source: string
  response_id?: string | null
  game_tag: string
  video_name?: string | null
  summary: string
  entities: EntityTrack[]
  relationships: EntityRelationship[]
  _jockey_metadata?: {
    source?: string
    from_user_metadata?: boolean
    entity_count?: number
    generated_at?: string | null
  }
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
  confidence: number
  highlight_potential: number
  source_asset_id?: string | null
  thumbnail_url?: string | null
  stream_info_path?: string | null
  video_url?: string | null
}

type JockeyChatRequest = {
  message: string
  session_id?: string
  conversation_history?: JockeyConversationTurn[]
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

type JockeyConversationTurn = {
  prompt: string
  narrative_summary?: string
  clips?: Array<{
    video_reference: string
    start_time: string
    end_time: string
    moment_type: string
    confidence: number
  }>
}

const categories: Array<{ key: CategoryKey; label: string; icon: string }> = [
  { key: 'best_plays', label: 'Best Plays', icon: 'trophy' },
  { key: 'emotional_moments', label: 'Emotional Moments', icon: 'flame' },
  { key: 'fan_experience', label: 'Fan Experience', icon: 'members' },
  { key: 'behind_the_scenes', label: 'Behind the Scenes', icon: 'indexes' },
]

const assemblyModes: Array<{ key: AssemblyModeKey; label: string; detail: string; icon: string }> = [
  { key: 'wsc_baseline', label: 'Stats Baseline', detail: 'Event-feed baseline', icon: 'usage' },
  { key: 'twelvelabs_enhanced', label: 'TwelveLabs Enhanced', detail: 'Stats plus Jockey semantic lift', icon: 'vision' },
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
  {
    key: 'behind_the_scenes',
    label: 'Behind the Scenes reel',
    icon: 'indexes',
    color: '#FFB0CD',
    tint: 'rgba(255,176,205,0.16)',
    prompt: 'Find warmup moments, coach reactions, bench camaraderie, tunnel walks, huddles, and sideline context. Return timestamped clips with story context.',
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
  'goal celebration',
  'fan going wild in the stands',
  'goalkeeper diving save',
  'coach sideline reaction',
  'best play moment full emotion',
]

const navItems: Array<{ key: ViewKey; label: string; icon: string }> = [
  { key: 'discover', label: 'Discover', icon: 'search-v2' },
  { key: 'workspace', label: 'Dashboard', icon: 'dashboard' },
  { key: 'jockey', label: 'Jockey', icon: 'speech' },
  { key: 'overview', label: 'Overview', icon: 'document-list' },
]

const TUTORIAL_DISCOVER_QUERY = 'goal celebration'
const TUTORIAL_JOCKEY_PROMPT = 'Find three best reel moments with player reactions.'
const tutorialSteps: TutorialStep[] = [
  {
    id: 'marengo-search',
    view: 'discover',
    targetId: 'marengo-search',
    title: '1. Search with Marengo',
    body: 'Search across the indexed videos by text. Marengo finds candidate moments.',
    actionLabel: 'Run sample search',
  },
  {
    id: 'analyze-clip',
    view: 'discover',
    targetId: 'analyze-clip',
    title: '2. Analyze Clip with Pegasus 1.5',
    body: 'Open a search result with Analyze Clip. The selected timestamp is sent to Pegasus 1.5 for clip-only understanding.',
    actionLabel: 'Open first result',
  },
  {
    id: 'clip-analysis',
    view: 'workspace',
    targetId: 'selected-clip-analysis',
    title: '3. Selected Clip Analysis',
    body: 'This panel keeps the response grounded to the selected clip - video segment, tone tags, action, score context, participants, evidence, review notes and editorial use suggestions.',
  },
  {
    id: 'source-video',
    view: 'workspace',
    targetId: 'source-video',
    title: '4. Source Video Workspace',
    body: 'The Dashboard source player compares the event-feed baseline against the richer Jockey lift for the active source video.',
  },
  {
    id: 'semantic-lane',
    view: 'workspace',
    targetId: 'semantic-lane',
    title: '5. Semantic Lanes',
    body: 'Jockey curated responses turn the source into semantic lanes like Best Plays, Emotional Moments, Fan Experience, and Behind the Scenes.',
  },
  {
    id: 'entity-tracking',
    view: 'workspace',
    targetId: 'entity-tracking',
    title: '6. Entity Relationships',
    body: 'Jockey extracts grounded entities and timestamped interactions so editors can understand who appears, when, and how they relate.',
  },
  {
    id: 'tag-reels',
    view: 'workspace',
    targetId: 'tag-reels',
    title: '7. Tag Reels',
    body: 'Tag Reels turns the active semantic lane into previewable social cuts, with format choices and download-ready clip ranges.',
  },
  {
    id: 'jockey-chat',
    view: 'jockey',
    targetId: 'jockey-composer',
    title: '8. Ask Jockey',
    body: 'Use chat to search editorially: ask for a reel, a specific play, a player reaction, or a story beat. Send a prompt to complete the loop.',
    actionLabel: 'Insert sample prompt',
  },
]

const MAX_UPLOAD_VIDEO_BYTES = 400 * 1000 * 1000
const MAX_UPLOAD_VIDEO_LABEL = '400 MB'
const uploadSizeLimitMessage = (name?: string) =>
  `${name ? `${name} is too large. ` : ''}Videos must be ${MAX_UPLOAD_VIDEO_LABEL} or less. Remove the oversized video before uploading.`
const uploadRequirementLabels = [
  'Duration 4sec-4hr',
  'Resolution 360p-4k',
  'Ratio 1:1-1:2.4',
  `File size <= ${MAX_UPLOAD_VIDEO_LABEL} per video`,
]
const JOCKEY_CHAT_CACHE_PREFIX = 'sports-jockey:jockey-chat:'
const DISCOVER_SESSION_PREFIX = 'sports-jockey:discover-session:'
const CLIENT_SESSION_KEY = 'sports-jockey:client-session-id-v1'
const WORKSPACE_UI_SESSION_KEY = 'sports-jockey:workspace-ui-session-v1'
const GAMES_CACHE_KEY = 'sports-jockey:games-cache-v1'
const SELECTED_TAG_CACHE_KEY = 'sports-jockey:selected-tag-v1'
const INDEX_VIDEOS_CACHE_PREFIX = 'sports-jockey:index-videos-v1:'
const WORKSPACE_METADATA_CACHE_PREFIX = 'sports-jockey:workspace-metadata-v1:'
const HIGHLIGHT_REELS_CACHE_PREFIX = 'sports-jockey:highlight-reels-v1:'
const ENTITY_TRACKING_CACHE_PREFIX = 'sports-jockey:entity-tracking-v1:'
const DEFAULT_GAME_TAG = 'sports'
const WORKSPACE_METADATA_SAVED_EVENT = 'sports-jockey:workspace-metadata-saved'
const JOCKEY_TUTORIAL_PROMPT_EVENT = 'sports-jockey:tutorial-jockey-prompt'
const TUTORIAL_ANALYZE_CLIP_EVENT = 'sports-jockey:tutorial-analyze-clip'
const DASHBOARD_DATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000

type TimedCacheEntry<T> = {
  savedAt: number
  value: T
}

function clientSessionId() {
  if (typeof window === 'undefined') return 'server-session'
  const existing = window.localStorage.getItem(CLIENT_SESSION_KEY)?.trim()
  if (existing) return existing
  const generated = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  window.localStorage.setItem(CLIENT_SESSION_KEY, generated)
  return generated
}

function emptyDiscoverSearchSession(): DiscoverSearchSession {
  return {
    searchQuery: '',
    submittedSearchQuery: '',
    searchResponse: null,
    activePreviewId: null,
    searchError: '',
  }
}

function loadDiscoverSearchSessions(): Record<string, DiscoverSearchSession> {
  if (typeof window === 'undefined') return {}
  const sessions: Record<string, DiscoverSearchSession> = {}
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (!key || !key.startsWith(DISCOVER_SESSION_PREFIX)) continue
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(key) || '') as DiscoverSearchSession
      if (!parsed || typeof parsed !== 'object') continue
      sessions[key.slice(DISCOVER_SESSION_PREFIX.length)] = {
        ...emptyDiscoverSearchSession(),
        ...parsed,
        searchResponse: parsed.searchResponse && typeof parsed.searchResponse === 'object' ? parsed.searchResponse : null,
      }
    } catch {
      // Ignore invalid persisted discover sessions.
    }
  }
  return sessions
}

function persistDiscoverSearchSession(tag: string, session: DiscoverSearchSession) {
  if (typeof window === 'undefined' || !tag) return
  const key = `${DISCOVER_SESSION_PREFIX}${tag}`
  const hasContent = Boolean(
    session.searchQuery.trim()
    || session.submittedSearchQuery.trim()
    || session.searchResponse
    || session.searchError
    || session.activePreviewId,
  )
  if (!hasContent) {
    window.sessionStorage.removeItem(key)
    return
  }
  window.sessionStorage.setItem(key, JSON.stringify(session))
}

function loadWorkspaceUiSession(): WorkspaceUiSession | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(WORKSPACE_UI_SESSION_KEY) || '') as WorkspaceUiSession
    if (!parsed || typeof parsed !== 'object') return null
    return {
      selectedSourceVideoName: parsed.selectedSourceVideoName || null,
      selectedSearchMoment: parsed.selectedSearchMoment && typeof parsed.selectedSearchMoment === 'object'
        ? parsed.selectedSearchMoment
        : null,
    }
  } catch {
    return null
  }
}

function persistWorkspaceUiSession(session: WorkspaceUiSession) {
  if (typeof window === 'undefined') return
  const hasContent = Boolean(session.selectedSourceVideoName || session.selectedSearchMoment)
  if (!hasContent) {
    window.sessionStorage.removeItem(WORKSPACE_UI_SESSION_KEY)
    return
  }
  window.sessionStorage.setItem(WORKSPACE_UI_SESSION_KEY, JSON.stringify(session))
}

function loadCachedGames(): Game[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GAMES_CACHE_KEY) || '[]') as Game[]
    return Array.isArray(parsed) ? parsed.filter((game) => typeof game?.tag === 'string' && game.tag) : []
  } catch {
    return []
  }
}

function persistGamesCache(games: Game[]) {
  if (typeof window === 'undefined' || !games.length) return
  window.localStorage.setItem(GAMES_CACHE_KEY, JSON.stringify(games))
}

function loadCachedSelectedTag(): string {
  if (typeof window === 'undefined') return DEFAULT_GAME_TAG
  return window.localStorage.getItem(SELECTED_TAG_CACHE_KEY)?.trim() || DEFAULT_GAME_TAG
}

function persistSelectedTagCache(tag: string) {
  if (typeof window === 'undefined' || !tag) return
  window.localStorage.setItem(SELECTED_TAG_CACHE_KEY, tag)
}

function loadCachedIndexVideosByTag(): Record<string, IndexVideo[]> {
  if (typeof window === 'undefined') return {}
  const cached: Record<string, IndexVideo[]> = {}
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key || !key.startsWith(INDEX_VIDEOS_CACHE_PREFIX)) continue
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '[]') as IndexVideo[]
      if (Array.isArray(parsed) && parsed.length) {
        cached[key.slice(INDEX_VIDEOS_CACHE_PREFIX.length)] = parsed
      }
    } catch {
      // Ignore invalid cached index payloads.
    }
  }
  return cached
}

function persistIndexVideosCache(tag: string, videos: IndexVideo[]) {
  if (typeof window === 'undefined' || !tag || !videos.length) return
  window.localStorage.setItem(`${INDEX_VIDEOS_CACHE_PREFIX}${tag}`, JSON.stringify(videos))
}

function loadTimedCacheEntries<T>(prefix: string): Record<string, T> {
  if (typeof window === 'undefined') return {}
  const cached: Record<string, T> = {}
  const now = Date.now()
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key || !key.startsWith(prefix)) continue
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '') as TimedCacheEntry<T>
      if (!parsed || typeof parsed !== 'object' || now - Number(parsed.savedAt || 0) > DASHBOARD_DATA_CACHE_TTL_MS) {
        window.localStorage.removeItem(key)
        continue
      }
      cached[key.slice(prefix.length)] = parsed.value
    } catch {
      window.localStorage.removeItem(key)
    }
  }
  return cached
}

function persistTimedCacheEntry<T>(prefix: string, key: string, value: T) {
  if (typeof window === 'undefined' || !key || !value) return
  const entry: TimedCacheEntry<T> = { savedAt: Date.now(), value }
  window.localStorage.setItem(`${prefix}${key}`, JSON.stringify(entry))
}

function removeTimedCacheEntry(prefix: string, key: string) {
  if (typeof window === 'undefined' || !key) return
  window.localStorage.removeItem(`${prefix}${key}`)
}

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

function viewFromPath(pathname: string): ViewKey {
  if (pathname.includes('discover')) return 'discover'
  if (pathname.includes('dashboard') || pathname.includes('workspace')) return 'workspace'
  if (pathname.includes('jockey')) return 'jockey'
  if (pathname.includes('overview')) return 'overview'
  return 'discover'
}

function pathForView(view: ViewKey) {
  if (view === 'discover') return '/discover'
  if (view === 'workspace') return '/dashboard'
  if (view === 'jockey') return '/jockey'
  if (view === 'overview') return '/overview'
  return '/discover'
}

function navButtonClass(currentView: ViewKey, itemView: ViewKey) {
  return currentView === itemView
    ? 'border-brand-charcoal bg-brand-charcoal text-white shadow-[0_1px_4px_rgba(29,28,27,0.18)]'
    : 'border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal'
}

function App() {
  const headerRef = useRef<HTMLElement | null>(null)
  const [laneBarNode, setLaneBarNode] = useState<HTMLElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(76)
  const [laneBarHeight, setLaneBarHeight] = useState(0)
  const [games, setGames] = useState<Game[]>(() => loadCachedGames())
  const [selectedTag, setSelectedTag] = useState(() => loadCachedSelectedTag())
  const [view, setView] = useState<ViewKey>(() => viewFromPath(window.location.pathname))
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('best_plays')
  const [selectedEnhancedClipIndex, setSelectedEnhancedClipIndex] = useState(0)
  const [selectedStandardClipIndex, setSelectedStandardClipIndex] = useState(0)
  const [featuredSignalCategory, setFeaturedSignalCategory] = useState<MapCategoryKey>('best_plays')
  const [assemblyMode, setAssemblyMode] = useState<AssemblyModeKey>('twelvelabs_enhanced')
  const [reelsByTag, setReelsByTag] = useState<Record<string, HighlightReels>>(() => loadTimedCacheEntries<HighlightReels>(HIGHLIGHT_REELS_CACHE_PREFIX))
  const [indexVideosByTag, setIndexVideosByTag] = useState<Record<string, IndexVideo[]>>(() => loadCachedIndexVideosByTag())
  const [gamesError, setGamesError] = useState('')
  const [reelsError, setReelsError] = useState('')
  const [indexVideosError, setIndexVideosError] = useState('')
  const [apiBootstrapStatus, setApiBootstrapStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bootstrapRetryToken, setBootstrapRetryToken] = useState(0)
  const [loadingGames, setLoadingGames] = useState(true)
  const [loadingTag, setLoadingTag] = useState('')
  const [loadingIndexVideosTag, setLoadingIndexVideosTag] = useState('')
  const [selectedSourceVideoName, setSelectedSourceVideoName] = useState<string | null>(null)
  const [pendingWorkspaceVideoName, setPendingWorkspaceVideoName] = useState<string | null>(null)
  const [selectedSearchMoment, setSelectedSearchMoment] = useState<SearchMoment | null>(null)
  const [discoverClipAnalysisOpen, setDiscoverClipAnalysisOpen] = useState(false)
  const [clipAnalysesByKey, setClipAnalysesByKey] = useState<Record<string, SelectedClipAnalysis>>({})
  const [clipAnalysisLoadingKey, setClipAnalysisLoadingKey] = useState('')
  const [clipAnalysisError, setClipAnalysisError] = useState('')
  const [entityTrackingByKey, setEntityTrackingByKey] = useState<Record<string, EntityTrackingResponse>>(() => loadTimedCacheEntries<EntityTrackingResponse>(ENTITY_TRACKING_CACHE_PREFIX))
  const [entityTrackingLoadingKey, setEntityTrackingLoadingKey] = useState('')
  const [entityTrackingError, setEntityTrackingError] = useState('')
  const [workspaceMetadataByKey, setWorkspaceMetadataByKey] = useState<Record<string, JockeyWorkspaceMetadataResponse>>(() => loadTimedCacheEntries<JockeyWorkspaceMetadataResponse>(WORKSPACE_METADATA_CACHE_PREFIX))
  const [workspaceMetadataLoadingKey, setWorkspaceMetadataLoadingKey] = useState('')
  const [workspaceMetadataError, setWorkspaceMetadataError] = useState('')
  const [workspaceMetadataRefreshToken, setWorkspaceMetadataRefreshToken] = useState(0)
  const [reelFormat, setReelFormat] = useState<ReelFormatKey>('9x16')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadNotice, setUploadNotice] = useState('')
  const [discoverSessionByTag, setDiscoverSessionByTag] = useState<Record<string, DiscoverSearchSession>>(() => loadDiscoverSearchSessions())
  const [workspaceUiHydrated, setWorkspaceUiHydrated] = useState(false)
  const [tutorialStepIndex, setTutorialStepIndex] = useState<number | null>(null)
  const inFlightReelsRef = useRef<Set<string>>(new Set())
  const inFlightEntityTrackingRef = useRef<Set<string>>(new Set())
  const workspaceMetadataByKeyRef = useRef<Record<string, JockeyWorkspaceMetadataResponse>>({})
  const workspaceMetadataRequestRef = useRef<Record<string, Promise<JockeyWorkspaceMetadataResponse>>>({})
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
  const selectedSourceName = selectedSourceVideoName || ''
  const activeVideoName = useMemo(() => {
    if (selectedSearchMoment?.videoName) {
      return selectedSearchMoment.videoName
    }
    if (workspaceVideoNames.includes(selectedSourceName)) {
      return selectedSourceName
    }
    if (selectedGame?.source_videos?.includes(selectedSourceName)) {
      return selectedSourceName
    }
    return workspaceVideoNames[0] || selectedSourceName
  }, [selectedGame, selectedSearchMoment, selectedSourceName, workspaceVideoNames])
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
  const activeSearchMoment = selectedSearchMoment
  const selectedClipAnalysisKey = selectedTag && activeSearchMoment ? selectedClipAnalysisCacheKey(selectedTag, activeSearchMoment) : ''
  const selectedClipAnalysis = selectedClipAnalysisKey ? clipAnalysesByKey[selectedClipAnalysisKey] : undefined
  const selectedClipAnalysisLoading = Boolean(selectedClipAnalysisKey && clipAnalysisLoadingKey === selectedClipAnalysisKey)
  const selectedClipAnalysisError = selectedClipAnalysisKey ? clipAnalysisError : ''
  const entityTrackingKey = selectedTag && activeVideoName ? `${selectedTag}|${activeVideoName}` : ''
  const entityTracking = entityTrackingKey ? entityTrackingByKey[entityTrackingKey] : undefined
  const entityTrackingLoading = Boolean(entityTrackingKey && entityTrackingLoadingKey === entityTrackingKey)
  const workspaceMetadataKey = selectedTag && activeVideoName ? `${selectedTag}|${activeVideoName}` : ''
  const activeWorkspaceMetadata = workspaceMetadataKey ? workspaceMetadataByKey[workspaceMetadataKey] : undefined
  const workspaceMetadataLoading = Boolean(workspaceMetadataKey && workspaceMetadataLoadingKey === workspaceMetadataKey)
  const activeWorkspaceMetadataError = workspaceMetadataKey ? workspaceMetadataError : ''
  const activeEntityTrackingError = entityTrackingKey ? entityTrackingError : ''
  const featuredEyebrow = featuredSignalCategory === 'standard_stats'
    ? 'Event Feed'
    : categories.find((category) => category.key === selectedCategory)?.label || 'Enhanced'
  const featuredTitle = featuredSignalCategory === 'standard_stats' ? 'Event Feed Baseline' : 'Jockey Discovery Cut'
  const activeIndexVideo = useMemo(() => {
    if (!selectedGame || !activeVideoName) return undefined
    return workspaceIndexVideos.find((video) => indexVideoWorkspaceName(selectedGame, video) === activeVideoName)
  }, [activeVideoName, selectedGame, workspaceIndexVideos])
  const hasCachedHighlightMetadata = Boolean(activeIndexVideo?.has_jockey_highlight_metadata)
  const hasCachedEntityTrackingMetadata = Boolean(activeIndexVideo?.has_jockey_entity_tracking_metadata)
  const hasCachedClipAnalysisMetadata = Boolean((activeIndexVideo?.jockey_workspace_counts?.clip_analysis || 0) > 0)
  const hasHighlightAnalysis = scopedReels ? hasHighlightClips(scopedReels) : false
  const isLoadingReels = Boolean(selectedReelsKey && loadingTag === selectedReelsKey)
  const isLoadingIndexVideos = Boolean(selectedTag && loadingIndexVideosTag === selectedTag)
  const activeDiscoverSession = selectedTag
    ? discoverSessionByTag[selectedTag] || emptyDiscoverSearchSession()
    : emptyDiscoverSearchSession()
  const activeTutorialStep = tutorialStepIndex == null ? null : tutorialSteps[tutorialStepIndex] || null

  const updateDiscoverSession = useCallback((tag: string, patch: Partial<DiscoverSearchSession>) => {
    if (!tag) return
    setDiscoverSessionByTag((current) => {
      const previous = current[tag] || emptyDiscoverSearchSession()
      const next = { ...previous, ...patch }
      persistDiscoverSearchSession(tag, next)
      return { ...current, [tag]: next }
    })
  }, [])

  const clearDiscoverSearch = useCallback((tag: string) => {
    if (!tag) return
    setDiscoverSessionByTag((current) => {
      const next = { ...current, [tag]: emptyDiscoverSearchSession() }
      persistDiscoverSearchSession(tag, emptyDiscoverSearchSession())
      return next
    })
  }, [])

  const handleDiscoverSessionChange = useCallback((patch: Partial<DiscoverSearchSession>) => {
    if (selectedTag) updateDiscoverSession(selectedTag, patch)
  }, [selectedTag, updateDiscoverSession])

  const handleDiscoverClearSearch = useCallback(() => {
    if (selectedTag) clearDiscoverSearch(selectedTag)
    setSelectedSearchMoment(null)
    setDiscoverClipAnalysisOpen(false)
    setClipAnalysisError('')
    setClipAnalysisLoadingKey('')
  }, [clearDiscoverSearch, selectedTag])

  const clearSelectedClipSession = useCallback(() => {
    setSelectedSearchMoment(null)
    setDiscoverClipAnalysisOpen(false)
    setClipAnalysisError('')
    setClipAnalysisLoadingKey('')
  }, [])

  useEffect(() => {
    workspaceMetadataByKeyRef.current = workspaceMetadataByKey
  }, [workspaceMetadataByKey])

  const requestWorkspaceMetadata = useCallback((tag: string, videoName: string, force = false) => {
    const metadataKey = `${tag}|${videoName}`
    if (!force && workspaceMetadataByKeyRef.current[metadataKey]) {
      return Promise.resolve(workspaceMetadataByKeyRef.current[metadataKey])
    }
    if (!force && workspaceMetadataRequestRef.current[metadataKey]) {
      return workspaceMetadataRequestRef.current[metadataKey]
    }

    setWorkspaceMetadataLoadingKey(metadataKey)
    setWorkspaceMetadataError('')
    const indexPayload = indexVideoRequestPayload(selectedGame, workspaceIndexVideos, videoName)
    const params = new URLSearchParams()
    if (indexPayload.indexed_asset_id) params.set('indexed_asset_id', indexPayload.indexed_asset_id)
    if (indexPayload.asset_id) params.set('asset_id', indexPayload.asset_id)
    const query = params.toString()
    const request = fetchJson<JockeyWorkspaceMetadataResponse>(
      `/games/${encodeURIComponent(tag)}/videos/${encodeURIComponent(videoName)}/jockey-workspace${query ? `?${query}` : ''}`,
    )
      .then((body) => {
        setWorkspaceMetadataByKey((current) => ({ ...current, [metadataKey]: body }))
        persistTimedCacheEntry(WORKSPACE_METADATA_CACHE_PREFIX, metadataKey, body)
        return body
      })
      .catch((error: Error) => {
        setWorkspaceMetadataError(error.message)
        throw error
      })
      .finally(() => {
        delete workspaceMetadataRequestRef.current[metadataKey]
        setWorkspaceMetadataLoadingKey((current) => (current === metadataKey ? '' : current))
      })

    workspaceMetadataRequestRef.current[metadataKey] = request
    return request
  }, [selectedGame, workspaceIndexVideos])

  const requestHighlightReels = useCallback((videoName?: string, options: HighlightReelRequestOptions = {}) => {
    if (!selectedTag) return Promise.resolve()
    const cacheKey = reelCacheKey(selectedTag, videoName)
    if (reelsByTag[cacheKey]) return Promise.resolve()
    if (inFlightReelsRef.current.has(cacheKey)) return Promise.resolve()

    inFlightReelsRef.current.add(cacheKey)
    if (!options.silent) {
      setLoadingTag(cacheKey)
      setReelsError('')
    }

    const requestPayload = videoName
      ? indexVideoRequestPayload(selectedGame, workspaceIndexVideos, videoName)
      : {}

    return fetchJson<HighlightReels | WorkspaceAnalysisResponse>(`/games/${encodeURIComponent(selectedTag)}/highlight-reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    })
      .then((body) => {
        const bundled = isWorkspaceAnalysisResponse(body) ? body : null
        const highlightReels = bundled?.highlight_reels || (body as HighlightReels)
        setReelsByTag((current) => ({ ...current, [cacheKey]: highlightReels }))
        persistTimedCacheEntry(HIGHLIGHT_REELS_CACHE_PREFIX, cacheKey, highlightReels)

        const entityKey = videoName ? `${selectedTag}|${videoName}` : ''
        if (bundled?.entity_tracking && entityKey) {
          setEntityTrackingByKey((current) => ({ ...current, [entityKey]: bundled.entity_tracking! }))
          persistTimedCacheEntry(ENTITY_TRACKING_CACHE_PREFIX, entityKey, bundled.entity_tracking)
        }

        if (!videoName || !selectedGame) return

        const highlightProvenance = highlightReels._pegasus_metadata
        if (
          highlightProvenance
          && (highlightProvenance.from_user_metadata || highlightProvenance.source === 'generated_and_stored_to_user_metadata')
        ) {
          setIndexVideosByTag((current) => {
            const videos = current[selectedTag]
            if (!videos) return current
            return {
              ...current,
              [selectedTag]: videos.map((video) => {
                if (indexVideoWorkspaceName(selectedGame, video) !== videoName) return video
                return {
                  ...video,
                  has_jockey_highlight_metadata: true,
                  jockey_highlight_generated_at: highlightProvenance.generated_at || video.jockey_highlight_generated_at || null,
                  jockey_highlight_clip_counts: highlightProvenance.clip_counts || video.jockey_highlight_clip_counts || null,
                }
              }),
            }
          })
        }

        const entityProvenance = bundled?.entity_tracking?._jockey_metadata
        if (
          entityProvenance
          && (entityProvenance.from_user_metadata || entityProvenance.source === 'generated_and_stored_to_user_metadata')
        ) {
          setIndexVideosByTag((current) => {
            const videos = current[selectedTag]
            if (!videos) return current
            return {
              ...current,
              [selectedTag]: videos.map((video) => {
                if (indexVideoWorkspaceName(selectedGame, video) !== videoName) return video
                return {
                  ...video,
                  has_jockey_entity_tracking_metadata: true,
                  jockey_entity_tracking_generated_at: entityProvenance.generated_at || video.jockey_entity_tracking_generated_at || null,
                  jockey_entity_tracking_entity_count: entityProvenance.entity_count ?? video.jockey_entity_tracking_entity_count ?? null,
                }
              }),
            }
          })
        }
      })
      .catch((error: Error) => {
        if (!options.silent) setReelsError(error.message)
      })
      .finally(() => {
        inFlightReelsRef.current.delete(cacheKey)
        if (!options.silent) {
          setLoadingTag((current) => (current === cacheKey ? '' : current))
        }
      })
  }, [reelsByTag, selectedGame, selectedTag, workspaceIndexVideos])

  const requestEntityTracking = useCallback((videoName: string, options: EntityTrackingRequestOptions = {}) => {
    if (!selectedTag || !videoName) return Promise.resolve()
    const entityKey = `${selectedTag}|${videoName}`
    if (entityTrackingByKey[entityKey]) return Promise.resolve()
    if (inFlightEntityTrackingRef.current.has(entityKey)) return Promise.resolve()

    inFlightEntityTrackingRef.current.add(entityKey)
    if (!options.silent) {
      setEntityTrackingLoadingKey(entityKey)
      setEntityTrackingError('')
    }

    const requestPayload = indexVideoRequestPayload(selectedGame, workspaceIndexVideos, videoName)
    return fetchJson<EntityTrackingResponse>(`/games/${encodeURIComponent(selectedTag)}/entity-tracking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    })
      .then((body) => {
        setEntityTrackingByKey((current) => ({ ...current, [entityKey]: body }))
        persistTimedCacheEntry(ENTITY_TRACKING_CACHE_PREFIX, entityKey, body)

        const entityProvenance = body._jockey_metadata
        if (
          selectedGame
          && entityProvenance
          && (entityProvenance.from_user_metadata || entityProvenance.source === 'generated_and_stored_to_user_metadata')
        ) {
          setIndexVideosByTag((current) => {
            const videos = current[selectedTag]
            if (!videos) return current
            return {
              ...current,
              [selectedTag]: videos.map((video) => {
                if (indexVideoWorkspaceName(selectedGame, video) !== videoName) return video
                return {
                  ...video,
                  has_jockey_entity_tracking_metadata: true,
                  jockey_entity_tracking_generated_at: entityProvenance.generated_at || video.jockey_entity_tracking_generated_at || null,
                  jockey_entity_tracking_entity_count: entityProvenance.entity_count ?? video.jockey_entity_tracking_entity_count ?? null,
                }
              }),
            }
          })
        }
      })
      .catch((error: Error) => {
        if (!options.silent) setEntityTrackingError(error.message)
      })
      .finally(() => {
        inFlightEntityTrackingRef.current.delete(entityKey)
        if (!options.silent) {
          setEntityTrackingLoadingKey((current) => (current === entityKey ? '' : current))
        }
      })
  }, [entityTrackingByKey, selectedGame, selectedTag, workspaceIndexVideos])

  useEffect(() => {
    if (!selectedGame || !activeVideoName) return
    void prefetchTwelveLabsStream(streamInfoForVideoName(selectedGame, activeVideoName))
  }, [activeVideoName, selectedGame])

  useEffect(() => {
    if (!selectedTag || !activeVideoName) {
      setWorkspaceMetadataLoadingKey('')
      setWorkspaceMetadataError('')
      return
    }
    void requestWorkspaceMetadata(selectedTag, activeVideoName, workspaceMetadataRefreshToken > 0).catch(() => undefined)
  }, [activeVideoName, requestWorkspaceMetadata, selectedTag, workspaceMetadataRefreshToken])

  useEffect(() => {
    const handleSavedMetadata = (event: Event) => {
      const detail = (event as CustomEvent<{ tag?: string; videoNames?: string[] }>).detail
      if (!detail?.tag || detail.tag !== selectedTag || !activeVideoName) return
      if (detail.videoNames?.length && !detail.videoNames.includes(activeVideoName)) return
      removeTimedCacheEntry(WORKSPACE_METADATA_CACHE_PREFIX, `${selectedTag}|${activeVideoName}`)
      setWorkspaceMetadataRefreshToken((value) => value + 1)
    }
    window.addEventListener(WORKSPACE_METADATA_SAVED_EVENT, handleSavedMetadata)
    return () => window.removeEventListener(WORKSPACE_METADATA_SAVED_EVENT, handleSavedMetadata)
  }, [activeVideoName, selectedTag])

  useEffect(() => {
    if (workspaceUiHydrated) return
    const saved = loadWorkspaceUiSession()
    if (saved?.selectedSourceVideoName) setSelectedSourceVideoName(saved.selectedSourceVideoName)
    if (saved?.selectedSearchMoment) setSelectedSearchMoment(saved.selectedSearchMoment)
    setWorkspaceUiHydrated(true)
  }, [workspaceUiHydrated])

  useEffect(() => {
    if (!workspaceUiHydrated) return
    persistWorkspaceUiSession({
      selectedSourceVideoName,
      selectedSearchMoment,
    })
  }, [selectedSearchMoment, selectedSourceVideoName, workspaceUiHydrated])

  useEffect(() => {
    let active = true
    setApiBootstrapStatus('loading')
    setGamesError('')
    setLoadingGames(true)

    const bootstrapApi = async () => {
      try {
        const health = await fetchJson<{ status?: string }>('/health')
        if (health.status !== 'ok') {
          throw new Error('API health check failed')
        }
        const body = await fetchJson<{ games: Game[] }>('/games')
        if (!active) return
        setGames(body.games)
        persistGamesCache(body.games)
        setSelectedTag((current) => {
          const nextTag = current || body.games[0]?.tag || DEFAULT_GAME_TAG
          persistSelectedTagCache(nextTag)
          return nextTag
        })
        setApiBootstrapStatus('ready')
      } catch (error: unknown) {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Unable to reach the Sports Jockey API'
        setGamesError(message)
        setApiBootstrapStatus('error')
      } finally {
        if (active) setLoadingGames(false)
      }
    }

    void bootstrapApi()
    return () => {
      active = false
    }
  }, [bootstrapRetryToken])

  useEffect(() => {
    if (!selectedTag) return
    let active = true
    const hasCachedVideos = Boolean(indexVideosByTag[selectedTag]?.length)
    if (!hasCachedVideos) {
      setLoadingIndexVideosTag(selectedTag)
      setIndexVideosError('')
    }
    fetchJson<IndexVideoResponse>(`/games/${encodeURIComponent(selectedTag)}/index-videos`)
      .then((body) => {
        if (!active) return
        const videos = uniqueIndexVideos(body.index_videos || [])
        setIndexVideosByTag((current) => ({
          ...current,
          [selectedTag]: videos,
        }))
        persistIndexVideosCache(selectedTag, videos)
      })
      .catch((error: Error) => {
        if (active && !hasCachedVideos) setIndexVideosError(error.message)
      })
      .finally(() => {
        if (active) setLoadingIndexVideosTag((current) => (current === selectedTag ? '' : current))
      })
    return () => {
      active = false
    }
  }, [selectedTag])

  useEffect(() => {
    if (view !== 'workspace' || !activeVideoName || activeSearchMoment) return
    void requestHighlightReels(activeVideoName)
  }, [activeSearchMoment, activeVideoName, requestHighlightReels, view])

  useEffect(() => {
    if (view !== 'workspace' || !activeVideoName || activeSearchMoment) return
    if (!selectedReelsKey || !reelsByTag[selectedReelsKey]) return
    void requestEntityTracking(activeVideoName)
  }, [activeSearchMoment, activeVideoName, reelsByTag, requestEntityTracking, selectedReelsKey, view])

  useEffect(() => {
    if (!selectedReelsKey) return
    if (reelsByTag[selectedReelsKey]) {
      setLoadingTag((current) => (current === selectedReelsKey ? '' : current))
    }
  }, [reelsByTag, selectedReelsKey])

  useEffect(() => {
    if (view !== 'workspace' || !activeVideoName || activeSearchMoment || isLoadingReels) return
    if (!selectedReelsKey || reelsByTag[selectedReelsKey] || reelsError) return
    const retryTimer = window.setTimeout(() => {
      if (!inFlightReelsRef.current.has(selectedReelsKey)) {
        void requestHighlightReels(activeVideoName)
      }
    }, 1500)
    return () => window.clearTimeout(retryTimer)
  }, [
    activeSearchMoment,
    activeVideoName,
    isLoadingReels,
    reelsByTag,
    reelsError,
    requestHighlightReels,
    selectedReelsKey,
    view,
  ])

  useEffect(() => {
    if (view !== 'workspace' && !discoverClipAnalysisOpen) return
    if (!selectedTag || !activeSearchMoment?.startTime || !selectedClipAnalysisKey) return
    if (clipAnalysesByKey[selectedClipAnalysisKey]) {
      setClipAnalysisError('')
      return
    }
    let active = true
    setClipAnalysisLoadingKey(selectedClipAnalysisKey)
    setClipAnalysisError('')
    const runSelectedClipAnalysis = async () => {
      try {
        await requestWorkspaceMetadata(selectedTag, activeSearchMoment.videoName).catch(() => undefined)
        if (!active) return
        const body = await fetchJson<SelectedClipAnalysis>(`/games/${encodeURIComponent(selectedTag)}/clip-analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_name: activeSearchMoment.videoName,
            video_reference: activeSearchMoment.videoReference,
            start_time: activeSearchMoment.startTime,
            end_time: activeSearchMoment.endTime,
            asset_id: activeSearchMoment.sourceAssetId,
            query: activeSearchMoment.query,
            description: activeSearchMoment.description,
            relevance: activeSearchMoment.relevance,
          }),
        })
        if (!active) return
        setClipAnalysesByKey((current) => ({ ...current, [selectedClipAnalysisKey]: body }))
        const provenance = body._jockey_metadata
        if (
          provenance
          && selectedGame
          && activeSearchMoment
          && (provenance.from_user_metadata || provenance.stored_to_user_metadata)
        ) {
          setIndexVideosByTag((current) => {
            const videos = current[selectedTag]
            if (!videos) return current
            return {
              ...current,
              [selectedTag]: videos.map((video) => {
                if (indexVideoWorkspaceName(selectedGame, video) !== activeSearchMoment.videoName) return video
                const clipCount = Math.max(video.jockey_workspace_counts?.clip_analysis || 0, 1)
                return {
                  ...video,
                  has_jockey_workspace_metadata: true,
                  jockey_workspace_updated_at: provenance.saved_at || video.jockey_workspace_updated_at || null,
                  jockey_workspace_counts: {
                    ...video.jockey_workspace_counts,
                    clip_analysis: clipCount,
                    total: Math.max(video.jockey_workspace_counts?.total || 0, clipCount),
                  },
                }
              }),
            }
          })
          void requestWorkspaceMetadata(selectedTag, activeSearchMoment.videoName, true).catch(() => undefined)
        }
      } catch (error) {
        if (active) setClipAnalysisError(error instanceof Error ? error.message : 'Selected clip analysis failed')
      } finally {
        if (active) {
          setClipAnalysisLoadingKey((current) => (current === selectedClipAnalysisKey ? '' : current))
        }
      }
    }
    void runSelectedClipAnalysis()
    return () => {
      active = false
    }
  }, [
    activeSearchMoment?.description,
    activeSearchMoment?.endTime,
    activeSearchMoment?.query,
    activeSearchMoment?.relevance,
    activeSearchMoment?.sourceAssetId,
    activeSearchMoment?.startTime,
    activeSearchMoment?.videoName,
    activeSearchMoment?.videoReference,
    clipAnalysesByKey,
    discoverClipAnalysisOpen,
    requestWorkspaceMetadata,
    selectedClipAnalysisKey,
    selectedTag,
    view,
  ])

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
      return
    }
    setSelectedCategory(categoryKey)
    setSelectedEnhancedClipIndex(index)
    setFeaturedSignalCategory(categoryKey)
    if (assemblyMode === 'wsc_baseline') setAssemblyMode('twelvelabs_enhanced')
  }
  const selectCategoryTab = (categoryKey: CategoryKey) => {
    setSelectedSearchMoment(null)
    setSelectedCategory(categoryKey)
    setSelectedEnhancedClipIndex(0)
    setFeaturedSignalCategory(categoryKey)
  }
  const selectWorkspaceLane = (categoryKey: CategoryKey) => {
    selectCategoryTab(categoryKey)
    if (assemblyMode === 'wsc_baseline') setAssemblyMode('twelvelabs_enhanced')
  }
  const navigate = (nextView: ViewKey) => {
    setView(nextView)
    window.history.pushState({}, '', pathForView(nextView))
  }
  const goToDiscoverHome = useCallback(() => {
    if (selectedTag) clearDiscoverSearch(selectedTag)
    navigate('discover')
  }, [clearDiscoverSearch, selectedTag])
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
  const scrollSelectedClipAnalysisIntoView = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById('selected-clip-analysis') as HTMLElement | null
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          target.focus({ preventScroll: true })
          return
        }
        document.getElementById('workspace-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
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
  const analyzeClipInDiscover = (item: DiscoverItem) => {
    if (!item.searchMoment) return
    const resolvedVideoName = selectedGame
      ? resolveWorkspaceVideoName(selectedGame, workspaceVideoNames, item.videoName, item.searchMoment)
      : null
    const videoName = resolvedVideoName || item.videoName
    setSelectedSourceVideoName(videoName)
    setSelectedSearchMoment({
      ...item.searchMoment,
      videoName,
      dashboardVideoName: videoName,
    })
    setDiscoverClipAnalysisOpen(true)
  }
  const openVideoInWorkspace = (videoName: string, target?: DiscoverItem['openTarget'], searchMoment?: SearchMoment) => {
    setDiscoverClipAnalysisOpen(false)
    const resolvedVideoName = selectedGame
      ? resolveWorkspaceVideoName(selectedGame, workspaceVideoNames, videoName, searchMoment)
      : null
    const dashboardVideoName = resolvedVideoName || (searchMoment ? videoName : workspaceVideoNames[0])
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
    const canUseRequestedVideo = Boolean(searchMoment) || dashboardVideoName === videoName
    const shouldAnalyzeSelectedClip = canUseRequestedVideo && Boolean(searchMoment)
    const selectedMoment = searchMoment
      ? {
          ...searchMoment,
          videoName: dashboardVideoName,
        }
      : null
    setSelectedSourceVideoName(dashboardVideoName)
    setSelectedSearchMoment(canUseRequestedVideo ? selectedMoment : null)
    if (shouldAnalyzeSelectedClip) setAssemblyMode('twelvelabs_enhanced')
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
      setFeaturedSignalCategory('best_plays')
      setPendingWorkspaceVideoName(shouldAnalyzeSelectedClip ? null : canUseRequestedVideo ? dashboardVideoName : null)
    }
    navigate('workspace')
    if (shouldAnalyzeSelectedClip) {
      scrollSelectedClipAnalysisIntoView()
    } else {
      scrollWorkspaceDetailsIntoView()
    }
  }

  const runTutorialMarengoSearch = () => {
    navigate('discover')
    if (!selectedTag) return
    updateDiscoverSession(selectedTag, {
      searchQuery: TUTORIAL_DISCOVER_QUERY,
      submittedSearchQuery: TUTORIAL_DISCOVER_QUERY,
      searchResponse: null,
      searchError: '',
      activePreviewId: null,
    })
  }

  const openFirstTutorialSearchResult = () => {
    const item = selectedGame && activeDiscoverSession.searchResponse
      ? searchResultItems(selectedGame, activeDiscoverSession.searchResponse).find((result) => result.resultType === 'search' && result.videoName)
      : null
    if (item) {
      analyzeClipInDiscover(item)
      setTutorialStepIndex(2)
      return
    }
    runTutorialMarengoSearch()
  }

  const insertTutorialJockeyPrompt = () => {
    navigate('jockey')
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(JOCKEY_TUTORIAL_PROMPT_EVENT, {
        detail: { prompt: TUTORIAL_JOCKEY_PROMPT },
      }))
    }, 120)
  }

  const handleTutorialAction = (step: TutorialStep) => {
    if (step.id === 'marengo-search') {
      runTutorialMarengoSearch()
      return
    }
    if (step.id === 'analyze-clip') {
      openFirstTutorialSearchResult()
      return
    }
    if (step.id === 'jockey-chat') {
      insertTutorialJockeyPrompt()
    }
  }

  const startTutorial = () => {
    setTutorialStepIndex(0)
    navigate('discover')
  }

  const closeTutorial = () => {
    setTutorialStepIndex(null)
  }

  const goToNextTutorialStep = () => {
    if (tutorialStepIndex == null) return
    const step = tutorialSteps[tutorialStepIndex]
    if (step.id === 'marengo-search' && activeDiscoverSession.submittedSearchQuery !== TUTORIAL_DISCOVER_QUERY) {
      runTutorialMarengoSearch()
    }
    if (step.id === 'analyze-clip') {
      openFirstTutorialSearchResult()
      return
    }
    if (tutorialStepIndex >= tutorialSteps.length - 1) {
      closeTutorial()
      return
    }
    setTutorialStepIndex(tutorialStepIndex + 1)
  }

  useEffect(() => {
    if (!activeTutorialStep) return
    if (activeTutorialStep.view !== view) {
      navigate(activeTutorialStep.view)
    }
    if (activeTutorialStep.id === 'analyze-clip' && !activeDiscoverSession.submittedSearchQuery) {
      runTutorialMarengoSearch()
    }
    if (['source-video', 'semantic-lane', 'entity-tracking', 'tag-reels'].includes(activeTutorialStep.id)) {
      clearSelectedClipSession()
      if (assemblyMode === 'wsc_baseline') setAssemblyMode('twelvelabs_enhanced')
    }
    if (activeTutorialStep.id === 'jockey-chat') {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(JOCKEY_TUTORIAL_PROMPT_EVENT, {
          detail: { focusOnly: true },
        }))
      }, 180)
    }
  }, [activeTutorialStep?.id])

  useEffect(() => {
    const handleAnalyzeClip = () => {
      if (tutorialStepIndex == null || tutorialSteps[tutorialStepIndex]?.id !== 'analyze-clip') return
      setTutorialStepIndex(2)
    }
    window.addEventListener(TUTORIAL_ANALYZE_CLIP_EVENT, handleAnalyzeClip)
    return () => window.removeEventListener(TUTORIAL_ANALYZE_CLIP_EVENT, handleAnalyzeClip)
  }, [tutorialStepIndex])

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

  useEffect(() => {
    if (view !== 'workspace' || !selectedClipAnalysisKey) return
    scrollSelectedClipAnalysisIntoView()
  }, [selectedClipAnalysisKey, view])

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

  if (apiBootstrapStatus !== 'ready') {
    return (
      <AppStartupScreen
        status={apiBootstrapStatus}
        error={gamesError}
        onRetry={() => setBootstrapRetryToken((value) => value + 1)}
      />
    )
  }

  return (
    <main className="min-h-screen bg-background text-text-primary" style={stickyOffsetStyle}>
      <div className="flex min-h-screen flex-col">
        <header
          ref={headerRef}
          className="app-header sticky top-0 z-50 border-b border-border bg-surface shadow-[0_1px_0_rgba(29,28,27,0.04)]"
        >
          <div className="app-header-inner mx-auto w-full max-w-[1440px]">
            <div className="app-header-brand">
              <button
                type="button"
                onClick={goToDiscoverHome}
                className="app-header-logo logo-svg inline-flex shrink-0 items-center justify-center text-brand-charcoal transition-opacity hover:opacity-80"
                aria-label="Back to Discover"
                title="Back to Discover"
                dangerouslySetInnerHTML={{ __html: logoFull }}
              />
              <div className="app-header-divider bg-border" aria-hidden="true" />
              <h1 className="app-header-title text-text-primary">Sports Jockey Intelligence</h1>
            </div>

            <nav className="app-header-nav" aria-label="Main navigation">
              <div className="app-header-nav-tabs">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate(item.key)}
                    aria-current={view === item.key ? 'page' : undefined}
                    className={['app-header-nav-tab', navButtonClass(view, item.key)].join(' ')}
                  >
                    <StrandIcon name={item.icon} className="app-header-nav-icon shrink-0" />
                    <span className="app-header-nav-label">{item.label}</span>
                  </button>
                ))}
              </div>

              <div className="app-header-actions">
                <button
                  type="button"
                  onClick={startTutorial}
                  className="app-header-action app-header-action--tutorial border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
                  aria-label="Start guided tutorial"
                  title="Start guided tutorial"
                >
                  <StrandIcon name="help" className="h-4 w-4 shrink-0" />
                  <span className="app-header-action-label">Tutorial</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(true)}
                  disabled={!selectedGame || loadingGames}
                  className={[
                    'app-header-action',
                    selectedGame && !loadingGames
                      ? 'border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal'
                      : 'cursor-not-allowed border-border bg-card text-text-tertiary',
                  ].join(' ')}
                  aria-haspopup="dialog"
                  aria-label="Add video"
                  title="Add Video"
                >
                  <StrandIcon name="plus" className="h-4 w-4 shrink-0" />
                  <span className="app-header-action-label">Add Video</span>
                </button>
              </div>
            </nav>
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
          indexVideos={workspaceIndexVideos}
          loading={loadingGames && games.length === 0}
          indexLoading={isLoadingIndexVideos && workspaceIndexVideos.length === 0}
          error={gamesError}
          session={activeDiscoverSession}
          onSessionChange={handleDiscoverSessionChange}
          onClearSearch={handleDiscoverClearSearch}
          onOpenInWorkspace={openSourceInWorkspace}
          onAnalyzeClip={analyzeClipInDiscover}
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
            hasCachedHighlightMetadata={hasCachedHighlightMetadata}
            hasCachedEntityTrackingMetadata={hasCachedEntityTrackingMetadata}
            hasCachedClipAnalysisMetadata={hasCachedClipAnalysisMetadata}
            reels={scopedReels}
            hasHighlightAnalysis={hasHighlightAnalysis}
            activeVideoName={activeVideoName}
            selectedCategory={selectedCategory}
            selectedEnhancedClipIndex={selectedEnhancedClipIndex}
            selectedStandardClipIndex={selectedStandardClipIndex}
            selectedSearchMoment={selectedSearchMoment}
            selectedClipAnalysis={selectedClipAnalysis}
            selectedClipAnalysisLoading={selectedClipAnalysisLoading}
            selectedClipAnalysisError={selectedClipAnalysisError}
            entityTracking={entityTracking}
            entityTrackingLoading={entityTrackingLoading}
            entityTrackingError={activeEntityTrackingError}
            workspaceMetadata={activeWorkspaceMetadata}
            workspaceMetadataLoading={workspaceMetadataLoading}
            workspaceMetadataError={activeWorkspaceMetadataError}
            assemblyMode={assemblyMode}
            reelFormat={reelFormat}
            onOpenDiscover={() => navigate('discover')}
            onClearSelectedClip={clearSelectedClipSession}
            onSourceVideoSelect={openVideoInWorkspace}
            onAssemblyModeChange={setAssemblyMode}
            onReelFormatChange={setReelFormat}
            onSelectSignal={selectSignal}
            onSelectEnhancedCategoryClip={(categoryKey, index) => {
              setSelectedSearchMoment(null)
              setSelectedCategory(categoryKey)
              setSelectedEnhancedClipIndex(index)
              setFeaturedSignalCategory(categoryKey)
              if (assemblyMode === 'wsc_baseline') setAssemblyMode('twelvelabs_enhanced')
            }}
            onSelectStandardClip={(index) => {
              setSelectedSearchMoment(null)
              setSelectedStandardClipIndex(index)
              setFeaturedSignalCategory('standard_stats')
            }}
            onSelectEnhancedClip={(index) => {
              setSelectedSearchMoment(null)
              setSelectedEnhancedClipIndex(index)
              setFeaturedSignalCategory(selectedCategory)
            }}
          />
        )}

        {view === 'discover' && discoverClipAnalysisOpen && selectedGame && selectedSearchMoment && (
          <DiscoverClipAnalysisModal
            game={selectedGame}
            searchMoment={selectedSearchMoment}
            analysis={selectedClipAnalysis}
            loading={selectedClipAnalysisLoading}
            error={selectedClipAnalysisError}
            hasCachedMetadata={hasCachedClipAnalysisMetadata}
            workspaceMetadata={activeWorkspaceMetadata}
            workspaceMetadataLoading={workspaceMetadataLoading}
            workspaceMetadataError={activeWorkspaceMetadataError}
            onClose={clearSelectedClipSession}
            onOpenDashboard={() => openVideoInWorkspace(selectedSearchMoment.dashboardVideoName || selectedSearchMoment.videoName)}
          />
        )}
        {activeTutorialStep && tutorialStepIndex != null && (
          <GuidedTutorialOverlay
            step={activeTutorialStep}
            stepIndex={tutorialStepIndex}
            totalSteps={tutorialSteps.length}
            onAction={handleTutorialAction}
            onNext={goToNextTutorialStep}
            onClose={closeTutorial}
          />
        )}
      </div>
    </main>
  )
}

function GuidedTutorialOverlay({
  step,
  stepIndex,
  totalSteps,
  onAction,
  onNext,
  onClose,
}: {
  step: TutorialStep
  stepIndex: number
  totalSteps: number
  onAction: (step: TutorialStep) => void
  onNext: () => void
  onClose: () => void
}) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [panelHeight, setPanelHeight] = useState(240)
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let disposed = false
    let timeoutId: number | null = null
    let activeTarget: HTMLElement | null = null
    let originalStyle: Partial<Record<'outline' | 'outlineOffset' | 'boxShadow' | 'position' | 'zIndex' | 'scrollMarginTop' | 'transition', string>> = {}

    const clearTargetStyle = () => {
      if (!activeTarget) return
      activeTarget.style.outline = originalStyle.outline || ''
      activeTarget.style.outlineOffset = originalStyle.outlineOffset || ''
      activeTarget.style.boxShadow = originalStyle.boxShadow || ''
      activeTarget.style.position = originalStyle.position || ''
      activeTarget.style.zIndex = originalStyle.zIndex || ''
      activeTarget.style.scrollMarginTop = originalStyle.scrollMarginTop || ''
      activeTarget.style.transition = originalStyle.transition || ''
      activeTarget = null
      originalStyle = {}
    }

    const attachTargetStyle = (target: HTMLElement) => {
      if (activeTarget === target) return
      clearTargetStyle()
      activeTarget = target
      originalStyle = {
        outline: target.style.outline,
        outlineOffset: target.style.outlineOffset,
        boxShadow: target.style.boxShadow,
        position: target.style.position,
        zIndex: target.style.zIndex,
        scrollMarginTop: target.style.scrollMarginTop,
        transition: target.style.transition,
      }
      if (window.getComputedStyle(target).position === 'static') {
        target.style.position = 'relative'
      }
      target.style.zIndex = '45'
      target.style.outline = '2px solid #00DC82'
      target.style.outlineOffset = '6px'
      target.style.boxShadow = '0 0 0 6px rgba(0,220,130,0.12), 0 18px 36px rgba(29,28,27,0.16)'
      target.style.scrollMarginTop = 'calc(var(--sj-header-height) + var(--sj-lane-height) + 24px)'
      target.style.transition = 'outline-color 160ms ease, box-shadow 180ms ease'
    }

    const updateTarget = (scrollTarget = false) => {
      const target = document.querySelector(`[data-tour-id="${step.targetId}"]`) as HTMLElement | null
      if (!target) {
        clearTargetStyle()
        setTargetRect(null)
        return
      }
      attachTargetStyle(target)
      if (scrollTarget) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }
      window.requestAnimationFrame(() => {
        if (!disposed) setTargetRect(target.getBoundingClientRect())
      })
    }
    const measureTarget = () => updateTarget(false)

    timeoutId = window.setTimeout(() => updateTarget(true), 180)
    window.addEventListener('resize', measureTarget)
    window.addEventListener('scroll', measureTarget, true)
    return () => {
      disposed = true
      if (timeoutId) window.clearTimeout(timeoutId)
      window.removeEventListener('resize', measureTarget)
      window.removeEventListener('scroll', measureTarget, true)
      clearTargetStyle()
    }
  }, [step.id, step.targetId])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    let frameId: number | null = null
    const measurePanel = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const nextHeight = Math.ceil(panel.getBoundingClientRect().height)
        if (nextHeight > 0) {
          setPanelHeight(nextHeight)
        }
      })
    }

    measurePanel()
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measurePanel) : null
    resizeObserver?.observe(panel)
    window.addEventListener('resize', measurePanel)
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measurePanel)
    }
  }, [step.id])

  const nextLabel = stepIndex >= totalSteps - 1 ? 'Finish' : step.id === 'analyze-clip' ? 'Open and Continue' : 'Next'
  const panelStyle = tutorialPanelStyle(targetRect, panelHeight)

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[35] bg-brand-charcoal/10" />
      <section
        ref={panelRef}
        data-tour-panel="true"
        className="fixed z-[140] max-h-[calc(100vh-32px)] overflow-y-auto rounded-md border border-border bg-surface p-4 shadow-[0_18px_48px_rgba(29,28,27,0.22)] transition-[left,top,transform] duration-300 ease-out"
        style={panelStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
              Tutorial · Step {stepIndex + 1} of {totalSteps}
            </p>
            <h2 className="mt-1 text-base font-semibold text-text-primary">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-light bg-card text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            aria-label="Close tutorial"
            title="Close tutorial"
          >
            <StrandIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-text-secondary">{step.body}</p>
        {!targetRect && (
          <p className="mt-2 rounded-sm border border-border-light bg-card px-2.5 py-1.5 text-xs font-semibold text-text-tertiary">
            This step appears once the related UI is available.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {tutorialSteps.map((item, index) => (
              <span
                key={item.id}
                className={[
                  'h-1.5 rounded-full transition-all',
                  index === stepIndex ? 'w-6 bg-accent' : 'w-1.5 bg-border',
                ].join(' ')}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {step.actionLabel && (
              <button
                type="button"
                onClick={() => onAction(step)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-light bg-card px-3 text-xs font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
              >
                <StrandIcon name={step.id === 'jockey-chat' ? 'speech' : 'generate'} className="h-3.5 w-3.5" />
                {step.actionLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-accent bg-accent-light px-3 text-xs font-semibold text-brand-charcoal hover:bg-accent"
            >
              {nextLabel}
              <StrandIcon name={stepIndex >= totalSteps - 1 ? 'checkmark' : 'arrow-box-right'} className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>
    </>
  )
}

function tutorialPanelStyle(targetRect: DOMRect | null, measuredPanelHeight = 240): CSSProperties {
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const width = Math.min(420, viewportWidth - 32)
  const gap = 18
  const pageMargin = 16
  const estimatedHeight = clamp(measuredPanelHeight, 180, Math.max(180, viewportHeight - pageMargin * 2))
  const maxLeft = Math.max(pageMargin, viewportWidth - width - pageMargin)
  const maxTop = Math.max(pageMargin, viewportHeight - estimatedHeight - pageMargin)

  if (!targetRect) {
    return {
      bottom: 20,
      right: 20,
      width,
    }
  }

  const canSitRight = targetRect.right + gap + width <= viewportWidth - pageMargin
  const canSitLeft = targetRect.left - gap - width >= pageMargin
  const canSitBelow = targetRect.bottom + gap + estimatedHeight <= viewportHeight - pageMargin
  const canSitAbove = targetRect.top - gap - estimatedHeight >= pageMargin
  const centeredLeft = clamp(targetRect.left + (targetRect.width / 2) - (width / 2), pageMargin, maxLeft)
  const centeredTop = clamp(targetRect.top + (targetRect.height / 2) - (estimatedHeight / 2), pageMargin, maxTop)

  if (canSitRight) {
    return {
      left: targetRect.right + gap,
      top: centeredTop,
      width,
    }
  }

  if (canSitLeft) {
    return {
      left: targetRect.left - gap - width,
      top: centeredTop,
      width,
    }
  }

  if (canSitBelow) {
    return {
      left: centeredLeft,
      top: targetRect.bottom + gap,
      width,
    }
  }

  if (canSitAbove) {
    return {
      left: centeredLeft,
      top: targetRect.top - estimatedHeight - gap,
      width,
    }
  }

  return {
    left: centeredLeft,
    top: centeredTop,
    width,
  }
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
      <div className="jockey-chat-page jockey-chat-page--status mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
        <Notice tone="neutral" icon="spinner" text="Loading Jockey" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="jockey-chat-page jockey-chat-page--status mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
        <Notice tone="error" icon="warning" text={error} />
      </div>
    )
  }
  if (!game) {
    return (
      <div className="jockey-chat-page jockey-chat-page--status mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
        <Notice tone="neutral" icon="info" text="No analyzed game selected" />
      </div>
    )
  }

  return (
    <div className="jockey-chat-page mx-auto flex w-full max-w-[1440px] flex-1">
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
  hasCachedHighlightMetadata,
  hasCachedEntityTrackingMetadata,
  hasCachedClipAnalysisMetadata,
  reels,
  hasHighlightAnalysis,
  activeVideoName,
  selectedCategory,
  selectedEnhancedClipIndex,
  selectedStandardClipIndex,
  selectedSearchMoment,
  selectedClipAnalysis,
  selectedClipAnalysisLoading,
  selectedClipAnalysisError,
  entityTracking,
  entityTrackingLoading,
  entityTrackingError,
  workspaceMetadata,
  workspaceMetadataLoading,
  workspaceMetadataError,
  assemblyMode,
  reelFormat,
  onOpenDiscover,
  onClearSelectedClip,
  onSourceVideoSelect,
  onAssemblyModeChange,
  onReelFormatChange,
  onSelectSignal,
  onSelectEnhancedCategoryClip,
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
  hasCachedHighlightMetadata: boolean
  hasCachedEntityTrackingMetadata: boolean
  hasCachedClipAnalysisMetadata: boolean
  reels?: HighlightReels
  hasHighlightAnalysis: boolean
  activeVideoName?: string
  selectedCategory: CategoryKey
  selectedEnhancedClipIndex: number
  selectedStandardClipIndex: number
  selectedSearchMoment: SearchMoment | null
  selectedClipAnalysis?: SelectedClipAnalysis
  selectedClipAnalysisLoading: boolean
  selectedClipAnalysisError: string
  entityTracking?: EntityTrackingResponse
  entityTrackingLoading: boolean
  entityTrackingError: string
  workspaceMetadata?: JockeyWorkspaceMetadataResponse
  workspaceMetadataLoading: boolean
  workspaceMetadataError: string
  assemblyMode: AssemblyModeKey
  reelFormat: ReelFormatKey
  onOpenDiscover: () => void
  onClearSelectedClip: () => void
  onSourceVideoSelect: (videoName: string) => void
  onAssemblyModeChange: (mode: AssemblyModeKey) => void
  onReelFormatChange: (format: ReelFormatKey) => void
  onSelectSignal: (categoryKey: MapCategoryKey, index: number) => void
  onSelectEnhancedCategoryClip: (categoryKey: CategoryKey, index: number) => void
  onSelectStandardClip: (index: number) => void
  onSelectEnhancedClip: (index: number) => void
}) {
  const enhancedCategory = reels?.[selectedCategory]
  const standardClip = reels?.standard_stats.clips[selectedStandardClipIndex] || reels?.standard_stats.clips[0]
  const enhancedClip = enhancedCategory?.clips[selectedEnhancedClipIndex] || enhancedCategory?.clips[0]
  const isSelectedClipMode = Boolean(selectedSearchMoment)
  const showProductionTools = Boolean(!isSelectedClipMode && selectedGame && reels && hasHighlightAnalysis)
  const showExplainabilityRail = Boolean(!isSelectedClipMode && reels && hasHighlightAnalysis)
  const showSplitComparison = Boolean(!isSelectedClipMode && reels && hasHighlightAnalysis)
  const [explainRailCollapsed, setExplainRailCollapsed] = useState(false)
  const [assemblyPlayback, setAssemblyPlayback] = useState({ current: 0, duration: 0 })

  useEffect(() => {
    setAssemblyPlayback({ current: 0, duration: 0 })
  }, [assemblyMode, selectedGame?.tag, activeVideoName, reels])

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
        hasCachedHighlightMetadata={hasCachedHighlightMetadata}
        hasCachedEntityTrackingMetadata={hasCachedEntityTrackingMetadata}
        hasCachedClipAnalysisMetadata={hasCachedClipAnalysisMetadata}
        reels={reels}
        activeVideoName={activeVideoName}
        selectedSearchMoment={selectedSearchMoment}
        selectedClipAnalysis={selectedClipAnalysis}
        selectedClipAnalysisLoading={selectedClipAnalysisLoading}
        selectedClipAnalysisError={selectedClipAnalysisError}
        entityTracking={entityTracking}
        entityTrackingLoading={entityTrackingLoading}
        entityTrackingError={entityTrackingError}
        onOpenDiscover={onOpenDiscover}
        onClearSelectedClip={onClearSelectedClip}
      />

      {!isSelectedClipMode && (
        <WorkspaceModeBar
          mode={assemblyMode}
          onModeChange={handleAssemblyModeChange}
        />
      )}

      {!isSelectedClipMode && reels && !hasHighlightAnalysis && <AnalysisIndexNotice game={selectedGame} />}

      {isSelectedClipMode && selectedSearchMoment && selectedGame && (
        <div className="grid min-w-0 gap-4">
          <SelectedClipAnalysisSection
            game={selectedGame}
            searchMoment={selectedSearchMoment}
            analysis={selectedClipAnalysis}
            loading={selectedClipAnalysisLoading}
            error={selectedClipAnalysisError}
            hasCachedMetadata={hasCachedClipAnalysisMetadata}
            workspaceMetadata={workspaceMetadata}
            workspaceMetadataLoading={workspaceMetadataLoading}
            workspaceMetadataError={workspaceMetadataError}
            onBackToSearch={onOpenDiscover}
          />
          {!selectedClipAnalysisLoading && (
            <SavedWorkspaceMetadataPanel
              game={selectedGame}
              videoName={selectedSearchMoment.videoName}
              metadata={workspaceMetadata}
              loading={workspaceMetadataLoading}
              error={workspaceMetadataError}
              variant="selected_clip"
            />
          )}
        </div>
      )}

      <div
        className={[
          'grid min-w-0 gap-6 xl:items-start',
          showExplainabilityRail && !explainRailCollapsed ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : '',
        ].join(' ')}
      >
        <section className="flex min-w-0 flex-col gap-6">
          {showSplitComparison && (
            <div id="workspace-details" className="scroll-mt-40">
              <SplitComparisonStage
                game={selectedGame}
                reels={reels}
                activeVideoName={activeVideoName}
                assemblyMode={assemblyMode}
                selectedCategory={selectedCategory}
                standardClip={standardClip}
                enhancedClip={enhancedClip}
                standardIndex={selectedStandardClipIndex}
                enhancedIndex={selectedEnhancedClipIndex}
                onStandardSelect={onSelectStandardClip}
                onEnhancedSelect={onSelectEnhancedClip}
                onEmotionalSelect={(index) => onSelectEnhancedCategoryClip('emotional_moments', index)}
                emptyText={isLoadingReels ? 'Generating PRD highlight lanes' : 'No clips returned for this source'}
              />
            </div>
          )}

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
              <ProductionSection
                icon="play-boxed"
                title="Assembly Highlight Panel"
                detail="All semantic lanes clubbed into one playable video"
                aside={
                  assemblyPlayback.duration > 0 ? (
                    <span className="inline-flex h-8 shrink-0 items-center rounded-sm border border-border-light bg-surface px-2.5 font-mono text-xs font-semibold text-text-secondary">
                      {formatSeconds(Math.round(assemblyPlayback.current))} / {formatSeconds(Math.round(assemblyPlayback.duration))}
                    </span>
                  ) : null
                }
              >
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
                  <ReelSequencePlayer
                    variant="sidecar"
                    game={selectedGame}
                    reels={reels}
                    workspaceVideoName={activeVideoName}
                    mode={assemblyMode}
                    categoryKey={selectedCategory}
                    selectedLaneKey={assemblyMode === 'wsc_baseline' ? 'standard_stats' : selectedCategory}
                    selectedClipIndex={assemblyMode === 'wsc_baseline' ? selectedStandardClipIndex : selectedEnhancedClipIndex}
                    onSelect={onSelectSignal}
                    onPlaybackMeta={setAssemblyPlayback}
                  />
                </div>
              </ProductionSection>
            </section>
          )}

          {!isSelectedClipMode && (
            <EntityTrackingSection
              game={selectedGame}
              videoName={activeVideoName}
              tracking={entityTracking}
              loading={entityTrackingLoading}
              error={entityTrackingError}
            />
          )}

          {showProductionTools && selectedGame && reels && (
            <section className="flex min-w-0 flex-col gap-4">
              <div className="grid min-w-0 gap-6 border-t border-border-light pt-4">
                {activeVideoName && enhancedCategory && (
                  <ReelBuilder
                    game={selectedGame}
                    videoName={activeVideoName}
                    indexVideos={workspaceIndexVideos}
                    categoryKey={selectedCategory}
                    category={enhancedCategory}
                    format={reelFormat}
                    onFormatChange={onReelFormatChange}
                  />
                )}
                {activeVideoName && (
                  <SavedWorkspaceMetadataPanel
                    game={selectedGame}
                    videoName={activeVideoName}
                    metadata={workspaceMetadata}
                    loading={workspaceMetadataLoading}
                    error={workspaceMetadataError}
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
        <span
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center text-brand-charcoal',
            activeMode.key === 'twelvelabs_enhanced' ? '' : 'rounded-md border border-accent bg-accent-light',
          ].join(' ')}
        >
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
            data-semantic-layer-option={option.key === 'twelvelabs_enhanced' ? 'true' : undefined}
            className={[
              'inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-center text-[11px] font-semibold leading-tight transition-colors sm:w-[156px] sm:text-xs',
              mode === option.key
                ? option.key === 'twelvelabs_enhanced'
                  ? 'border-accent bg-accent-light text-brand-charcoal shadow-[0_1px_4px_rgba(0,220,130,0.14)]'
                  : 'border-brand-charcoal bg-brand-charcoal text-white shadow-[0_1px_4px_rgba(29,28,27,0.18)]'
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
    return <span className={['logo-svg inline-flex shrink-0 text-current', className || 'h-4 w-5'].join(' ')} dangerouslySetInnerHTML={{ __html: logoMark }} />
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
      data-tour-id="semantic-lane"
      className="semantic-lane-shell sticky top-[var(--sj-header-height)] z-40 w-full border-y border-transparent bg-surface px-4 py-2 shadow-[0_8px_18px_rgba(29,28,27,0.08)] sm:px-6"
    >
      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
                data-semantic-layer-option="true"
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
  aside,
  children,
}: {
  icon: string
  title: string
  detail: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="min-w-0 border-t border-border-light pt-4">
      <div className="flex min-w-0 items-start justify-between gap-3 px-1">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/70 bg-accent-light text-brand-charcoal shadow-[0_6px_16px_rgba(0,220,130,0.12)]">
            <StrandIcon name={icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary">{title}</h2>
            <p className="mt-0.5 truncate text-sm text-text-secondary">{detail}</p>
          </div>
        </div>
        {aside}
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
  standardIndex,
  enhancedIndex,
  onStandardSelect,
  onEnhancedSelect,
  onEmotionalSelect,
  emptyText,
}: {
  game: Game | null
  reels?: HighlightReels
  activeVideoName?: string
  assemblyMode: AssemblyModeKey
  selectedCategory: CategoryKey
  standardClip?: Clip
  enhancedClip?: Clip
  standardIndex: number
  enhancedIndex: number
  onStandardSelect: (index: number) => void
  onEnhancedSelect: (index: number) => void
  onEmotionalSelect?: (index: number) => void
  emptyText: string
}) {
  const category = reels?.[selectedCategory]
  const rightTitle =
    assemblyMode === 'wsc_baseline'
      ? 'Event Feed Baseline'
      : 'TwelveLabs Enhanced Cut'
  const rightEyebrow =
    assemblyMode === 'wsc_baseline'
      ? 'Stats Only'
      : categories.find((item) => item.key === selectedCategory)?.label || 'Semantic'
  const rightClip = assemblyMode === 'wsc_baseline' ? standardClip : enhancedClip
  const emotionalSegments =
    selectedCategory !== 'emotional_moments' && reels?.emotional_moments.clips.length
      ? reels.emotional_moments
      : undefined

  return (
    <section data-tour-id="source-video" className="overflow-hidden rounded-md border border-border-light bg-card shadow-[0_12px_34px_rgba(29,28,27,0.055)] xl:max-h-[calc(100vh-var(--sj-explainability-top)-24px)] xl:overflow-y-auto">
      <div className="grid gap-3 px-5 pb-4 pt-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-accent/70 bg-accent-light text-brand-charcoal shadow-[0_6px_16px_rgba(0,220,130,0.12)]">
            <StrandIcon name="grid" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">Split-view Player</p>
            <h2 className="mt-1 text-lg font-semibold leading-6 text-text-primary">Stats baseline vs Jockey lift</h2>
          </div>
        </div>
        <div className="min-w-0 lg:max-w-[420px]">
          <span className="inline-flex h-8 max-w-full items-center rounded-md border border-border-light bg-surface px-3 text-xs font-semibold text-text-secondary shadow-[0_1px_2px_rgba(29,28,27,0.035)]">
            <span className="truncate">
              {activeVideoName || game?.label || 'Source footage'}
            </span>
          </span>
        </div>
      </div>
      <div className="grid min-w-0 gap-3 px-3 pb-3 xl:grid-cols-2">
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
          clip={rightClip}
          timelineCategory={category}
          timelineLabel={rightEyebrow}
          secondaryTimelineCategory={emotionalSegments}
          secondaryTimelineLabel="Emotional Moments"
          onSecondaryTimelineSelect={emotionalSegments ? onEmotionalSelect : undefined}
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
  timelineCategory,
  timelineLabel,
  secondaryTimelineCategory,
  secondaryTimelineLabel,
  onSecondaryTimelineSelect,
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
  timelineCategory?: HighlightCategory
  timelineLabel: string
  secondaryTimelineCategory?: HighlightCategory
  secondaryTimelineLabel?: string
  onSecondaryTimelineSelect?: (index: number) => void
  selectedTimelineIndex: number
  onTimelineSelect: (index: number) => void
  emptyText: string
}) {
  const clipVideoName = game && clip ? videoNameForClip(game, clip) : undefined
  const playbackVideoName = sourceVideoName || clipVideoName
  const startTime = clip?.start_time
  const endTime = clip?.end_time
  const startSeconds = startTime ? secondsFromTime(startTime) : 0
  const endSeconds = endTime ? secondsFromTime(endTime) : undefined
  const streamInfoUrl =
    game && playbackVideoName
      ? streamInfoForWorkspacePlayback(game, playbackVideoName, { videoReference: clip?.video_reference })
      : null
  const posterSourceName = sourceVideoName || clipVideoName
  const posterUrl = game && posterSourceName && clip
    ? clipPosterUrl(game, posterSourceName, clip, '16x9', [], true)
    : game && posterSourceName
      ? thumbnailForVideoName(game, posterSourceName)
      : undefined
  const toneBadgeClass = tone === 'baseline'
    ? 'border-border-light bg-card text-text-secondary'
    : 'border-accent/50 bg-accent-light text-brand-charcoal'
  const hasPlayable = Boolean(streamInfoUrl && (clip || playbackVideoName))
  const description = clip?.description || ''
  const metaLabel = clip ? `${sourceLabel(clip.source_type)} · ${cleanClipTypeLabel(clip.clip_type)}` : 'Source video'

  return (
    <article className="min-w-0 overflow-hidden rounded-md border border-border-light bg-transparent">
      <div className="px-4 py-3.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={['inline-flex h-6 max-w-full items-center rounded-md border px-2 text-[10px] font-semibold uppercase tracking-[0.08em]', toneBadgeClass].join(' ')}>
              <span className="truncate">{label}</span>
            </span>
            <h3 className="mt-2 truncate text-base font-semibold text-text-primary">{title}</h3>
          </div>
          {startTime && (
            <span className="shrink-0 rounded-md border border-border-light bg-card px-2.5 py-1.5 font-mono text-xs font-semibold text-text-secondary">
              {startTime}{endTime ? ` - ${endTime}` : ''}
            </span>
          )}
        </div>
      </div>
      <div className="mx-3 overflow-hidden rounded-md bg-brand-charcoal ring-1 ring-black/5">
        <div className="flex aspect-video items-center justify-center text-text-primary">
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
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
              <StrandIcon name="info" className="h-7 w-7 text-text-tertiary" />
              <p className="max-w-sm text-sm font-semibold text-text-secondary">{emptyText}</p>
            </div>
          )}
        </div>
      </div>
      {timelineCategory && (
        <ClipMarkerLane
          clips={timelineCategory.clips}
          label={timelineLabel}
          secondaryClips={secondaryTimelineCategory?.clips}
          secondaryLabel={secondaryTimelineLabel}
          secondaryColor={signalColors.emotional_moments}
          onSecondarySelect={onSecondaryTimelineSelect}
          selectedIndex={selectedTimelineIndex}
          durationSeconds={0}
          onSelect={onTimelineSelect}
          variant="preview"
        />
      )}
      <div className="border-t border-border-light px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{metaLabel}</p>
        <p className="mt-2 line-clamp-3 text-sm font-semibold leading-5 text-text-primary">
          {description || 'No grounded clip description returned yet.'}
        </p>
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
  videoReference?: string
  startTime: string
  endTime: string
  laneKey: MapCategoryKey
  sourceIndex: number
}

function ReelSequencePlayer({
  variant = 'standard',
  game,
  reels,
  workspaceVideoName,
  mode,
  categoryKey,
  selectedLaneKey,
  selectedClipIndex,
  onSelect,
  onPlaybackMeta,
}: {
  variant?: 'standard' | 'sidecar'
  game: Game
  reels: HighlightReels
  workspaceVideoName?: string
  mode: AssemblyModeKey
  categoryKey: CategoryKey
  selectedLaneKey: MapCategoryKey
  selectedClipIndex: number
  onSelect?: (categoryKey: MapCategoryKey, index: number) => void
  onPlaybackMeta?: (meta: { current: number; duration: number }) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const assemblyVideoRef = useRef<HTMLVideoElement | null>(null)
  const assemblyPausedOnLoadRef = useRef(false)
  const [assemblyStatus, setAssemblyStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [assemblyCurrentSeconds, setAssemblyCurrentSeconds] = useState(0)
  const [playlistAutoPlay, setPlaylistAutoPlay] = useState(false)
  const [cachedAssemblyUrl, setCachedAssemblyUrl] = useState<string | null>(null)
  const assemblyLeftColumnRef = useRef<HTMLDivElement | null>(null)
  const [assemblyLeftColumnHeight, setAssemblyLeftColumnHeight] = useState(0)
  const clipButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const assemblyClipListRef = useRef<HTMLDivElement | null>(null)
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
            videoReference: clip.video_reference,
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
  const assemblyClips = useMemo(() => deoverlapSequenceClips(sequenceClips), [sequenceClips])
  const activeClip = sequenceClips[activeIndex] || sequenceClips[0]
  const sequenceTimeline = useMemo(() => {
    let cursor = 0
    return assemblyClips.map((clip) => {
      const sourceStart = secondsFromTime(clip.startTime)
      const sourceEnd = Math.max(secondsFromTime(clip.endTime), sourceStart + 1)
      const duration = Math.max(1, sourceEnd - sourceStart)
      const segment = {
        ...clip,
        duration,
        offsetEnd: cursor + duration,
        offsetStart: cursor,
        sourceEnd,
        sourceStart,
      }
      cursor += duration
      return segment
    })
  }, [assemblyClips])
  const assemblyDurationSeconds = sequenceTimeline.length
    ? sequenceTimeline[sequenceTimeline.length - 1].offsetEnd
    : 0
  const assemblySourceName = assemblyClips[0]?.sourceName
  const assemblyPlaybackTarget = assemblyClips[0]
    ? assemblyReelPlaybackTarget(game, workspaceVideoName, assemblyClips[0])
    : undefined
  const assemblyPlaybackVideoName = assemblyPlaybackTarget?.videoName
  const assemblyPosterUrl = assemblyPlaybackVideoName
    ? thumbnailForVideoName(game, assemblyPlaybackVideoName)
    : undefined
  const canUseAssemblyVideo = Boolean(
    assemblyPlaybackVideoName && assemblyClips.length > 0 && assemblyClips.every((clip) => clip.sourceName === assemblySourceName),
  )
  const assemblyReelName = mode === 'wsc_baseline' ? 'event-feed-assembly' : 'semantic-assembly'
  const assemblyVideoUrl = canUseAssemblyVideo && assemblyPlaybackVideoName
    ? assemblyReelUrl(game, assemblyPlaybackVideoName, assemblyClips, assemblyReelName, assemblyPlaybackTarget?.reference)
    : ''
  const assemblyStatusUrl = canUseAssemblyVideo && assemblyPlaybackVideoName
    ? assemblyReelStatusUrl(game, assemblyPlaybackVideoName, assemblyClips, assemblyReelName, assemblyPlaybackTarget?.reference)
    : ''
  const assemblyDownloadUrl = canUseAssemblyVideo && assemblyPlaybackVideoName
    ? assemblyReelUrl(game, assemblyPlaybackVideoName, assemblyClips, assemblyReelName, assemblyPlaybackTarget?.reference, true)
    : ''
  const assemblyStreamInfoUrl = canUseAssemblyVideo && assemblyPlaybackVideoName
    ? streamInfoForWorkspacePlayback(game, assemblyPlaybackVideoName, { videoReference: assemblyPlaybackTarget?.reference })
    : ''
  const compact = variant === 'sidecar'
  const assemblyVideoReady = assemblyStatus === 'ready'
  const usingAssemblyVideo = Boolean(assemblyVideoUrl && assemblyStatus !== 'error')
  const assemblyPlaybackUrl = cachedAssemblyUrl || assemblyVideoUrl

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
    let disposed = false
    setCachedAssemblyUrl(null)
    setAssemblyCurrentSeconds(0)
    setPlaylistAutoPlay(false)
    assemblyPausedOnLoadRef.current = false
    if (!assemblyStatusUrl) {
      setAssemblyStatus('error')
      return undefined
    }
    setAssemblyStatus('loading')
    fetchJson<{ exists: boolean; url?: string | null }>(assemblyStatusUrl)
      .then((status) => {
        if (disposed) return
        if (status.exists && status.url) {
          setCachedAssemblyUrl(apiUrl(status.url))
        }
      })
      .catch(() => {
        if (!disposed) setAssemblyStatus('error')
      })
    return () => {
      disposed = true
    }
  }, [assemblyStatusUrl])

  useEffect(() => {
    if (!compact) return undefined
    const node = assemblyLeftColumnRef.current
    if (!node) return undefined

    let frameId: number | null = null
    const measure = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        setAssemblyLeftColumnHeight(Math.ceil(node.getBoundingClientRect().height))
      })
    }

    measure()
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    resizeObserver?.observe(node)
    window.addEventListener('resize', measure)
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [compact, activeClip?.id, assemblyStatus])

  if (!activeClip) {
    return (
      <section className="rounded-md border border-border bg-surface p-5 text-sm text-text-tertiary shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
        No sequence clips are available for this assembly mode.
      </section>
    )
  }

  const activePlaybackSourceName = workspaceVideoName || activeClip.sourceName
  const streamInfoUrl = streamInfoForWorkspacePlayback(game, activePlaybackSourceName, {
    videoReference: activeClip.videoReference || activeClip.sourceName,
  })
  const startSeconds = secondsFromTime(activeClip.startTime)
  const endSeconds = secondsFromTime(activeClip.endTime)
  const activeClipColor = signalColors[activeClip.laneKey]
  const assemblyListStyle: CSSProperties | undefined = compact
    ? {
      height: assemblyLeftColumnHeight > 0 ? assemblyLeftColumnHeight : undefined,
      maxHeight: assemblyLeftColumnHeight > 0 ? assemblyLeftColumnHeight : undefined,
      minHeight: assemblyLeftColumnHeight > 0 ? assemblyLeftColumnHeight : undefined,
      overscrollBehavior: 'contain',
    }
    : undefined
  const assemblyIndexForClip = (clip: SequenceClip) => {
    const exactIndex = sequenceTimeline.findIndex((segment) =>
      segment.laneKey === clip.laneKey && segment.sourceIndex === clip.sourceIndex,
    )
    if (exactIndex >= 0) return exactIndex

    const clipStart = secondsFromTime(clip.startTime)
    const clipEnd = Math.max(secondsFromTime(clip.endTime), clipStart + 1)
    const coveredIndex = sequenceTimeline.findIndex((segment) =>
      segment.sourceName === clip.sourceName
      && clipStart >= segment.sourceStart
      && clipStart < segment.sourceEnd,
    )
    if (coveredIndex >= 0) return coveredIndex

    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    sequenceTimeline.forEach((segment, index) => {
      if (segment.sourceName !== clip.sourceName) return
      const distance = Math.min(Math.abs(segment.sourceStart - clipStart), Math.abs(segment.sourceEnd - clipEnd))
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })
    return nearestIndex
  }
  const activeAssemblyIndex = assemblyIndexForClip(activeClip)
  const activeAssemblySegment = activeAssemblyIndex >= 0 ? sequenceTimeline[activeAssemblyIndex] : undefined
  const progress = usingAssemblyVideo && assemblyDurationSeconds > 0
    ? clamp((assemblyCurrentSeconds / assemblyDurationSeconds) * 100, 0, 100)
    : ((activeIndex + 1) / Math.max(sequenceClips.length, 1)) * 100
  const seekAssemblyToIndex = (index: number) => {
    const offset = sequenceTimeline[index]?.offsetStart
    if (typeof offset === 'number') {
      setAssemblyCurrentSeconds(offset)
    }
    if (typeof offset === 'number' && assemblyVideoRef.current) {
      assemblyVideoRef.current.currentTime = offset
    }
  }
  const scrollAssemblyClipButtonIntoList = (clipId: string) => {
    const button = clipButtonRefs.current[clipId]
    const container = assemblyClipListRef.current
    if (!button || !container) return
    const buttonRect = button.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    if (buttonRect.top < containerRect.top) {
      container.scrollTop -= containerRect.top - buttonRect.top
    } else if (buttonRect.bottom > containerRect.bottom) {
      container.scrollTop += buttonRect.bottom - containerRect.bottom
    }
  }
  const selectSequenceClip = (index: number, clip: SequenceClip) => {
    setActiveIndex(index)
    const assemblyIndex = assemblyIndexForClip(clip)
    if (assemblyIndex >= 0) seekAssemblyToIndex(assemblyIndex)
    scrollAssemblyClipButtonIntoList(clip.id)
    onSelect?.(clip.laneKey, clip.sourceIndex)
  }
  const selectAssemblySegment = (index: number) => {
    const segment = sequenceTimeline[index]
    if (!segment) return
    const displayIndex = sequenceClips.findIndex((clip) =>
      clip.laneKey === segment.laneKey && clip.sourceIndex === segment.sourceIndex,
    )
    if (displayIndex >= 0) setActiveIndex(displayIndex)
    seekAssemblyToIndex(index)
    onSelect?.(segment.laneKey, segment.sourceIndex)
  }
  const advanceFallbackPlaylist = () => {
    const nextIndex = activeIndex + 1
    if (nextIndex >= sequenceClips.length) {
      setPlaylistAutoPlay(false)
      return
    }
    const nextClip = sequenceClips[nextIndex]
    setActiveIndex(nextIndex)
    setPlaylistAutoPlay(true)
    onSelect?.(nextClip.laneKey, nextClip.sourceIndex)
  }

  useEffect(() => {
    if (!activeClip) return
    const activeOffset = activeAssemblySegment?.offsetStart
    setAssemblyCurrentSeconds(typeof activeOffset === 'number' ? activeOffset : activeIndex)
    if (usingAssemblyVideo && typeof activeOffset === 'number' && assemblyVideoRef.current) {
      assemblyVideoRef.current.currentTime = activeOffset
    }

    const clipsToPrefetch = sequenceClips.slice(activeIndex + 1, activeIndex + 3)
    clipsToPrefetch.forEach((clip) => {
      const url = streamInfoForWorkspacePlayback(game, workspaceVideoName || clip.sourceName, {
        videoReference: clip.videoReference || clip.sourceName,
      })
      prefetchTwelveLabsStream(url)
    })
  }, [activeAssemblySegment?.offsetStart, activeClip, activeIndex, game, sequenceClips, usingAssemblyVideo, workspaceVideoName])

  const syncAssemblyPlaybackPosition = () => {
    const video = assemblyVideoRef.current
    if (!video) return
    const current = video.currentTime
    setAssemblyCurrentSeconds(clamp(current, 0, Math.max(assemblyDurationSeconds, current)))
    const segmentIndex = sequenceTimeline.findIndex((segment, index) => {
      const isLast = index === sequenceTimeline.length - 1
      return current >= segment.offsetStart && (current < segment.offsetEnd || isLast)
    })
    if (segmentIndex >= 0) {
      const segment = sequenceTimeline[segmentIndex]
      const displayIndex = sequenceClips.findIndex((clip) =>
        clip.laneKey === segment.laneKey && clip.sourceIndex === segment.sourceIndex,
      )
      const matchesParentSelection = segment.laneKey === selectedLaneKey && segment.sourceIndex === selectedClipIndex
      if (displayIndex === activeIndex && matchesParentSelection) return
      if (displayIndex >= 0) setActiveIndex(displayIndex)
      if (matchesParentSelection) return
      onSelect?.(segment.laneKey, segment.sourceIndex)
    }
  }
  useEffect(() => {
    onPlaybackMeta?.({
      current: assemblyCurrentSeconds,
      duration: assemblyDurationSeconds,
    })
  }, [assemblyCurrentSeconds, assemblyDurationSeconds, onPlaybackMeta])

  const playbackClock = (
    <span className="shrink-0 font-mono text-sm font-semibold text-text-tertiary">
      {formatSeconds(Math.round(assemblyCurrentSeconds))} / {formatSeconds(Math.round(assemblyDurationSeconds))}
    </span>
  )

  return (
    <section className="w-full max-w-full min-w-0 overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      {!compact && (
        <div className="grid gap-4 bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StrandIcon name="play-boxed" className="h-4 w-4 text-accent" />
              <h2 className="text-base font-semibold text-text-primary">Assembly Lane Player</h2>
            </div>
            <p className="mt-1 text-sm text-text-secondary">Lane segments stream immediately while the assembled export prepares.</p>
          </div>
          {playbackClock}
        </div>
      )}
      <div className="h-1 bg-border-light">
        <span className="block h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className={compact ? 'grid min-h-0 w-full min-w-0 items-start [@media(min-width:560px)]:grid-cols-[minmax(0,1fr)_minmax(210px,0.62fr)]' : 'grid w-full min-w-0 items-stretch lg:grid-cols-[minmax(0,1.2fr)_360px]'}>
        <div ref={assemblyLeftColumnRef} className="flex min-w-0 self-start flex-col bg-surface">
          <div className="m-3 aspect-video min-w-0 overflow-hidden rounded-md bg-card">
            {usingAssemblyVideo ? (
              <div className="relative h-full w-full overflow-hidden bg-brand-charcoal">
                {assemblyPosterUrl && (
                  <img
                    alt=""
                    src={assemblyPosterUrl}
                    className={[
                      'absolute inset-0 h-full w-full object-contain transition-opacity duration-300',
                      assemblyVideoReady ? 'opacity-0' : 'opacity-100',
                    ].join(' ')}
                  />
                )}
                <video
                  key={assemblyPlaybackUrl}
                  ref={assemblyVideoRef}
                  className={[
                    'relative z-[1] h-full w-full bg-transparent object-contain transition-opacity duration-300',
                    assemblyVideoReady ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                  controls
                  playsInline
                  preload="auto"
                  src={assemblyPlaybackUrl}
                  onLoadStart={() => setAssemblyStatus('loading')}
                  onLoadedMetadata={() => {
                    if (!assemblyPausedOnLoadRef.current && assemblyVideoRef.current) {
                      assemblyVideoRef.current.pause()
                      assemblyPausedOnLoadRef.current = true
                      if (typeof activeAssemblySegment?.offsetStart === 'number') {
                        assemblyVideoRef.current.currentTime = activeAssemblySegment.offsetStart
                      }
                    }
                  }}
                  onCanPlay={() => setAssemblyStatus('ready')}
                  onTimeUpdate={syncAssemblyPlaybackPosition}
                  onError={() => setAssemblyStatus('error')}
                />
                {assemblyStatus === 'loading' && (
                  <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center bg-brand-charcoal/48 backdrop-blur-[1px]">
                    <div className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-brand-charcoal/84 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,0.24)]">
                      <StrandIcon name="spinner" className="h-4 w-4 animate-spin text-accent" />
                      Building lane assembly
                    </div>
                  </div>
                )}
                {assemblyVideoReady && (
                  <div className="pointer-events-none absolute left-3 top-3 z-[4] flex max-w-[calc(100%-24px)] items-center gap-2">
                    <span className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-accent/70 bg-accent px-2.5 text-xs font-semibold text-brand-charcoal shadow-[0_8px_18px_rgba(0,0,0,0.18)]">
                      <StrandIcon name="checkmark" className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Assembly</span>
                    </span>
                    {assemblyDownloadUrl && (
                      <a
                        href={assemblyDownloadUrl}
                        download
                        aria-label="Download assembled highlight video"
                        title="Download assembled highlight video"
                        onClick={(event) => startDownloadAfterHlsWarmup(event, assemblyStreamInfoUrl, assemblyDownloadUrl)}
                        className="pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/24 bg-brand-charcoal/88 text-white shadow-[0_8px_18px_rgba(0,0,0,0.22)] backdrop-blur-sm transition hover:border-accent hover:bg-accent hover:text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-accent/40"
                      >
                        <StrandIcon name="download" className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <TwelveLabsVideoPlayer
                key={`${streamInfoUrl}-${activeClip.id}`}
                streamInfoUrl={streamInfoUrl}
                startSeconds={startSeconds}
                endSeconds={endSeconds}
                posterUrl={thumbnailForVideoName(game, activePlaybackSourceName)}
                segmentRange={{
                  startSeconds,
                  endSeconds,
                  startLabel: activeClip.startTime,
                  endLabel: activeClip.endTime,
                }}
                autoPlay={playlistAutoPlay}
                onDuration={() => undefined}
                onPlayingChange={setPlaylistAutoPlay}
                onRangeComplete={advanceFallbackPlaylist}
              />
            )}
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
            <div className="relative mt-3 h-8" aria-label="Assembled lane segment map">
              <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-border-light" />
              {sequenceTimeline.map((segment, index) => {
                const color = signalColors[segment.laneKey]
                const displayIndex = sequenceClips.findIndex((clip) =>
                  clip.laneKey === segment.laneKey && clip.sourceIndex === segment.sourceIndex,
                )
                const selected = displayIndex === activeIndex
                const left = assemblyDurationSeconds > 0 ? clamp((segment.offsetStart / assemblyDurationSeconds) * 100, 0, 99) : 0
                const width = assemblyDurationSeconds > 0 ? clamp((segment.duration / assemblyDurationSeconds) * 100, 2, 100 - left) : 100
                return (
                  <button
                    key={`${segment.id}-assembly-strip`}
                    type="button"
                    data-preserve-hover="true"
                    onClick={() => selectAssemblySegment(index)}
                    className={[
                      'absolute top-1/2 h-5 -translate-y-1/2 rounded-sm border transition-transform hover:scale-y-125',
                      selected ? 'shadow-[0_0_0_3px_rgba(0,220,130,0.18)]' : '',
                    ].join(' ')}
                    style={{
                      backgroundColor: selected ? color.bg : color.track,
                      borderColor: color.border,
                      left: `${left}%`,
                      width: `${width}%`,
                      minWidth: selected ? 18 : 12,
                    }}
                    title={`${segment.title}: ${formatSeconds(Math.round(segment.offsetStart))} - ${formatSeconds(Math.round(segment.offsetEnd))}`}
                    aria-label={`Jump to assembly segment ${index + 1}`}
                  />
                )
              })}
            </div>
          </div>
        </div>
        <div
          ref={assemblyClipListRef}
          className={compact ? 'relative grid min-h-0 min-w-0 self-start content-start gap-2 overflow-y-auto border-t border-border-light px-4 py-3 [@media(min-width:560px)]:border-l [@media(min-width:560px)]:border-t-0 [@media(min-width:560px)]:px-2' : 'relative flex min-w-0 flex-col gap-2 border-t border-border-light px-3 py-4 lg:border-l lg:border-t-0'}
          style={assemblyListStyle}
        >
          <span className="pointer-events-none absolute bottom-5 left-[44px] top-5 z-0 w-px bg-border [@media(min-width:560px)]:left-[36px]" aria-hidden="true" />
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
                data-preserve-hover="true"
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
                    ? 'border-accent bg-accent-light shadow-[0_8px_22px_rgba(0,220,130,0.12)]'
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
                      backgroundColor: active ? '#00DC82' : color.track,
                      borderColor: active ? '#00B86E' : color.border,
                      color: active ? '#FFFFFF' : color.border,
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
                    backgroundColor: active ? '#E8F5E9' : color.track,
                    borderColor: active ? '#00B86E' : color.border,
                    color: active ? '#00B86E' : color.text,
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

  useEffect(() => {
    const handleTutorialPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; focusOnly?: boolean }>).detail
      if (!detail?.focusOnly) {
        setActiveSkillKey('')
        setDraft(detail?.prompt || TUTORIAL_JOCKEY_PROMPT)
      }
      window.requestAnimationFrame(() => composerRef.current?.focus())
    }
    window.addEventListener(JOCKEY_TUTORIAL_PROMPT_EVENT, handleTutorialPrompt)
    return () => window.removeEventListener(JOCKEY_TUTORIAL_PROMPT_EVENT, handleTutorialPrompt)
  }, [])

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
    const reelLimit = showReel && jockeyPromptRequestsSpecificClip(message) ? 1 : 4
    const sessionId = latestJockeySessionId(exchanges)
    const conversationHistory = jockeyConversationHistory(exchanges, 5)
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
      conversation_history: conversationHistory,
    }
    if (sessionId) body.session_id = sessionId
    fetchJson<unknown>(`/games/${encodeURIComponent(game.tag)}/jockey-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((response) => {
        const normalizedResponse = normalizeJockeyChatResponse(response, message)
        setExchanges((current) => upsertJockeyChatExchange(current, { ...currentExchange, response: normalizedResponse }))
      })
      .catch((error: Error) => {
        setExchanges((current) => upsertJockeyChatExchange(current, { ...currentExchange, error: error.message || 'Jockey request failed' }))
      })
      .finally(() => setLoading(false))
  }

  return (
    <section className="jockey-chat flex min-h-0 w-full flex-1 flex-col">
      <div className="jockey-chat-messages min-h-0 flex-1 overflow-y-auto">
        {showSuggestions ? (
          <div className="jockey-chat-suggestions">
            <div className="jockey-chat-suggestion-list">
              {jockeyProducerSkills.map((skill) => (
                <button
                  key={skill.key}
                  type="button"
                  onClick={() => loadSkillPrompt(skill)}
                  className="jockey-chat-suggestion group text-left text-text-secondary"
                >
                  <span className="jockey-chat-suggestion-icon inline-flex items-center justify-center" style={{ color: skill.color }}>
                    <StrandIcon name={skill.icon} className="h-5 w-5" />
                  </span>
                  <span className="jockey-chat-suggestion-copy min-w-0">
                    <span className="block text-sm font-semibold text-text-primary">{skill.label}</span>
                    <span className="jockey-chat-suggestion-prompt mt-1 line-clamp-2 block text-xs font-medium leading-5 text-text-secondary group-hover:text-brand-charcoal">{skill.prompt}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="jockey-chat-thread">
            {exchanges.map((exchange) => (
              <JockeyExchangeView
                key={exchange.id}
                game={game}
                exchange={exchange}
                onOpenInWorkspace={onOpenInWorkspace}
              />
            ))}
            {loading && (
              <div className="jockey-chat-loading inline-flex w-fit items-center gap-2 rounded-md border border-border bg-surface text-sm font-semibold text-text-secondary">
                <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
                Jockey is answering
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      <div className="jockey-chat-composer-shell">
        <div data-tour-id="jockey-composer" className="jockey-chat-composer">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submitPrompt(draft)
              }
            }}
            rows={1}
            className="jockey-chat-input max-h-[132px] min-h-[48px] flex-1 resize-none bg-transparent text-sm font-medium leading-6 text-text-primary outline-none placeholder:text-text-tertiary"
            placeholder={activeSkill ? activeSkill.label : 'Ask Jockey a question or ask for a clip.'}
          />
          <button
            type="button"
            onClick={() => submitPrompt(draft)}
            disabled={!canSubmit}
            className={[
              'jockey-chat-send inline-flex shrink-0 items-center gap-2 rounded-md border text-sm font-semibold',
              canSubmit
                ? 'border-brand-charcoal bg-brand-charcoal text-white hover:border-brand-charcoal hover:bg-brand-charcoal'
                : 'cursor-not-allowed border-border bg-card text-text-tertiary',
            ].join(' ')}
          >
            <StrandIcon name={loading ? 'spinner' : 'generate'} className={['h-4 w-4', loading ? 'animate-spin' : ''].join(' ')} />
            <span className="jockey-chat-send-label">Send</span>
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
    <div className="jockey-chat-exchange min-w-0">
      <div className="jockey-chat-user-prompt rounded-md border border-brand-charcoal bg-brand-charcoal text-sm font-semibold leading-6 text-white shadow-[0_8px_20px_rgba(29,28,27,0.14)]">
        <p className="jockey-chat-user-prompt-text">{exchange.prompt}</p>
      </div>
      {exchange.error ? (
        <div className="jockey-chat-error mt-4 rounded-md border border-error bg-error-light px-4 py-3 text-sm font-semibold leading-6 text-error-dark">
          {exchange.error}
        </div>
      ) : exchange.response ? (
        <JockeyResponseShowcase
          game={game}
          exchange={exchange}
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
  exchange,
  response,
  skill,
  showReel,
  onOpenInWorkspace,
}: {
  game: Game
  exchange: JockeyChatExchange
  response: JockeyChatResponse
  skill?: (typeof jockeyProducerSkills)[number]
  showReel: boolean
  onOpenInWorkspace: (videoName: string, searchMoment: SearchMoment) => void
}) {
  const clips = Array.isArray(response.clips) ? response.clips : []

  if (showReel) {
    return (
      <div className="jockey-chat-response-block mt-4">
        <JockeyManifestSummary
          game={game}
          exchange={exchange}
          response={response}
          skill={skill}
        />
        {clips.length ? (
          <JockeyClipShowcase
            game={game}
            clips={clips}
            onOpenInWorkspace={onOpenInWorkspace}
          />
        ) : (
          <p className="mt-4 text-sm font-semibold text-text-tertiary">No grounded reel clips returned.</p>
        )}
      </div>
    )
  }

  return (
    <div className="jockey-chat-response jockey-chat-response-block mt-4 rounded-md border border-border-light bg-surface shadow-[0_1px_2px_rgba(31,41,33,0.035)]">
      <div className="jockey-chat-response-header">
        <div className="flex min-w-0 items-center gap-2">
          <StrandIcon name={skill?.icon || 'speech'} className="h-4 w-4 shrink-0 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Jockey</h3>
        </div>
        <JockeySaveTurnButton game={game} exchange={exchange} response={response} />
      </div>
      <p className="jockey-chat-response-body mt-3 text-sm font-medium leading-6 text-text-secondary">{response.narrative_summary}</p>
    </div>
  )
}

function JockeyManifestSummary({
  game,
  exchange,
  response,
  skill,
}: {
  game: Game
  exchange: JockeyChatExchange
  response: JockeyChatResponse
  skill?: (typeof jockeyProducerSkills)[number]
}) {
  return (
    <div className="jockey-chat-response jockey-chat-response-block rounded-md border border-border-light bg-surface shadow-[0_1px_2px_rgba(31,41,33,0.035)]">
      <div className="jockey-chat-response-header">
        <div className="flex min-w-0 items-center gap-2">
          <StrandIcon name={skill?.icon || 'document-list'} className="h-4 w-4 shrink-0 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">Jockey Reasoning</h3>
        </div>
        <JockeySaveTurnButton game={game} exchange={exchange} response={response} />
      </div>
      <p className="jockey-chat-response-body mt-3 text-sm font-medium leading-6 text-text-secondary">{response.narrative_summary}</p>
    </div>
  )
}

function JockeySaveTurnButton({
  game,
  exchange,
  response,
}: {
  game: Game
  exchange: JockeyChatExchange
  response: JockeyChatResponse
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const promptPreview = exchange.prompt.length > 48 ? `${exchange.prompt.slice(0, 45)}...` : exchange.prompt
  const targetVideos = jockeyExchangeTargetVideos(game, response)
  const canSave = targetVideos.length > 0 && !exchange.error

  const handleSave = async () => {
    if (!canSave || saving) return
    setSaving(true)
    setError('')
    try {
      const body = await fetchJson<JockeyWorkspaceBatchSaveResponse>(
        `/games/${encodeURIComponent(game.tag)}/jockey-workspace/saved-jockey-turn`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: exchange.prompt,
            skill_key: exchange.skillKey,
            show_reel: exchange.showReel,
            response: exchange.response,
          }),
        },
      )
      if (!body.saved?.length) {
        throw new Error('No video-specific Jockey turn was saved')
      }
      setSaved(true)
      notifyWorkspaceMetadataSaved(game.tag, body.saved.map((item) => item.video_name).filter(Boolean))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="jockey-chat-save flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
      <button
        type="button"
        aria-label={`Save Jockey turn: ${promptPreview}`}
        title={saved ? 'Saved to video workspace metadata' : 'Save this turn to the source video workspace metadata'}
        disabled={!canSave || saving}
        className={[
          'jockey-chat-save-button inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold shadow-[0_1px_2px_rgba(31,41,33,0.035)]',
          saved
            ? 'border-accent/40 bg-accent-light text-brand-charcoal'
            : 'border-border-light bg-card text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal',
          !canSave || saving ? 'cursor-not-allowed opacity-60' : '',
        ].join(' ')}
        onClick={() => void handleSave()}
      >
        <StrandIcon name={saving ? 'spinner' : saved ? 'checkmark' : 'document'} className={['h-3.5 w-3.5', saving ? 'animate-spin' : ''].join(' ')} />
        {saved ? 'Saved' : saving ? 'Saving' : 'Save'}
      </button>
      {error ? <span className="jockey-chat-save-error truncate text-[10px] font-semibold text-error">{error}</span> : null}
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
    <div className={['jockey-chat-clips', showSliderRow ? 'jockey-chat-clips--slider' : ''].join(' ')}>
      <div className={['jockey-chat-clips-track', showSliderRow ? 'jockey-chat-clips-track--slider' : ''].join(' ')}>
        {clips.map((clip, index) => {
          const sourceName = jockeyClipVideoName(game, clip)
          const streamInfoUrl = jockeyClipStreamInfoUrl(game, clip)
          const downloadUrl = sourceName ? jockeyReelDownloadUrl(game, sourceName, clip, index) : null
          const posterUrl = clip.thumbnail_url || (sourceName ? thumbnailForVideoName(game, sourceName) : undefined)
          const workspaceMoment = sourceName ? jockeyClipSearchMoment(sourceName, clip) : null
          const paddedRange = paddedRangeForClip(clip)

          return (
            <article
              key={clip.id}
              className={[
                'jockey-chat-clip-card min-w-0 overflow-hidden rounded-md border border-border-light bg-surface shadow-[0_8px_18px_rgba(29,28,27,0.055)]',
                showSliderRow ? 'jockey-chat-clip-card--slider shrink-0 snap-start' : '',
              ].join(' ')}
            >
            <div className="jockey-chat-clip-media relative m-1.5 aspect-[9/16] overflow-hidden rounded-md bg-brand-charcoal ring-1 ring-black/5">
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download
                  className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/28 bg-brand-charcoal/78 text-white shadow-[0_8px_18px_rgba(0,0,0,0.2)] backdrop-blur-sm hover:border-accent hover:bg-accent hover:text-brand-charcoal"
                  aria-label={`Download ${clip.start_time} reel`}
                  title="Download reel"
                  onClick={(event) => startDownloadAfterHlsWarmup(event, streamInfoUrl, downloadUrl)}
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

            <div className="jockey-chat-clip-meta px-3 pb-3 pt-1">
              <div className="jockey-chat-clip-meta-row flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 truncate font-mono text-xs font-semibold text-text-primary">
                  {formatSeconds(paddedRange.start)} - {formatSeconds(paddedRange.end)}
                </p>
                <span className="jockey-chat-clip-confidence shrink-0 rounded-sm border border-border-light bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-tertiary">
                  Conf. {confidenceLabel(clip.confidence)}
                </span>
                {workspaceMoment && sourceName && (
                  <button
                    type="button"
                    onClick={() => onOpenInWorkspace(sourceName, workspaceMoment)}
                    className="jockey-chat-clip-open ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:bg-accent-light hover:text-brand-charcoal"
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
            <StrandIcon name="checkmark" className="h-4 w-4" />
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
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/70 bg-accent-light text-brand-charcoal shadow-[0_6px_16px_rgba(0,220,130,0.12)]">
              <StrandIcon name="checkmark" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">Evidence trace</p>
              <h2 className="truncate text-base font-semibold text-text-primary">Explainability</h2>
            </div>
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
            <p className="inline-flex min-w-0 items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-charcoal">
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
  const marqueeDurationSeconds = Math.max(32, uniqueVideos.length * 7)

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
    const title = cleanVideoCardTitle(video.display_name || video.name || videoName)
    const poster = video.thumbnail_url || ''
    return (
      <button
        key={`${group}-${videoName}-${index}`}
        type="button"
        onClick={() => onSelect(videoName)}
        className={[
          'group relative h-[118px] w-[210px] shrink-0 snap-start overflow-hidden rounded-md border bg-card text-left shadow-[0_8px_24px_rgba(29,28,27,0.08)]',
          active ? 'border-brand-charcoal ring-2 ring-brand-charcoal/25' : 'border-border-light hover:border-accent/80',
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
        <span className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/58 to-transparent" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/72 via-black/38 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 p-3 text-white">
          <span
            className={[
              'block min-w-0 rounded-md border px-2.5 py-2 text-sm font-semibold leading-4 text-white shadow-[0_6px_14px_rgba(0,0,0,0.2)] backdrop-blur-sm',
              active
                ? 'border-brand-charcoal bg-brand-charcoal/95'
                : 'border-white/24 bg-brand-charcoal/88',
            ].join(' ')}
          >
            <span className="line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">{title}</span>
          </span>
        </span>
      </button>
    )
  }

  return (
    <section className="relative overflow-hidden rounded-md border border-border bg-card shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div
        className="workspace-video-carousel workspace-video-carousel--marquee relative overflow-hidden py-4"
        style={{ '--workspace-marquee-duration': `${marqueeDurationSeconds}s` } as CSSProperties}
      >
        <div className="workspace-video-carousel-track workspace-video-carousel-track--marquee flex w-max gap-3 px-5">
          {uniqueVideos.map((video, index) => renderVideoButton(video, index, 'loop-a'))}
          {uniqueVideos.map((video, index) => renderVideoButton(video, index, 'loop-b'))}
        </div>
      </div>
    </section>
  )
}

function AppStartupScreen({
  status,
  error,
  onRetry,
}: {
  status: 'loading' | 'error'
  error: string
  onRetry: () => void
}) {
  return (
    <main className="app-startup-screen min-h-screen bg-background text-text-primary">
      <div className="app-startup-screen-inner mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 py-12 text-center">
        <div
          className="app-startup-screen-logo logo-svg text-brand-charcoal"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: logoFull }}
        />
        {status === 'loading' ? (
          <>
            <StrandIcon name="spinner" className="mt-8 h-7 w-7 animate-spin text-accent" />
            <p className="mt-4 text-sm font-semibold text-text-secondary">Connecting to Sports Jockey...</p>
            <p className="mt-2 text-xs font-medium text-text-tertiary">Checking API and loading workspace data</p>
          </>
        ) : (
          <div className="mt-8 w-full text-left">
            <Notice
              tone="error"
              icon="warning"
              text={error || 'Unable to reach the Sports Jockey API. Make sure the backend is running.'}
            />
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-secondary transition hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

const overviewProblemPoints: Array<{ title: string; body: string }> = [
  {
    title: 'The feed gives you the play, not the story',
    body: 'Event automation is fast but it stops at scoreboard facts. Crowd surges, player emotion, and narrative context rarely make the cut list.',
  },
  {
    title: 'A timestamp is not proof',
    body: 'Producers still open the clip, verify what happened, and justify the edit. Without grounded analysis, highlights ship on faith.',
  },
  {
    title: 'Context walks away between sessions',
    body: 'Search notes, lane decisions, and clip rationale rarely stay on the asset. The next producer rebuilds the same judgment from scratch.',
  },
]

const overviewSolutionBenefits = [
  'Find what the stat sheet missed',
  'Explain with proof on screen',
  'Ship lanes and remember the call',
] as const

const overviewCompareColumns: Array<{
  kind: 'feed' | 'lift'
  title: string
  subtitle: string
  items: string[]
}> = [
  {
    kind: 'feed',
    title: 'Event feed alone',
    subtitle: 'What automation gives you today',
    items: [
      'Sparse clips tied to scoreboard and official stats',
      'Chronological list — little narrative or emotional ranking',
      'No proof bundle when someone questions the cut',
      'Context lives in Slack threads, not on the asset',
    ],
  },
  {
    kind: 'lift',
    title: 'With Jockey',
    subtitle: 'What semantic lift adds on the same index',
    items: [
      'Search by intent — crowd energy, reactions, story beats',
      'Pegasus metadata grounded to the opened segment',
      'Semantic lanes: Best Plays, Emotion, Fans, BTS',
      'Producer decisions saved back for the next session',
    ],
  },
]

const overviewFeatures: Array<{
  title: string
  body: string
  icon: string
  iconBg: string
  iconColor: string
}> = [
  {
    title: 'Marengo 3.0 Semantic search',
    body: 'Sports Jockey indexes each game in TwelveLabs. Marengo embeddings power meaning based search across every source video in that match library.',
    icon: 'search-v2',
    iconBg: 'bg-product-search-light',
    iconColor: 'text-product-search-dark',
  },
  {
    title: 'Discover video library',
    body: 'The Discover view lists playable sources for the selected game. Query Marengo in plain language, preview hits, and open a timestamp on the Dashboard.',
    icon: 'generate',
    iconBg: 'bg-product-embed-light',
    iconColor: 'text-product-embed-dark',
  },
  {
    title: 'Pegasus 1.5 Clip analysis',
    body: 'On the Dashboard, select any moment from search or a highlight lane. Pegasus returns grounded metadata on tone, action, score context, and cut boundaries from on screen evidence.',
    icon: 'analyze',
    iconBg: 'bg-product-generate-light',
    iconColor: 'text-product-generate-dark',
  },
  {
    title: 'Dashboard highlight workspace',
    body: 'Producer cockpit for one source video. Jockey curated lanes and stats, Assembly Highlight preview, and Entity Tracking for players and key moments on screen.',
    icon: 'dashboard',
    iconBg: 'bg-accent-light',
    iconColor: 'text-brand-charcoal',
  },
  {
    title: 'Jockey Assistant',
    body: 'Jockey Assistant is the prompt driven reel studio on the same video. Run preset or custom instructions to generate Best Plays, Emotion, Fans, and BTS packages you can edit in the Dashboard.',
    icon: 'speech',
    iconBg: 'bg-mb-orange-light',
    iconColor: 'text-mb-orange-dark',
  },
  {
    title: 'Saved workspace context',
    body: 'Clip analysis and Jockey chat save per video on the game asset. Return to the match later and reload searches, lane picks, and producer notes without starting over.',
    icon: 'document-list',
    iconBg: 'bg-mb-pink-light',
    iconColor: 'text-mb-pink-dark',
  },
]

function OverviewPage({
  onNavigate,
  game,
  loading,
}: {
  onNavigate: (view: ViewKey) => void
  game: Game | null
  loading: boolean
}) {
  return (
    <div className="overview-page flex flex-1 flex-col bg-background">
      <div className="overview-shell mx-auto w-full max-w-[1440px]">
        <section className="overview-hero-card relative overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_10px_28px_rgba(29,28,27,0.045)]">
          <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-mb-green via-mb-orange to-mb-pink" aria-hidden="true" />
          <div className="overview-hero">
            <div className="overview-hero-copy min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-light bg-card px-2.5 text-[0.6875rem] font-semibold text-text-secondary">
                  <ModeGlyph mode="twelvelabs_enhanced" icon="vision" className="h-3.5 w-4 text-brand-charcoal" />
                  TwelveLabs
                </span>
                <span className="inline-flex h-7 items-center rounded-full border border-border-light bg-accent-light px-2.5 text-[0.6875rem] font-semibold text-brand-charcoal">
                  Jockey
                </span>
                {loading ? (
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-light bg-surface px-2.5 text-[0.6875rem] font-semibold text-text-secondary">
                    <StrandIcon name="spinner" className="h-3 w-3 animate-spin" />
                    Syncing workspace
                  </span>
                ) : null}
              </div>
              <h2 className="overview-hero-title mt-2.5 font-semibold text-text-primary">
                Feeds find the play. Jockey turns it into a highlight you can prove and ship.
              </h2>
              <p className="overview-hero-lead mt-2 text-sm leading-6 text-text-secondary">
                Producers need story, proof, and memory on the asset. Sports Jockey adds TwelveLabs semantic lift on
                the same match footage so you find untagged moments, explain clips on screen, and save the call for
                next time.
              </p>
              <div className="overview-hero-actions mt-3">
                <OverviewNavButtons variant="hero" onNavigate={onNavigate} />
              </div>
            </div>
            <OverviewHeroVisual />
          </div>
        </section>

        <div className="overview-sections divide-y-2 divide-border border-t-2 border-border">
          <div className="overview-section">
            <OverviewNarrativePanel problems={overviewProblemPoints} />
          </div>

          <section className="overview-section overview-block">
            <OverviewSectionHeader
              kicker="Why it matters"
              title="Same footage. Two editorial baselines."
              lead="Sports Jockey does not replace your event feed — it adds searchable, explainable, publishable lift on the indexed match."
            />
            <OverviewCompareSection columns={overviewCompareColumns} />
          </section>

          <div className="overview-section">
            <OverviewFeaturesSection features={overviewFeatures} />
          </div>

          <section className="overview-section overview-block">
            <OverviewBadgeSectionHeader
              badge="Architecture"
              badgeTone="architecture"
              title="How the stack connects"
              lead="Match footage is indexed once in TwelveLabs. Marengo powers search, Pegasus grounds the clip you open, and Jockey Assistant delivers semantic lanes through Discover and Dashboard."
            />
            <OverviewReservedSlot
              label="Architecture diagram"
              detail="A single view of ingest, indexing, models, and the three producer screens that sit on top."
              minHeightClass="min-h-[220px] sm:min-h-[280px]"
            />
          </section>

          <section className="overview-section overview-block">
            <OverviewBadgeSectionHeader
              badge="Demo"
              badgeTone="demo"
              title="See it in action"
              lead="One match, one workflow. Search in Discover, review and explain on the Dashboard, then build reels with Jockey Assistant."
            />
            <OverviewReservedSlot
              label="Product demo"
              detail="Screen recording or interactive preview of the full producer path on live match footage."
              minHeightClass="min-h-[240px] sm:min-h-[300px]"
            />
          </section>

          <div className="overview-section">
            <OverviewClosingPanel />
          </div>
        </div>
      </div>
    </div>
  )
}

function OverviewHeroVisual() {
  return (
    <div className="overview-hero-visual">
      <img
        src={overviewHeroJockey}
        alt="Jockey mobile app showing soccer highlights, celebrations, and fan reactions"
        className="overview-hero-visual-img"
        width={800}
        height={800}
        loading="eager"
        decoding="async"
      />
    </div>
  )
}

const overviewExternalLinks = [
  {
    label: 'Code Repo',
    href: 'https://github.com/Hrishikesh332/Sports-Semantic-Jockey',
  },
  {
    label: 'Talk to Sales',
    href: 'https://www.twelvelabs.io/contact',
  },
] as const

function overviewNavButtonClass(variant: 'hero' | 'closing', tone: 'primary' | 'secondary') {
  if (tone === 'primary') {
    return variant === 'closing'
      ? 'border-brand-white/20 bg-brand-white text-brand-charcoal hover:bg-brand-grey'
      : 'border-brand-charcoal bg-brand-charcoal text-brand-white hover:bg-brand-grey hover:text-brand-charcoal'
  }
  return variant === 'closing'
    ? 'border-brand-white/25 bg-transparent text-brand-white hover:border-brand-white hover:bg-brand-white/10'
    : 'border-border bg-surface text-text-primary hover:border-accent hover:bg-accent-light'
}

function OverviewNavButtons({
  variant,
  onNavigate,
}: {
  variant: 'hero' | 'closing'
  onNavigate?: (view: ViewKey) => void
}) {
  return (
    <div className="overview-nav-buttons">
      {variant === 'hero' && onNavigate ? (
        <button
          type="button"
          onClick={() => onNavigate('discover')}
          className={[
            'overview-nav-button inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold',
            overviewNavButtonClass('hero', 'primary'),
          ].join(' ')}
        >
          <StrandIcon name="search-v2" className="h-4 w-4" />
          Discover
        </button>
      ) : null}
      {overviewExternalLinks.map((link, index) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={[
            'overview-nav-external overview-nav-button inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-semibold',
            overviewNavButtonClass(variant, variant === 'closing' && index === 1 ? 'primary' : 'secondary'),
          ].join(' ')}
        >
          <span>{link.label}</span>
        </a>
      ))}
    </div>
  )
}

function OverviewSectionHeader({
  kicker,
  title,
  lead,
}: {
  kicker: string
  title: string
  lead: string
}) {
  return (
    <header className="overview-section-header">
      <p className="overview-kicker">{kicker}</p>
      <h3 className="overview-heading">{title}</h3>
      <p className="overview-lead">{lead}</p>
    </header>
  )
}

function OverviewCompareLiftVisual() {
  return (
    <div className="overview-compare-lift-visual">
      <img
        src={overviewCompareLift}
        alt="Semantic highlight lanes across racing, football, and tennis match footage"
        className="overview-compare-lift-visual-img"
        width={640}
        height={400}
        loading="lazy"
        decoding="async"
      />
    </div>
  )
}

function OverviewCompareSection({ columns }: { columns: typeof overviewCompareColumns }) {
  return (
    <div className="overview-compare-grid">
      {columns.map((column) => (
        <article
          key={column.title}
          className={column.kind === 'feed' ? 'overview-compare-feed overview-compare-card' : 'overview-compare-lift overview-compare-card'}
        >
          {column.kind === 'lift' ? (
            <div className="overview-compare-lift-inner">
              <OverviewCompareLiftVisual />
              <div className="overview-compare-lift-copy min-w-0">
                <p className="overview-kicker">Jockey</p>
                <h4 className="mt-2 text-xl font-semibold text-text-primary">{column.title}</h4>
                <p className="mt-1 text-sm text-text-secondary">{column.subtitle}</p>
                <ul className="mt-5 space-y-3">
                  {column.items.map((item) => (
                    <li key={item} className="flex gap-3 text-sm leading-6 text-text-secondary">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-mb-green" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <>
              <p className="overview-kicker">Baseline</p>
              <h4 className="mt-2 text-xl font-semibold text-text-primary">{column.title}</h4>
              <p className="mt-1 text-sm text-text-secondary">{column.subtitle}</p>
              <ul className="mt-5 space-y-3">
                {column.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-text-secondary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      ))}
    </div>
  )
}

function OverviewNarrativePanel({ problems }: { problems: typeof overviewProblemPoints }) {
  return (
    <section className="overview-block overview-panel overview-narrative">
      <div className="overview-narrative-grid">
        <div className="overview-narrative-problem overview-narrative-pane">
          <span className="overview-narrative-badge overview-narrative-badge-problem">The problem</span>
          <h3 className="overview-heading mt-3 max-w-xl">Clip volume scaled. Editorial lift didn&apos;t.</h3>
          <ul className="overview-narrative-points mt-6">
            {problems.map((point, index) => (
              <li key={point.title} className="overview-narrative-point">
                <span className="overview-narrative-point-index" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug text-text-primary">{point.title}</p>
                  <p className="mt-1.5 text-sm leading-6 text-text-secondary">{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="overview-narrative-solution overview-narrative-pane">
          <span className="overview-narrative-badge overview-narrative-badge-solution">The solution</span>
          <h3 className="overview-heading mt-3 max-w-xl">Semantic lift on the match you already indexed</h3>
          <p className="mt-4 max-w-lg text-sm leading-6 text-text-secondary">
            Index the match once in TwelveLabs. Jockey adds searchable moments, grounded clip analysis, semantic
            highlight lanes, and producer memory on the asset.
          </p>
          <ul className="overview-narrative-benefits mt-6">
            {overviewSolutionBenefits.map((item) => (
              <li key={item} className="overview-narrative-benefit">
                <StrandIcon name="checkmark" className="h-4 w-4 shrink-0 text-mb-green-dark" />
                <span className="text-sm font-medium text-text-primary">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

type OverviewBadgeTone = 'features' | 'architecture' | 'demo'

function OverviewBadgeSectionHeader({
  badge,
  badgeTone,
  title,
  lead,
}: {
  badge: string
  badgeTone: OverviewBadgeTone
  title: string
  lead: string
}) {
  return (
    <header className="overview-badge-header">
      <span className={['overview-section-badge', `overview-section-badge-${badgeTone}`].join(' ')}>
        {badge}
      </span>
      <h3 className="overview-features-title mt-4 text-text-primary">{title}</h3>
      <p className="overview-features-lead mx-auto mt-3 max-w-2xl text-text-secondary">{lead}</p>
    </header>
  )
}

function OverviewFeaturesSection({ features }: { features: typeof overviewFeatures }) {
  return (
    <section>
      <OverviewBadgeSectionHeader
        badge="Features"
        badgeTone="features"
        title="How the app fits together"
        lead="Pick a game, search in Discover, produce on the Dashboard, prompt reels in Jockey, and keep your work on the match asset across sessions."
      />
      <div className="overview-features-grid">
        {features.map((feature) => (
          <article key={feature.title} className="overview-feature-card">
            <span
              className={[
                'inline-flex h-11 w-11 items-center justify-center rounded-xl',
                feature.iconBg,
                feature.iconColor,
              ].join(' ')}
            >
              <StrandIcon name={feature.icon} className="h-5 w-5" />
            </span>
            <h4 className="mt-5 text-base font-semibold leading-snug text-text-primary">{feature.title}</h4>
            <p className="mt-2 flex-1 text-sm leading-6 text-text-secondary">{feature.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function OverviewReservedSlot({
  label,
  detail,
  minHeightClass = 'min-h-[200px] sm:min-h-[220px]',
}: {
  label: string
  detail: string
  minHeightClass?: string
}) {
  return (
    <div className={['overview-reserved', minHeightClass].join(' ')}>
      <StrandIcon name="canvas" className="h-7 w-7 text-text-tertiary" />
      <p className="mt-4 text-sm font-semibold text-text-primary">{label}</p>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-text-secondary">{detail}</p>
    </div>
  )
}

function OverviewClosingPanel() {
  return (
    <section className="overview-closing overview-block relative overflow-hidden">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-mb-green via-mb-orange to-mb-pink" aria-hidden="true" />
      <div className="overview-closing-grid">
        <div className="min-w-0">
          <p className="overview-kicker">Why it matters</p>
          <h3 className="overview-heading mt-3">Less hunting. More conviction on every cut.</h3>
          <p className="overview-lead mt-3">
            Story the feed never tagged becomes searchable. Each edit can be explained from the footage itself. Producer
            context stays on the match so the next session does not start from zero.
          </p>
        </div>
        <OverviewNavButtons variant="closing" />
      </div>
    </section>
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
    const files = Array.from(fileList)
    const oversizedFiles = files.filter((file) => isVideoFile(file) && file.size > MAX_UPLOAD_VIDEO_BYTES)
    const nextFiles = files.filter((file) => isVideoFile(file) && file.size <= MAX_UPLOAD_VIDEO_BYTES)
    setUploadError(
      oversizedFiles.length
        ? uploadSizeLimitMessage(oversizedFiles.length === 1 ? oversizedFiles[0].name : `${oversizedFiles.length} videos`)
        : '',
    )
    if (!nextFiles.length) return
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
    const oversizedFile = selectedFiles.find((item) => item.file.size > MAX_UPLOAD_VIDEO_BYTES)
    if (oversizedFile) {
      setUploadError(uploadSizeLimitMessage(oversizedFile.file.name))
      return
    }
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
  indexVideos,
  loading,
  indexLoading,
  error,
  session,
  onSessionChange,
  onClearSearch,
  onOpenInWorkspace,
  onAnalyzeClip,
}: {
  game: Game | null
  indexVideos: IndexVideo[]
  loading: boolean
  indexLoading: boolean
  error: string
  session: DiscoverSearchSession
  onSessionChange: (patch: Partial<DiscoverSearchSession>) => void
  onClearSearch: () => void
  onOpenInWorkspace: (item: DiscoverItem) => void
  onAnalyzeClip: (item: DiscoverItem) => void
}) {
  const searchRequestRef = useRef(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const { searchQuery, submittedSearchQuery, searchResponse, activePreviewId, searchError } = session
  const normalizedQuery = normalizeSearchText(submittedSearchQuery)
  const trimmedSearchQuery = submittedSearchQuery.trim()
  const draftSearchQuery = searchQuery.trim()
  const hasActiveSearch = Boolean(trimmedSearchQuery || searchResponse || searchError)
  const items = useMemo(() => {
    if (!game) return []
    if (normalizedQuery) return searchResponse ? searchResultItems(game, searchResponse) : []
    return indexReadyDiscoverItems(game, indexVideos, [])
  }, [game, indexVideos, normalizedQuery, searchResponse])
  const resultLabel = normalizedQuery
    ? searchLoading
      ? 'Searching'
      : `${items.length} results`
    : `${items.length} videos`
  const searchSummary = normalizedQuery
    ? searchResponse?.query_interpretation || 'Matching visual and audio evidence in the footage.'
    : 'Search source footage for visual and audio moments that are not captured in the event feed.'

  useEffect(() => {
    if (!normalizedQuery) {
      if (activePreviewId) {
        onSessionChange({ activePreviewId: null })
      }
      return
    }
    if (!activePreviewId) {
      return
    }
    const itemIds = new Set(items.map((item) => item.id))
    if (itemIds.has(activePreviewId)) {
      return
    }
    const firstSearchItem = items.find((item) => item.resultType === 'search')
    onSessionChange({ activePreviewId: firstSearchItem?.id || null })
  }, [activePreviewId, items, normalizedQuery, onSessionChange])

  const submitSearch = useCallback(() => {
    const nextQuery = searchQuery.trim()
    if (nextQuery === trimmedSearchQuery && searchResponse && !searchError) return
    searchRequestRef.current += 1
    onSessionChange({
      submittedSearchQuery: nextQuery,
      searchResponse: null,
      searchError: '',
      activePreviewId: null,
    })
    if (!nextQuery) {
      setSearchLoading(false)
    }
  }, [onSessionChange, searchError, searchQuery, searchResponse, trimmedSearchQuery])

  const updateSearchQuery = useCallback((value: string) => {
    onSessionChange({ searchQuery: value })
  }, [onSessionChange])

  const clearSearch = useCallback(() => {
    searchRequestRef.current += 1
    setSearchLoading(false)
    onClearSearch()
  }, [onClearSearch])

  const selectPreset = useCallback((preset: string) => {
    searchRequestRef.current += 1
    onSessionChange({
      searchQuery: preset,
      submittedSearchQuery: preset,
      searchResponse: null,
      searchError: '',
      activePreviewId: null,
    })
  }, [onSessionChange])

  useEffect(() => {
    if (!game || !trimmedSearchQuery) {
      setSearchLoading(false)
      return
    }

    let active = true
    const controller = new AbortController()
    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    setSearchLoading(true)
    onSessionChange({ searchError: '' })
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
          if (active && requestId === searchRequestRef.current) {
            const searchItems = searchResultItems(game, body)
            const firstPreview = searchItems.find((item) => item.resultType === 'search')
            onSessionChange({
              searchResponse: body,
              searchError: '',
              activePreviewId: firstPreview?.id || null,
            })
          }
        })
        .catch((fetchError: Error) => {
          if (active && requestId === searchRequestRef.current && !controller.signal.aborted) {
            onSessionChange({ searchResponse: null, searchError: fetchError.message })
          }
        })
        .finally(() => {
          if (active && requestId === searchRequestRef.current) {
            setSearchLoading(false)
          }
        })
    }, 360)

    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [game, onSessionChange, trimmedSearchQuery])

  if (error) {
    return (
      <section className="discover-page discover-page--status flex flex-1 items-center justify-center">
        <Notice tone="error" icon="warning" text={error} />
      </section>
    )
  }

  if (loading || !game) {
    return (
      <section className="discover-page discover-page--status flex flex-1 items-center justify-center">
        <div className="discover-page-loading flex items-center gap-3 rounded-md border border-border bg-surface text-sm font-semibold text-text-secondary shadow-[0_1px_2px_rgba(29,28,27,0.035)]">
          <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
          Loading sports videos
        </div>
      </section>
    )
  }

  return (
    <section className="discover-page flex flex-1 bg-background">
      <div className="discover-page-shell mx-auto flex w-full max-w-[1440px] flex-col">
        <header className="discover-page-header">
          <div className="discover-page-intro min-w-0">
            <div className="discover-page-kicker inline-flex items-center rounded-full bg-accent-light font-semibold uppercase text-brand-charcoal">
              Marengo Search
            </div>
            <h2 className="discover-page-title mt-5 max-w-4xl font-semibold leading-tight text-text-primary">
              {normalizedQuery ? submittedSearchQuery : game.label}
            </h2>
            <p className="discover-page-lead mt-3 max-w-3xl text-text-secondary">{searchSummary}</p>
          </div>
        </header>

        <DiscoverSearchPanel
          value={searchQuery}
          onChange={updateSearchQuery}
          onSubmit={submitSearch}
          onClear={clearSearch}
          resultLabel={resultLabel}
          searchLoading={searchLoading}
          canSearch={Boolean(draftSearchQuery) && !searchLoading}
          canClear={hasActiveSearch && !searchLoading}
          presets={marengoSearchPresets}
          onPresetSelect={selectPreset}
        />

        <section className="discover-page-results min-w-0">
          <div className="discover-page-results-bar">
            <div className="discover-page-results-label inline-flex items-center gap-3 font-semibold uppercase text-text-tertiary">
              <StrandIcon name={searchLoading ? 'spinner' : 'search'} className={['h-4 w-4 shrink-0', searchLoading ? 'animate-spin' : ''].join(' ')} />
              <span>{resultLabel} · click to open</span>
            </div>
          </div>

          {searchError && (
            <div className="discover-page-error mb-4">
              <Notice tone="error" icon="warning" text={searchError} />
            </div>
          )}

          {indexLoading && !normalizedQuery && items.length === 0 ? (
            <div className="discover-page-state flex min-h-[320px] items-center justify-center rounded-md border border-border bg-card text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-text-secondary">
                  <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-text-primary">Loading indexed videos</h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">Fetching ready videos from the TwelveLabs index.</p>
              </div>
            </div>
          ) : searchLoading && items.length === 0 ? (
            <div className="discover-page-state flex min-h-[320px] items-center justify-center rounded-md border border-border bg-card text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-text-secondary">
                  <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-text-primary">Searching video</h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">Matching the query against visual and audio evidence.</p>
              </div>
            </div>
          ) : items.length > 0 ? (
            <div className="discover-page-grid">
              {items.map((item) => (
                <DiscoverResultCard
                  key={item.id}
                  item={item}
                  onOpenInWorkspace={onOpenInWorkspace}
                  onAnalyzeClip={onAnalyzeClip}
                  isPreviewActive={activePreviewId === item.id}
                  onTogglePreview={() => {
                    onSessionChange({
                      activePreviewId: activePreviewId === item.id ? null : item.id,
                    })
                  }}
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
  onClear,
  resultLabel,
  searchLoading,
  canSearch,
  canClear,
  presets,
  onPresetSelect,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onClear: () => void
  resultLabel: string
  searchLoading: boolean
  canSearch: boolean
  canClear: boolean
  presets: string[]
  onPresetSelect: (value: string) => void
}) {
  return (
    <div data-tour-id="marengo-search" className="discover-search-panel">
      <label htmlFor="discover-search" className="sr-only">
        Search source videos
      </label>
      <div className="discover-search-main">
        <div className="discover-search-field">
          <div className="discover-search-input-wrap rounded-md border border-border bg-surface focus-within:border-accent">
            <StrandIcon name={searchLoading ? 'spinner' : 'search'} className={['discover-search-input-icon shrink-0 text-text-tertiary', searchLoading ? 'animate-spin' : ''].join(' ')} />
            <input
              id="discover-search"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSubmit()
                if (event.key === 'Escape') onClear()
              }}
              className="discover-search-input min-w-0 flex-1 bg-transparent font-medium text-text-primary outline-none placeholder:text-text-tertiary"
              placeholder="Search visual/audio moments - player celebration, crowd roar, diving save..."
            />
            {value && (
              <button
                type="button"
                onClick={onClear}
                className="discover-search-clear flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-text-secondary hover:border-accent hover:text-brand-charcoal"
                aria-label="Clear search"
                title="Clear search"
              >
                <StrandIcon name="close" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="discover-search-actions">
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSearch}
              className={[
                'discover-search-submit inline-flex items-center justify-center gap-2 rounded-md border font-semibold',
                canSearch
                  ? 'border-brand-charcoal bg-brand-charcoal text-white hover:border-brand-charcoal hover:bg-brand-charcoal'
                  : 'cursor-not-allowed border-border bg-card text-text-tertiary',
              ].join(' ')}
            >
              <StrandIcon name="search" className="h-4 w-4 shrink-0" />
              <span>Search</span>
            </button>
            {canClear && (
              <button
                type="button"
                onClick={onClear}
                className="discover-search-reset inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
              >
                <StrandIcon name="close" className="h-4 w-4 shrink-0" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>
        <div className="discover-search-presets">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onPresetSelect(preset)}
              className="discover-search-preset inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-surface font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            >
              <StrandIcon name="search-v2" className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">{preset}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="discover-search-meta font-semibold uppercase text-text-tertiary">
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
  onAnalyzeClip,
  isPreviewActive,
  onTogglePreview,
}: {
  item: DiscoverItem
  onOpenInWorkspace: (item: DiscoverItem) => void
  onAnalyzeClip: (item: DiscoverItem) => void
  isPreviewActive: boolean
  onTogglePreview: () => void
}) {
  const category = item.categoryKey ? mapLanes.find((lane) => lane.key === item.categoryKey) : null
  const isMomentResult = item.resultType === 'moment' || item.resultType === 'search'
  const canOpen = Boolean(item.videoName)
  const canPreviewSegment = item.resultType === 'search' && Boolean(item.media && item.searchMoment && item.startTime)
  const actionLabel = item.resultType === 'search'
    ? `Analyze clip in Dashboard for ${item.videoName}`
    : isMomentResult
      ? `Open moment in ${item.videoName}`
      : `Open details for ${item.videoName}`
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
  const showLabel = item.label !== 'Indexed Video' && item.resultType !== 'search'
  const showSubtitle = Boolean(item.subtitle && item.subtitle.toLowerCase() !== 'ready')

  return (
    <article className="discover-result-card group flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
      <div className="discover-result-media relative m-2.5 overflow-hidden rounded-md border border-border-light bg-card">
        {canPreviewSegment && isPreviewActive ? (
          <div className="aspect-video">
            <TwelveLabsVideoPlayer
              key={item.media}
              streamInfoUrl={item.media}
              startSeconds={previewStartSeconds}
              endSeconds={previewEndSeconds}
              posterUrl={item.poster}
              segmentRange={segmentRange}
              variant="minimal"
              autoPlay
              muted
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

      <div className="discover-result-body flex flex-1 flex-col px-4 pb-4 pt-1">
        <div className="discover-result-copy flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {showLabel && <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">{item.label}</p>}
            <h4 className={['discover-result-title', showLabel ? 'mt-1.5' : '', 'line-clamp-2 font-semibold leading-6 text-text-primary'].join(' ')}>{item.title}</h4>
            {showSubtitle && <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-text-secondary">{item.subtitle}</p>}
          </div>
        </div>

        {item.resultType === 'search' && primaryMatch?.text && (
          <div className="mt-3 rounded-md border border-border-light px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Transcription</p>
            <p className="mt-1.5 text-sm font-medium leading-5 text-text-primary">
              {primaryMatch.text}
            </p>
          </div>
        )}

        {item.resultType === 'search' && item.searchRank != null && (
          <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            Rank #{item.searchRank}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {category && <DiscoverBadge icon={category.icon}>{category.label}</DiscoverBadge>}
          {item.sourceType && <DiscoverBadge icon="vision">{sourceLabel(item.sourceType)}</DiscoverBadge>}
        </div>

        {item.resultType !== 'search' && (
          <DiscoverMatchList heading={item.matchHeading} matches={item.matches} />
        )}

        {item.resultType === 'search' && (
          <div className="discover-result-actions mt-auto flex flex-wrap gap-2 pt-3">
            <button
              type="button"
              data-tour-id="analyze-clip"
              onClick={() => {
                onAnalyzeClip(item)
                window.dispatchEvent(new CustomEvent(TUTORIAL_ANALYZE_CLIP_EVENT))
              }}
              disabled={!canOpen}
              className="discover-result-action inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal disabled:cursor-not-allowed disabled:opacity-60"
            >
              <StrandIcon name="analyze" className="h-4 w-4" />
              Analyze Clip
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
    <div className="mt-3 border-t border-border-light pt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary">{heading}</p>
      <div className="mt-2 flex flex-col gap-2">
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
    <div className="discover-page-state discover-page-empty flex min-h-[320px] items-center justify-center rounded-md border border-dashed border-border bg-card text-center">
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
  manifestUrl,
  startSeconds,
  endSeconds,
  posterUrl,
  onDuration,
  onRangeComplete,
  onStatusChange,
  onPlayingChange,
  segmentRange,
  variant = 'default',
  fit = 'contain',
  autoPlay = false,
  muted = false,
  showSegmentControls = true,
  showStatusOverlay = true,
  statusOverlayStyle = 'message',
}: {
  streamInfoUrl?: string
  manifestUrl?: string
  startSeconds: number
  endSeconds?: number
  posterUrl?: string
  onDuration?: (duration: number) => void
  onRangeComplete?: () => void
  onStatusChange?: (status: 'loading' | 'ready' | 'error') => void
  onPlayingChange?: (playing: boolean) => void
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
  const [bufferedSeconds, setBufferedSeconds] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const hasSegmentRange = Boolean(segmentRange)

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
    let handleProgress: (() => void) | null = null
    let handlePlay: (() => void) | null = null
    let handlePause: (() => void) | null = null
    let handleWaiting: (() => void) | null = null
    let handleCanPlay: (() => void) | null = null
    let readyFallbackTimer: number | null = null
    let rangeCompleted = false
    let readyFrame = false
    let warmingFirstFrame = false
    let mutedBeforeWarm = muted
    let readinessPoll: number | null = null
    let fatalRecoveryAttempts = 0
    const controller = new AbortController()
    const startLoadAt = Math.max(0, startSeconds)
    const segmentEnd = endSeconds && endSeconds > startLoadAt ? endSeconds : startLoadAt + 12
    const lightPlayback = variant === 'minimal'
    const segmentBufferLength = hasSegmentRange
      ? clamp(segmentEnd - startLoadAt + HLS_SEGMENT_BUFFER_PADDING_SECONDS, lightPlayback ? 5 : 7, lightPlayback ? 8 : HLS_DEFAULT_BUFFER_SECONDS)
      : HLS_DEFAULT_BUFFER_SECONDS
    const resetVideoElement = () => {
      video.pause()
      video.removeAttribute('src')
      video.srcObject = null
      video.load()
    }
    const stopHls = () => {
      if (!hls) return
      try {
        hls.stopLoad()
      } catch {
        // hls.js can throw if the instance is already detached during a fast switch.
      }
      try {
        hls.detachMedia()
      } catch {
        // Detach is best-effort cleanup before destroy.
      }
      hls.destroy()
      hls = null
    }

    setStatus('loading')
    setMessage(manifestUrl ? 'Loading TwelveLabs HLS stream...' : 'Resolving TwelveLabs stream...')
    setDurationSeconds(0)
    setCurrentSeconds(startSeconds)
    setBufferedSeconds(0)
    setBuffering(false)
    setPlaying(false)
    onDuration?.(0)
    resetVideoElement()

    const streamPromise = manifestUrl
      ? Promise.resolve(manifestUrl)
      : streamInfoUrl
        ? fetchTwelveLabsStreamInfo(streamInfoUrl, controller.signal)
            .then((stream) => {
              if (stream.provider !== 'twelvelabs' || stream.type !== 'hls' || !stream.manifest_url) {
                throw new Error('TwelveLabs stream response did not include a playable HLS manifest')
              }
              const resolvedManifestUrl = secureHttpsUrl(stream.manifest_url)
              if (!resolvedManifestUrl) {
                throw new Error('TwelveLabs stream response did not include a secure HLS manifest')
              }
              return resolvedManifestUrl
            })
        : Promise.reject(new Error('No TwelveLabs stream source was provided'))

    streamPromise
      .then((hlsManifestUrl) => {
        if (disposed) return
        preconnectManifestOrigin(hlsManifestUrl)
        warmHlsManifest(hlsManifestUrl)
        setMessage('Loading HLS manifest...')
        const playWhenReady = () => {
          if (!autoPlay || disposed) return
          video.play().catch(() => undefined)
        }
        const updateBufferedSeconds = () => {
          if (disposed || !video.buffered.length) return
          const target = Math.max(video.currentTime || startLoadAt, startLoadAt)
          for (let index = 0; index < video.buffered.length; index += 1) {
            const start = video.buffered.start(index)
            const end = video.buffered.end(index)
            if (target >= start - 0.2 && target <= end + 0.2) {
              setBufferedSeconds(end)
              return
            }
          }
          setBufferedSeconds(video.buffered.end(video.buffered.length - 1))
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
          if (readyFallbackTimer !== null) {
            window.clearTimeout(readyFallbackTimer)
            readyFallbackTimer = null
          }
          setStatus('ready')
          setMessage('')
          setBuffering(false)
          updateBufferedSeconds()
          playWhenReady()
          finishWarmup()
        }

        handleMetadata = () => {
          if (disposed) return
          const duration = Number.isFinite(video.duration) ? video.duration : 0
          setDurationSeconds(duration)
          onDuration?.(duration)
          const seekedSeconds = seekVideoTo(video, startLoadAt, duration)
          setCurrentSeconds(seekedSeconds)
          setMessage('Buffering first frame...')
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markReady()
        }
        handleReadyFrame = () => {
          markReady()
        }
        handleTimeUpdate = () => {
          if (disposed) return
          setCurrentSeconds(video.currentTime)
          updateBufferedSeconds()
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
            setCurrentSeconds(seekVideoTo(video, startSeconds))
          }
          if (video.currentTime < startSeconds - 0.15) {
            setCurrentSeconds(seekVideoTo(video, startSeconds))
          }
          setBuffering(false)
          setPlaying(true)
          if (!warmingFirstFrame) onPlayingChange?.(true)
        }
        handlePause = () => {
          if (!disposed) {
            setPlaying(false)
            if (!rangeCompleted && !warmingFirstFrame) onPlayingChange?.(false)
          }
        }
        handleProgress = () => {
          updateBufferedSeconds()
          if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) setBuffering(false)
        }
        handleWaiting = () => {
          if (disposed) return
          if (readyFrame && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return
          setBuffering(true)
          setMessage('Buffering HLS stream...')
        }
        handleCanPlay = () => {
          if (disposed) return
          setBuffering(false)
          updateBufferedSeconds()
          markReady()
        }
        video.addEventListener('loadedmetadata', handleMetadata)
        video.addEventListener('loadeddata', handleReadyFrame)
        video.addEventListener('canplay', handleReadyFrame)
        video.addEventListener('timeupdate', handleTimeUpdate)
        video.addEventListener('progress', handleProgress)
        video.addEventListener('play', handlePlay)
        video.addEventListener('pause', handlePause)
        video.addEventListener('waiting', handleWaiting)
        video.addEventListener('stalled', handleWaiting)
        video.addEventListener('canplay', handleCanPlay)
        video.addEventListener('canplaythrough', handleCanPlay)
        readinessPoll = window.setInterval(() => {
          if (disposed || readyFrame) return
          if (video.readyState >= 2 || video.currentTime > 0) markReady()
        }, 250)

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = hlsManifestUrl
          video.load()
          warmFirstFrame()
          playWhenReady()
          return
        }

        if (Hls.isSupported()) {
          hls = new Hls({
            autoStartLoad: false,
            startPosition: startLoadAt,
            startLevel: -1,
            enableWorker: true,
            capLevelToPlayerSize: true,
            capLevelOnFPSDrop: true,
            testBandwidth: true,
            progressive: true,
            startFragPrefetch: !lightPlayback,
            maxStarvationDelay: lightPlayback ? 1 : 2,
            maxLoadingDelay: lightPlayback ? 1 : 2,
            manifestLoadingMaxRetry: 4,
            levelLoadingMaxRetry: 4,
            fragLoadingMaxRetry: 4,
            abrEwmaDefaultEstimate: lightPlayback ? 900_000 : 1_600_000,
            maxBufferLength: segmentBufferLength,
            maxMaxBufferLength: Math.max(segmentBufferLength, lightPlayback ? 10 : 18),
            maxBufferSize: lightPlayback ? Math.min(HLS_MAX_BUFFER_BYTES, 8 * 1000 * 1000) : HLS_MAX_BUFFER_BYTES,
            backBufferLength: hasSegmentRange || lightPlayback ? 0 : 6,
            lowLatencyMode: false,
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || disposed) return
            if (fatalRecoveryAttempts < HLS_FATAL_RECOVERY_ATTEMPTS && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              fatalRecoveryAttempts += 1
              setMessage('Recovering TwelveLabs stream...')
              hls?.startLoad(Math.max(video.currentTime || startLoadAt, startLoadAt))
              return
            }
            if (fatalRecoveryAttempts < HLS_FATAL_RECOVERY_ATTEMPTS && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              fatalRecoveryAttempts += 1
              setMessage('Recovering TwelveLabs stream...')
              hls?.recoverMediaError()
              return
            }
            setStatus('error')
            setMessage('TwelveLabs HLS stream could not be played in this browser')
            stopHls()
          })
          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            if (!disposed) hls?.loadSource(hlsManifestUrl)
          })
          hls.on(Hls.Events.MANIFEST_LOADED, () => {
            if (!disposed) setMessage('Preparing HLS levels...')
          })
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (disposed) return
            fatalRecoveryAttempts = 0
            setMessage('Buffering first frame...')
            hls?.startLoad(startLoadAt)
            warmFirstFrame()
            playWhenReady()
            if (variant === 'minimal') {
              readyFallbackTimer = window.setTimeout(() => {
                if (!disposed && !readyFrame && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
                  markReady()
                }
              }, 1800)
            }
          })
          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            if (!disposed) markReady()
          })
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
      if (readyFallbackTimer !== null) window.clearTimeout(readyFallbackTimer)
      if (handleMetadata) video.removeEventListener('loadedmetadata', handleMetadata)
      if (handleReadyFrame) {
        video.removeEventListener('loadeddata', handleReadyFrame)
        video.removeEventListener('canplay', handleReadyFrame)
      }
      if (handleTimeUpdate) video.removeEventListener('timeupdate', handleTimeUpdate)
      if (handleProgress) video.removeEventListener('progress', handleProgress)
      if (handlePlay) video.removeEventListener('play', handlePlay)
      if (handlePause) video.removeEventListener('pause', handlePause)
      if (handleWaiting) {
        video.removeEventListener('waiting', handleWaiting)
        video.removeEventListener('stalled', handleWaiting)
      }
      if (handleCanPlay) {
        video.removeEventListener('canplay', handleCanPlay)
        video.removeEventListener('canplaythrough', handleCanPlay)
      }
      stopHls()
      resetVideoElement()
    }
  }, [autoPlay, hasSegmentRange, manifestUrl, muted, streamInfoUrl, startSeconds, endSeconds, onDuration, onPlayingChange, onRangeComplete, variant])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (autoPlay) {
      if (status === 'ready') {
        if (endSeconds && endSeconds > startSeconds && video.currentTime >= endSeconds - 0.15) {
          setCurrentSeconds(seekVideoTo(video, startSeconds))
        }
        if (video.currentTime < startSeconds - 0.15) {
          setCurrentSeconds(seekVideoTo(video, startSeconds))
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
        setCurrentSeconds(seekVideoTo(video, startSeconds))
      }
      if (video.currentTime < startSeconds - 0.15) {
        setCurrentSeconds(seekVideoTo(video, startSeconds))
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
    setCurrentSeconds(seekVideoTo(video, seekStart + ratio * Math.max(1, seekEnd - seekStart), seekEnd))
  }, [durationSeconds, endSeconds, segmentRange, startSeconds, status])

  const segmentEndSeconds = segmentRange
    ? Math.max(segmentRange.endSeconds ?? segmentRange.startSeconds + 1, segmentRange.startSeconds + 1)
    : Math.max(durationSeconds, endSeconds || startSeconds + 1, 1)
  const bufferStartSeconds = segmentRange ? segmentRange.startSeconds : 0
  const bufferedPercent = clamp(
    ((bufferedSeconds - bufferStartSeconds) / Math.max(1, segmentEndSeconds - bufferStartSeconds)) * 100,
    0,
    100,
  )
  const showLoaderOverlay = showStatusOverlay && (status !== 'ready' || buffering)

  return (
    <div className="relative h-full w-full min-w-0">
      <video
        ref={videoRef}
        className={['h-full w-full min-w-0 accent-accent', fit === 'cover' ? 'object-cover' : 'object-contain'].join(' ')}
        controls={!segmentRange}
        muted={muted}
        playsInline
        preload={hasSegmentRange || autoPlay ? 'auto' : 'metadata'}
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
      {showLoaderOverlay && (
        <div
          className={[
            'pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center',
            status === 'ready' ? 'bg-brand-charcoal/36 text-white backdrop-blur-[1px]' : variant === 'minimal' ? 'bg-brand-charcoal/74 text-white backdrop-blur-[2px]' : 'bg-surface/96 text-text-primary',
          ].join(' ')}
        >
          {statusOverlayStyle === 'loader' ? (
            <div className="min-w-[170px] rounded-md border border-white/20 bg-brand-charcoal/82 px-3 py-2 text-white shadow-[0_8px_20px_rgba(0,0,0,0.24)]">
              <div className="flex items-center justify-center gap-2">
                <StrandIcon name={status === 'error' ? 'warning' : 'spinner'} className={['h-4 w-4', status !== 'error' ? 'animate-spin' : ''].join(' ')} />
                <span className="text-xs font-semibold">{status === 'error' ? message : buffering ? 'Buffering HLS' : 'Preparing reel'}</span>
              </div>
              {status !== 'error' && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/18">
                  <span className="block h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${Math.max(bufferedPercent, status === 'loading' ? 16 : 0)}%` }} />
                </div>
              )}
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
  hasCachedHighlightMetadata,
  hasCachedEntityTrackingMetadata,
  hasCachedClipAnalysisMetadata,
  reels,
  activeVideoName,
  selectedSearchMoment,
  selectedClipAnalysis,
  selectedClipAnalysisLoading,
  selectedClipAnalysisError,
  entityTracking,
  entityTrackingLoading,
  entityTrackingError,
  onOpenDiscover,
  onClearSelectedClip,
}: {
  loadingGames: boolean
  gamesError: string
  reelsError: string
  isLoadingReels: boolean
  isLoadingIndexVideos: boolean
  indexVideosError: string
  selectedGame: Game | null
  workspaceVideoCount: number
  hasCachedHighlightMetadata: boolean
  hasCachedEntityTrackingMetadata: boolean
  hasCachedClipAnalysisMetadata: boolean
  reels?: HighlightReels
  activeVideoName?: string
  selectedSearchMoment?: SearchMoment | null
  selectedClipAnalysis?: SelectedClipAnalysis
  selectedClipAnalysisLoading: boolean
  selectedClipAnalysisError: string
  entityTracking?: EntityTrackingResponse
  entityTrackingLoading: boolean
  entityTrackingError: string
  onOpenDiscover: () => void
  onClearSelectedClip: () => void
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
  if (selectedSearchMoment) {
    return (
      <section className="overflow-hidden rounded-md border border-border bg-white shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
        <div className="grid gap-4 bg-white px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selected video</p>
            <div className="mt-1 flex min-w-0 items-center gap-3">
              <StrandIcon name="play-boxed" className="h-5 w-5 shrink-0 text-accent" />
              <h2 className="truncate text-xl font-semibold text-text-primary">{activeVideoName}</h2>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-sm border border-border-light bg-surface px-2 py-1 text-xs font-semibold text-text-secondary">
                {selectedSearchMoment.title}
              </span>
              {selectedSearchMoment.startTime && (
                <span className="rounded-sm border border-accent/30 bg-accent-light px-2 py-1 font-mono text-[11px] font-semibold text-brand-charcoal">
                  {selectedSearchMoment.startTime}{selectedSearchMoment.endTime ? ` - ${selectedSearchMoment.endTime}` : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClearSelectedClip}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            >
              <StrandIcon name="close" className="h-4 w-4" />
              Clear
            </button>
            <button
              type="button"
              onClick={onOpenDiscover}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            >
              <StrandIcon name="search" className="h-4 w-4" />
              Discover Videos
            </button>
          </div>
        </div>
      </section>
    )
  }
  if (reelsError) {
    return <Notice tone="error" icon="warning" text={reelsError} />
  }
  if (isLoadingReels) {
    return (
      <Notice
        tone="neutral"
        icon="spinner"
        text={
          hasCachedHighlightMetadata
            ? `Loading saved Jockey analysis for ${activeVideoName}`
            : `Generating Jockey analysis for ${activeVideoName}. First visit can take 1-2 minutes.`
        }
      />
    )
  }
  if (reels) {
    const enhancedCount =
      reels.best_plays.clips.length +
      reels.emotional_moments.clips.length +
      reels.fan_experience.clips.length +
      reels.behind_the_scenes.clips.length
    return (
      <section className="overflow-hidden rounded-md border border-border bg-white shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
        <div className="grid gap-4 bg-white px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
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
        <div className="border-t border-border-light bg-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <StrandIcon name="document-list" className="h-4 w-4 shrink-0 text-accent" />
            <h3 className="truncate text-base font-semibold text-text-primary">Analysis Summary</h3>
          </div>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-text-secondary">
            {displayAnalysisSummary(reels.match_summary)}
          </p>
        </div>
        {selectedSearchMoment && (
          <SelectedClipAnalysisSection
            game={selectedGame}
            searchMoment={selectedSearchMoment}
            analysis={selectedClipAnalysis}
            loading={selectedClipAnalysisLoading}
            error={selectedClipAnalysisError}
          />
        )}
      </section>
    )
  }
  return (
    <Notice
      tone="neutral"
      icon="hourglass"
      text={
        activeVideoName
          ? `Analysis for ${activeVideoName} has not loaded yet. Make sure the backend is running on port 5000, then retry.`
          : 'Select an indexed video to open its analysis'
      }
    />
  )
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

function DiscoverClipAnalysisModal({
  game,
  searchMoment,
  analysis,
  loading,
  error,
  hasCachedMetadata,
  workspaceMetadata,
  workspaceMetadataLoading,
  workspaceMetadataError,
  onClose,
  onOpenDashboard,
}: {
  game: Game
  searchMoment: SearchMoment
  analysis?: SelectedClipAnalysis
  loading: boolean
  error: string
  hasCachedMetadata: boolean
  workspaceMetadata?: JockeyWorkspaceMetadataResponse
  workspaceMetadataLoading: boolean
  workspaceMetadataError: string
  onClose: () => void
  onOpenDashboard: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 px-3 py-4 backdrop-blur-sm sm:px-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discover-clip-analysis-title"
    >
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-md border border-border bg-white shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border-light bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent-light text-brand-charcoal">
              <StrandIcon name="analyze" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">Discover clip analysis</p>
              <h2 id="discover-clip-analysis-title" className="truncate text-base font-semibold text-text-primary">
                {searchMoment.title || searchMoment.videoName}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenDashboard}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-brand-charcoal bg-brand-charcoal px-3 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(29,28,27,0.22)] transition hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_12px_24px_rgba(29,28,27,0.28)] focus:outline-none focus:ring-2 focus:ring-brand-charcoal/30"
            >
              <StrandIcon name="arrow-diagonal" className="h-4 w-4" />
              Open Dashboard
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
              aria-label="Close clip analysis"
              title="Close"
            >
              <StrandIcon name="close" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto bg-background p-3 sm:p-4">
          <SelectedClipAnalysisSection
            game={game}
            searchMoment={searchMoment}
            analysis={analysis}
            loading={loading}
            error={error}
            hasCachedMetadata={hasCachedMetadata}
            workspaceMetadata={workspaceMetadata}
            workspaceMetadataLoading={workspaceMetadataLoading}
            workspaceMetadataError={workspaceMetadataError}
            onBackToSearch={onClose}
          />
        </div>
      </div>
    </div>
  )
}

function SelectedClipAnalysisSection({
  game,
  searchMoment,
  analysis,
  loading,
  error,
  hasCachedMetadata = false,
  workspaceMetadata,
  workspaceMetadataLoading = false,
  workspaceMetadataError = '',
  onBackToSearch,
}: {
  game: Game | null
  searchMoment: SearchMoment
  analysis?: SelectedClipAnalysis
  loading: boolean
  error: string
  hasCachedMetadata?: boolean
  workspaceMetadata?: JockeyWorkspaceMetadataResponse
  workspaceMetadataLoading?: boolean
  workspaceMetadataError?: string
  onBackToSearch?: () => void
}) {
  const evidenceRows = analysis
    ? [
        { label: 'Visual', icon: 'vision', values: analysis.visual_evidence },
        { label: 'Audio', icon: 'volume-mid', values: analysis.audio_evidence },
        { label: 'Transcript', icon: 'transcription', values: analysis.transcript_evidence },
      ].filter((row) => row.values.length)
    : []
  const clipStartSeconds = searchMoment.startTime ? secondsFromTime(searchMoment.startTime) : 0
  const clipEndSeconds = searchMoment.endTime ? secondsFromTime(searchMoment.endTime) : undefined
  const clipStreamInfoUrl = game ? streamInfoForSearchMoment(game, searchMoment) : null
  const clipSegmentRange: SegmentRange | undefined = searchMoment.startTime
    ? {
        startSeconds: clipStartSeconds,
        endSeconds: clipEndSeconds,
        startLabel: searchMoment.startTime,
        endLabel: searchMoment.endTime,
      }
    : undefined
  const showVideoMetadataPanel = Boolean(!loading && (workspaceMetadata || workspaceMetadataError || analysis || hasCachedMetadata))
  return (
    <section
      id="selected-clip-analysis"
      data-tour-id="selected-clip-analysis"
      tabIndex={-1}
      className="scroll-mt-40 overflow-hidden rounded-md border border-brand-charcoal/50 bg-white shadow-[0_12px_30px_rgba(29,28,27,0.055)] outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <div className="grid gap-3 bg-white px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand-charcoal/50 bg-white text-brand-charcoal">
            <StrandIcon name="analyze" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">Pegasus 1.5</p>
            <h3 className="truncate text-base font-semibold text-text-primary">Selected Clip Analysis</h3>
            <p className="mt-1 truncate text-sm font-medium text-text-secondary">
              {searchMoment.title}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-sm border border-brand-charcoal bg-white px-2 py-1 font-mono text-[11px] font-semibold text-text-tertiary">
            {searchMoment.startTime}{searchMoment.endTime ? ` - ${searchMoment.endTime}` : ''}
          </span>
          {analysis && (
            <span className="rounded-sm border border-brand-charcoal/50 bg-white px-2 py-1 font-mono text-[11px] font-semibold text-brand-charcoal">
              Conf. {confidenceLabel(analysis.confidence)}
            </span>
          )}
        </div>
      </div>

      <div className="grid min-w-0 xl:grid-cols-[minmax(330px,0.72fr)_minmax(0,1.28fr)] xl:items-start">
        <div className="min-w-0 bg-white xl:sticky xl:top-[calc(var(--sj-explainability-top)+8px)]">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selected Search Clip</p>
            <span className="shrink-0 rounded-sm border border-brand-charcoal bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-tertiary">
              {searchMoment.startTime}{searchMoment.endTime ? ` - ${searchMoment.endTime}` : ''}
            </span>
          </div>
          <div className="aspect-video bg-white">
            {clipStreamInfoUrl ? (
              <TwelveLabsVideoPlayer
                key={clipStreamInfoUrl || `${searchMoment.videoName}-${searchMoment.startTime || 'start'}-${searchMoment.endTime || 'end'}`}
                streamInfoUrl={clipStreamInfoUrl}
                startSeconds={clipStartSeconds}
                endSeconds={clipEndSeconds}
                posterUrl={game ? thumbnailForVideoName(game, searchMoment.videoName) : undefined}
                segmentRange={clipSegmentRange}
                variant="minimal"
                showSegmentControls
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm font-semibold text-text-secondary">
                Selected clip playback is unavailable.
              </div>
            )}
          </div>
          <div className="bg-white px-3 py-3">
            <SelectedClipContextPanel
              searchMoment={searchMoment}
              analysis={analysis}
              loading={loading}
              onBackToSearch={onBackToSearch}
            />
            {showVideoMetadataPanel && (
              <div className="mt-3">
                <SelectedClipVideoMetadataPanel
                  metadata={workspaceMetadata}
                  loading={workspaceMetadataLoading}
                  error={workspaceMetadataError}
                  searchMoment={searchMoment}
                  analysis={analysis}
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid min-w-0 gap-3 bg-white p-3">
          <section className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-brand-charcoal/50 bg-white text-brand-charcoal">
                  <StrandIcon name="vision" className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">Pegasus 1.5 Response</p>
                </div>
              </div>
              <SelectedClipAnalysisSaveButton game={game} searchMoment={searchMoment} analysis={analysis} />
            </div>
            {loading ? (
              <SelectedClipAnalysisLoader />
            ) : analysis ? (
              <div className="grid gap-3">
                <SelectedClipNarrative analysis={analysis} />
                <SelectedClipSignalBoard analysis={analysis} />
                <div className="grid gap-2 2xl:grid-cols-[minmax(0,0.92fr)_minmax(260px,0.72fr)]">
                  <SelectedClipTagShelf
                    momentTypes={analysis.moment_types}
                    producerTags={analysis.tags}
                    recommendedFormats={analysis.recommended_formats}
                  />
                  <SelectedClipParticipants participants={analysis.participants} />
                </div>
                <div className="grid gap-2 xl:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)]">
                  <div className="grid min-w-0 gap-2">
                    <SelectedClipNote icon="hourglass" label="Boundaries" value={analysis.clip_boundary_notes} />
                    <SelectedClipNote icon="warning" label="Review notes" value={analysis.rights_safety_notes} />
                  </div>
                  <SelectedClipEvidenceGroup rows={evidenceRows} />
                </div>
              </div>
            ) : error ? (
              <div className="rounded-md border border-error bg-error-light px-3 py-2 text-sm font-semibold text-error-dark">
                {error}
              </div>
            ) : (
              <p className="text-sm font-semibold text-text-tertiary">Choose Analyze from Discover to run Pegasus 1.5 on a selected clip.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

function SelectedClipContextPanel({
  searchMoment,
  analysis,
  loading,
  onBackToSearch,
}: {
  searchMoment: SearchMoment
  analysis?: SelectedClipAnalysis
  loading: boolean
  onBackToSearch?: () => void
}) {
  const rangeLabel = `${searchMoment.startTime}${searchMoment.endTime ? ` - ${searchMoment.endTime}` : ''}`
  const queryLabel = cleanString(searchMoment.query) || cleanString(searchMoment.title) || 'Search result'
  const statusLabel = loading ? 'Pegasus reading' : analysis ? `Confidence ${confidenceLabel(analysis.confidence)}` : 'Ready'
  const facts = [
    { icon: 'search-v2', label: 'Search', value: queryLabel },
    { icon: 'hourglass', label: 'Range', value: rangeLabel },
    { icon: 'document', label: 'Source', value: cleanVideoCardTitle(searchMoment.videoName) },
    { icon: analysis ? 'checkmark' : loading ? 'spinner' : 'info', label: 'Status', value: statusLabel, loading },
  ]

  return (
    <section className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Clip context</p>
          <h4 className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-text-primary">{searchMoment.title}</h4>
        </div>
        {onBackToSearch ? (
          <button
            type="button"
            onClick={onBackToSearch}
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-border-light bg-card px-2.5 text-xs font-semibold text-text-secondary transition hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
          >
            Search
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 rounded-md border border-border-light bg-card px-2.5 py-2">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{fact.label}</p>
            <p className="mt-0.5 truncate text-xs font-semibold text-text-primary">{fact.value}</p>
          </div>
        ))}
      </div>
      {analysis?.key_action ? (
        <div className="mt-3 rounded-md border border-accent/35 bg-card px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-charcoal">Key action</p>
          </div>
          <p className="mt-1 line-clamp-3 text-sm font-semibold leading-5 text-text-primary">{analysis.key_action}</p>
        </div>
      ) : null}
    </section>
  )
}

function SelectedClipVideoMetadataPanel({
  metadata,
  loading,
  error,
  searchMoment,
  analysis,
}: {
  metadata?: JockeyWorkspaceMetadataResponse
  loading: boolean
  error: string
  searchMoment: SearchMoment
  analysis?: SelectedClipAnalysis
}) {
  const items = savedWorkspaceItems(metadata)
  const clipItems = savedWorkspaceItemsByKind(items, 'clip_analysis')
  const turnItems = savedWorkspaceItemsByKind(items, 'jockey_turn')
  const counts = metadata?.summary?.counts || {}
  const total = counts.total ?? items.length
  const hasMetadata = Boolean(metadata)
  const matchingClipItem = selectedSearchClipWorkspaceItem(metadata, searchMoment)
  const storedByCurrentAnalysis = Boolean(analysis?._jockey_metadata?.stored_to_user_metadata)
  const clipStatus = matchingClipItem
    ? {
        icon: 'checkmark',
        tone: 'ready',
        label: 'Selected clip metadata found',
        detail: matchingClipItem.saved_at ? `Saved ${formatWorkspaceSavedAt(matchingClipItem.saved_at)}` : 'Already saved on the source video.',
      }
    : storedByCurrentAnalysis
      ? {
          icon: 'checkmark',
          tone: 'ready',
          label: 'Selected clip metadata saved',
          detail: 'Pegasus generated and stored this clip metadata. Refreshing whole-video metadata in the background.',
        }
      : !hasMetadata
        ? {
            icon: loading ? 'spinner' : 'info',
            tone: loading ? 'loading' : 'pending',
            label: loading ? 'Checking selected clip metadata' : 'Whole-video metadata pending',
            detail: loading
              ? 'Reading whole-video metadata from the indexed asset before Pegasus runs.'
              : 'The source metadata has not returned yet, so the exact selected-clip entry cannot be checked.',
          }
      : {
          icon: loading ? 'spinner' : 'info',
          tone: loading ? 'loading' : 'pending',
          label: loading ? 'Checking selected clip metadata' : 'No saved clip metadata for this timestamp yet',
          detail: loading
            ? 'Reading whole-video metadata from the indexed asset before Pegasus runs.'
            : 'Pegasus 1.5 will generate the selected-clip metadata for this exact search result.',
        }
  const latestItem = items[0]
  const latestSummary = latestItem ? savedWorkspaceItemSummary(latestItem) : null

  return (
    <section className="rounded-md border border-border-light bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">Whole-video metadata</p>
            <p className="truncate text-[11px] font-semibold text-text-tertiary">{metadata?.video_name || searchMoment.videoName}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-tertiary">
            {loading ? 'Loading' : error ? 'Unavailable' : hasMetadata ? 'Loaded' : 'Pending'}
          </span>
          <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-tertiary">
            {loading ? '...' : `${total} saved`}
          </span>
          <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-tertiary">
            {loading ? '...' : `${counts.clip_analysis ?? clipItems.length} clips`}
          </span>
          <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-tertiary">
            {loading ? '...' : `${counts.jockey_turn ?? turnItems.length} chats`}
          </span>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-sm border border-error bg-error-light px-2.5 py-1.5 text-xs font-semibold text-error-dark">{error}</p>
      ) : (
        <>
          <div
            className={[
              'mt-2 rounded-sm border px-2.5 py-2',
              clipStatus.tone === 'ready'
                ? 'border-accent/35 bg-card text-brand-charcoal'
                : 'border-border-light bg-card text-text-secondary',
            ].join(' ')}
          >
            <div className="flex min-w-0 items-start gap-2">
              <span className={['mt-2 h-1.5 w-1.5 shrink-0 rounded-full', clipStatus.tone === 'ready' ? 'bg-accent' : 'bg-border'].join(' ')} />
              <div className="min-w-0">
                <p className="text-xs font-semibold">{clipStatus.label}</p>
                <p className="mt-0.5 text-xs leading-5 opacity-80">{clipStatus.detail}</p>
              </div>
            </div>
          </div>

          {!loading && latestItem && latestSummary && (
            <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] font-semibold text-text-tertiary">
              <span className="shrink-0">Latest</span>
              <span className="min-w-0 truncate text-text-secondary">{latestSummary.title}</span>
              {savedWorkspaceRange(latestItem) ? <span className="shrink-0 font-mono">{savedWorkspaceRange(latestItem)}</span> : null}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function SelectedClipAnalysisLoader() {
  return (
    <div className="rounded-md border border-border-light bg-card px-3 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent-light text-brand-charcoal">
          <StrandIcon name="spinner" className="h-4 w-4 animate-spin" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">Analyzing selected clip</p>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            Pegasus 1.5 is generating the selected-clip response.
          </p>
        </div>
      </div>
      <div className="mt-3 text-xs font-semibold text-brand-charcoal">
        <div className="rounded-sm border border-accent/35 bg-accent-light px-2.5 py-2">
          <span className="flex items-center gap-1.5">
            <StrandIcon name="spinner" className="h-3.5 w-3.5 animate-spin" />
            Pegasus 1.5 response
          </span>
        </div>
      </div>
    </div>
  )
}

function SelectedClipNarrative({ analysis }: { analysis: SelectedClipAnalysis }) {
  const primary = analysis.description.trim()
  const rows = [
    { label: 'Producer angle', icon: 'idea', value: analysis.producer_summary },
    { label: 'Story arc', icon: 'play-next', value: analysis.story_arc },
    { label: 'Editorial use', icon: 'share', value: analysis.editorial_use },
  ].filter((row) => row.value.trim())

  return (
    <section aria-label="Selected clip narrative" className="rounded-md border border-border-light bg-card px-3 py-3 shadow-[0_1px_2px_rgba(29,28,27,0.035)]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Clip story</p>
          <h4 className="truncate text-sm font-semibold text-text-primary">Pegasus read of the selected timestamp</h4>
        </div>
      </div>
      {primary && <p className="mt-3 text-sm font-semibold leading-6 text-text-primary">{primary}</p>}
      {rows.length > 0 && (
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          {rows.map((row) => (
            <article key={row.label} className="min-w-0 border-l border-border-light pl-3">
              <div className="flex min-w-0 items-center">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{row.label}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-text-secondary">{row.value}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function SelectedClipSignalBoard({ analysis }: { analysis: SelectedClipAnalysis }) {
  return (
    <section className="min-w-0 rounded-md border border-border-light bg-card px-3 py-3 shadow-[0_1px_2px_rgba(29,28,27,0.035)]">
      <div className="mb-2 flex min-w-0 items-center">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Signal readout</p>
        </div>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <SelectedClipToneTags value={analysis.emotional_tone} />
        <SelectedClipActionSignal value={analysis.key_action} />
        <SelectedClipScoreSignal value={analysis.score_context} />
      </div>
    </section>
  )
}

function SelectedClipTagShelf({
  momentTypes,
  producerTags,
  recommendedFormats,
}: {
  momentTypes: string[]
  producerTags: string[]
  recommendedFormats: string[]
}) {
  const groups = [
    { icon: 'flame', label: 'Moment types', values: momentTypes, accent: true },
    { icon: 'filter', label: 'Producer tags', values: producerTags },
    { icon: 'devices', label: 'Recommended formats', values: recommendedFormats },
  ].map((group) => ({
    ...group,
    values: group.values.filter((value) => value.trim()),
  })).filter((group) => group.values.length)

  if (!groups.length) return null

  return (
    <section className="min-w-0 rounded-md border border-border-light bg-card px-3 py-3 shadow-[0_1px_2px_rgba(29,28,27,0.035)]">
      <div className="flex min-w-0 items-center">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Tags and formats</p>
      </div>
      <div className="mt-3 grid gap-3">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{group.label}</p>
              <span className="rounded-sm border border-border-light bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-tertiary">
                {group.values.length}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {group.values.map((value, index) => (
                <span
                  key={`${group.label}-${value}-${index}`}
                  className={[
                    'inline-flex max-w-full items-center rounded-sm border px-2 py-1 text-xs font-semibold',
                    group.accent
                      ? 'border-accent/40 bg-card text-brand-charcoal'
                      : 'border-border-light bg-card text-text-secondary',
                  ].join(' ')}
                  title={value}
                >
                  <span className="min-w-0 break-words">{value}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SelectedClipToneTags({ value }: { value: string }) {
  const tags = selectedClipListTags(value)
  if (!tags.length) return null
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-card px-2.5 py-2">
      <div className="flex min-w-0 items-center">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Tone</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="rounded-sm border border-accent/35 bg-card px-2 py-1 text-xs font-semibold text-brand-charcoal">
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

function SelectedClipActionSignal({ value }: { value: string }) {
  const actions = selectedClipActionTags(value)
  if (!actions.length) return null
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-card px-2.5 py-2">
      <div className="flex min-w-0 items-center">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Key action</p>
      </div>
      <div className="mt-2 grid gap-1.5">
        {actions.map((action) => (
          <span key={action} className="inline-flex min-w-0 items-start rounded-sm border border-border-light bg-card px-2 py-1 text-xs font-semibold leading-5 text-text-primary">
            <span className="min-w-0 break-words">{action}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function SelectedClipScoreSignal({ value }: { value: string }) {
  if (!value.trim()) return null
  const score = selectedClipScoreParts(value)
  if (!score) return <SelectedClipSignal icon="trophy" label="Score" value={value} />
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-card px-2.5 py-2 sm:col-span-2">
      <div className="flex min-w-0 items-center">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Score</p>
      </div>
      <div className="mt-2 rounded-sm border border-border-light bg-card px-2 py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-text-secondary">{score.homeTeam}</p>
            <p className="mt-0.5 font-mono text-xl font-bold leading-none text-text-primary">{score.homeScore}</p>
          </div>
          <span className="rounded-sm border border-border-light bg-card px-1.5 py-0.5 font-mono text-[10px] font-bold text-text-tertiary">
            VS
          </span>
          <div className="min-w-0 text-right">
            <p className="truncate text-xs font-semibold text-text-secondary">{score.awayTeam}</p>
            <p className="mt-0.5 font-mono text-xl font-bold leading-none text-text-primary">{score.awayScore}</p>
          </div>
        </div>
        {score.matchTime && (
          <div className="mt-2 inline-flex max-w-full items-center rounded-sm border border-accent/30 bg-card px-2 py-1 text-[11px] font-semibold text-brand-charcoal">
            <span className="min-w-0 truncate">{score.matchTime} match time</span>
          </div>
        )}
      </div>
    </div>
  )
}

function SelectedClipSignal({ label, value }: { icon: string; label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-card px-2.5 py-2">
      <div className="flex min-w-0 items-center">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      </div>
      <p className="mt-1 break-words text-sm font-semibold leading-5 text-text-primary">{value}</p>
    </div>
  )
}

function selectedClipListTags(value: string) {
  return Array.from(new Set(
    value
      .split(/[,;•]+/)
      .map(selectedClipTagLabel)
      .filter(Boolean),
  ))
}

function selectedClipActionTags(value: string) {
  const fallback = selectedClipTagLabel(value)
  if (!fallback) return []
  const actions = value
    .split(/\s+(?:and|then|followed by)\s+|[,;•]+/i)
    .map(selectedClipTagLabel)
    .filter(Boolean)
  if (actions.length > 1 && actions.length <= 4 && actions.every((action) => action.length <= 72)) {
    return Array.from(new Set(actions))
  }
  return [fallback]
}

function selectedClipTagLabel(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').replace(/[.]+$/, '')
  if (!normalized) return ''
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
}

function selectedClipScoreParts(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const [scoreText, ...contextParts] = normalized.split(',')
  const match = scoreText.match(/^(.+?)\s+(\d+)\s*[-–]\s*(\d+)\s+(.+)$/)
  if (!match) return null
  const matchTime = contextParts
    .join(',')
    .trim()
    .replace(/\bmatch\s*time\b/i, '')
    .trim()
  return {
    homeTeam: match[1].trim(),
    homeScore: match[2],
    awayScore: match[3],
    awayTeam: match[4].trim(),
    matchTime,
  }
}

function SelectedClipParticipants({ participants }: { participants: SelectedClipAnalysis['participants'] }) {
  if (!participants.length) return null
  return (
    <section className="min-w-0 rounded-md border border-border-light bg-card px-2.5 py-2">
      <SelectedClipGroupHeader icon="members" label="Participants" count={participants.length} />
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-1">
        {participants.map((participant, index) => (
          <article key={`${participant.name}-${participant.role}-${index}`} className="min-w-0 rounded-sm border border-border-light bg-card px-2.5 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{participant.name}</span>
              {participant.role && (
                <span className="rounded-sm border border-accent/30 bg-card px-1.5 py-0.5 text-[11px] font-semibold text-brand-charcoal">
                  {participant.role}
                </span>
              )}
              {participant.team_or_group && (
                <span className="rounded-sm border border-border-light bg-card px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
                  {participant.team_or_group}
                </span>
              )}
            </div>
            {participant.evidence && (
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-text-secondary">{participant.evidence}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function SelectedClipTagGroup({ icon, label, values }: { icon: string; label: string; values: string[] }) {
  const tags = values.filter((value) => value.trim())
  if (!tags.length) return null
  return (
    <section className="min-w-0 rounded-md border border-border-light bg-card px-2.5 py-2">
      <SelectedClipGroupHeader icon={icon} label={label} count={tags.length} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((value, index) => (
          <span
            key={`${label}-${value}-${index}`}
            className="inline-flex max-w-full items-center rounded-sm border border-border-light bg-card px-2 py-1 text-xs font-semibold text-text-secondary"
            title={value}
          >
            <span className="min-w-0 break-words">{value}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

function SelectedClipNote({ label, value }: { icon: string; label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <article className="min-w-0 rounded-md border border-border-light bg-card px-3 py-2">
      <div className="flex min-w-0 items-center">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      </div>
      <p className="mt-1 text-sm leading-5 text-text-secondary">{value}</p>
    </article>
  )
}

function SelectedClipEvidenceGroup({ rows }: { rows: Array<{ label: string; icon: string; values: string[] }> }) {
  if (!rows.length) return null
  return (
    <section className="min-w-0">
      <SelectedClipGroupHeader icon="vision" label="Grounded evidence" />
      <div className="mt-2 grid gap-2">
        {rows.map((row) => (
          <article key={row.label} className="min-w-0 rounded-md border border-border-light bg-card px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{row.label}</p>
              <span className="ml-auto rounded-sm border border-border-light bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-tertiary">
                {row.values.length}
              </span>
            </div>
            <ul className="mt-2 grid gap-1.5">
              {row.values.map((value, index) => (
                <li key={`${row.label}-${value}-${index}`} className="text-sm leading-5 text-text-secondary">{value}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  )
}

function SelectedClipGroupHeader({ label, count }: { icon: string; label: string; count?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      {typeof count === 'number' && (
        <span className="rounded-sm border border-border-light bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-tertiary">
          {count}
        </span>
      )}
    </div>
  )
}

function SelectedClipAnalysisSaveButton({
  game,
  searchMoment,
  analysis,
}: {
  game: Game | null
  searchMoment: SearchMoment
  analysis?: SelectedClipAnalysis
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(Boolean(analysis?._jockey_metadata?.stored_to_user_metadata))
  const [error, setError] = useState('')
  const label = searchMoment.title || searchMoment.videoName
  const preview = label.length > 48 ? `${label.slice(0, 45)}...` : label
  const canSave = Boolean(game && analysis && !analysis._jockey_metadata?.stored_to_user_metadata)

  useEffect(() => {
    setSaved(Boolean(analysis?._jockey_metadata?.stored_to_user_metadata))
  }, [analysis])

  const handleSave = async () => {
    if (!game || !analysis || saving) return
    setSaving(true)
    setError('')
    try {
      await fetchJson<JockeyWorkspaceSaveResponse>(
        `/games/${encodeURIComponent(game.tag)}/videos/${encodeURIComponent(searchMoment.videoName)}/jockey-workspace/saved-clip-analysis`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysis,
            search_context: {
              title: searchMoment.title,
              query: searchMoment.query,
              description: searchMoment.description,
              relevance: searchMoment.relevance,
              start_time: searchMoment.startTime,
              end_time: searchMoment.endTime,
              video_reference: searchMoment.videoReference,
            },
          }),
        },
      )
      setSaved(true)
      notifyWorkspaceMetadataSaved(game.tag, [searchMoment.videoName])
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`Save selected clip analysis: ${preview}`}
        title={saved ? 'Saved to video workspace metadata' : 'Append this clip analysis to the source video workspace metadata'}
        disabled={!canSave || saving}
        className={[
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold shadow-[0_1px_2px_rgba(31,41,33,0.035)]',
          saved
            ? 'border-brand-charcoal bg-brand-charcoal text-white'
            : 'border-border-light bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal',
          !canSave || saving ? 'cursor-not-allowed opacity-60' : '',
        ].join(' ')}
        onClick={() => void handleSave()}
      >
        <StrandIcon name={saving ? 'spinner' : saved ? 'checkmark' : 'document'} className={['h-3.5 w-3.5', saving ? 'animate-spin' : ''].join(' ')} />
        {saved ? 'Saved' : saving ? 'Saving' : 'Save'}
      </button>
      {error ? <span className="max-w-[220px] truncate text-[10px] font-semibold text-error">{error}</span> : null}
    </div>
  )
}

function SavedWorkspaceMetadataPanel({
  game,
  videoName,
  metadata,
  loading,
  error,
  variant = 'dashboard',
}: {
  game: Game | null
  videoName: string
  metadata?: JockeyWorkspaceMetadataResponse
  loading: boolean
  error: string
  variant?: 'dashboard' | 'selected_clip'
}) {
  const items = savedWorkspaceItems(metadata)
  const clipItems = savedWorkspaceItemsByKind(items, 'clip_analysis')
  const turnItems = savedWorkspaceItemsByKind(items, 'jockey_turn')
  const counts = metadata?.summary?.counts || {}
  const total = counts.total ?? items.length
  const selectedClipVariant = variant === 'selected_clip'
  const visibleItems = selectedClipVariant ? items : items.slice(0, 4)
  const [expandedItemId, setExpandedItemId] = useState('')

  useEffect(() => {
    if (expandedItemId && !items.some((item) => item.id === expandedItemId)) {
      setExpandedItemId('')
    }
  }, [expandedItemId, items])

  if (!loading && !error && total === 0) return null
  const title = selectedClipVariant ? 'Source video metadata' : 'Selected clip and Jockey chat memory'
  const eyebrow = 'Saved metadata'
  const description = selectedClipVariant
    ? 'Same saved metadata ledger shown on the Dashboard for this source video.'
    : ''
  const renderLedgerItems = (groupItems: JockeyWorkspaceItem[]) => groupItems.map((item) => (
    <SavedMetadataLedgerItem
      key={item.id}
      game={game}
      fallbackVideoName={videoName}
      item={item}
      expanded={expandedItemId === item.id}
      onToggle={() => setExpandedItemId((current) => (current === item.id ? '' : item.id))}
    />
  ))

  return (
    <section className="rounded-md border border-border bg-surface px-4 py-3 shadow-[0_6px_18px_rgba(29,28,27,0.035)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StrandIcon name="document-list" className="h-4 w-4 text-accent" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{eyebrow}</p>
            <h3 className="truncate text-sm font-semibold text-text-primary">{title}</h3>
            {description ? <p className="mt-0.5 truncate text-xs font-medium text-text-secondary">{description}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {selectedClipVariant && (
            <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-tertiary">
              {total} saved total
            </span>
          )}
          {(selectedClipVariant || typeof counts.clip_analysis === 'number') && (
            <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-tertiary">
              {counts.clip_analysis ?? clipItems.length} Pegasus clips
            </span>
          )}
          {(selectedClipVariant || typeof counts.jockey_turn === 'number') && (
            <span className="rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-tertiary">
              {counts.jockey_turn ?? turnItems.length} Jockey curated
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-sm border border-border-light bg-card px-2.5 py-1.5 text-xs font-semibold text-text-secondary">
          <StrandIcon name="spinner" className="h-3.5 w-3.5 animate-spin text-accent" />
          Loading saved metadata
        </div>
      ) : error ? (
        <p className="mt-3 rounded-sm border border-error bg-error-light px-2.5 py-1.5 text-xs font-semibold text-error-dark">{error}</p>
      ) : !clipItems.length && !turnItems.length ? (
        <p className="mt-3 rounded-sm border border-border-light bg-card px-2.5 py-1.5 text-xs font-semibold text-text-secondary">
          Saved workspace metadata exists, but no clip analysis or Jockey chat entries were returned for this video.
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-hidden rounded-sm border border-border-light bg-card">
            {renderLedgerItems(visibleItems)}
          </div>
          {items.length > visibleItems.length && (
            <p className="mt-2 text-[11px] font-semibold text-text-tertiary">
              Showing latest {visibleItems.length} of {items.length} saved metadata entries.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function SavedMetadataLedgerItem({
  game,
  fallbackVideoName,
  item,
  expanded,
  onToggle,
}: {
  game: Game | null
  fallbackVideoName: string
  item: JockeyWorkspaceItem
  expanded: boolean
  onToggle: () => void
}) {
  const summary = savedWorkspaceItemSummary(item)
  const range = savedWorkspaceRange(item)
  return (
    <article className="border-t border-border-light first:border-t-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="grid w-full min-w-0 gap-2 px-3 py-2.5 text-left hover:bg-surface"
      >
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border-light bg-surface text-accent">
            <StrandIcon name={summary.icon} className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="rounded-sm border border-border-light bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                {summary.kindLabel}
              </span>
              {range && <span className="font-mono text-[11px] font-semibold text-text-tertiary">{range}</span>}
              {item.saved_at && <span className="text-[11px] font-semibold text-text-tertiary">{formatWorkspaceSavedAt(item.saved_at)}</span>}
            </div>
            <p className="mt-1 line-clamp-1 text-sm font-semibold text-text-primary">{summary.title}</p>
            {summary.detail ? <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-text-secondary">{summary.detail}</p> : null}
          </div>
          <StrandIcon name={expanded ? 'collapse' : 'expand'} className="mt-1 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        </div>
      </button>

      {expanded && (
        <div className="grid gap-3 border-t border-border-light bg-surface px-3 py-3 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
          <SavedMetadataClipPreview game={game} fallbackVideoName={fallbackVideoName} item={item} />
          <SavedMetadataDetail item={item} />
        </div>
      )}
    </article>
  )
}

function SavedMetadataClipPreview({
  game,
  fallbackVideoName,
  item,
}: {
  game: Game | null
  fallbackVideoName: string
  item: JockeyWorkspaceItem
}) {
  const sourceName = savedWorkspaceVideoName(item, fallbackVideoName)
  const range = savedWorkspacePreviewRange(item)
  const startSeconds = range?.startTime ? secondsFromTime(range.startTime) : 0
  const rawEndSeconds = range?.endTime ? secondsFromTime(range.endTime) : undefined
  const endSeconds = rawEndSeconds && rawEndSeconds > startSeconds ? rawEndSeconds : undefined
  const streamInfoUrl = game && sourceName ? streamInfoForVideoName(game, sourceName) : null
  const posterUrl = game && sourceName ? thumbnailForVideoName(game, sourceName) : undefined
  const segmentRange = range
    ? {
        startSeconds,
        endSeconds,
        startLabel: range.startTime,
        endLabel: range.endTime,
      }
    : undefined

  return (
    <div className="min-w-0 overflow-hidden rounded-sm border border-border-light bg-card">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border-light px-2.5 py-2">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Clip stream</p>
        {range && (
          <span className="shrink-0 font-mono text-[10px] font-semibold text-text-tertiary">
            {savedWorkspaceRange(item)}
          </span>
        )}
      </div>
      <div className="aspect-video bg-card">
        {streamInfoUrl && range ? (
          <TwelveLabsVideoPlayer
            key={`${item.id}-${sourceName}-${range.startTime}-${range.endTime || 'open'}`}
            streamInfoUrl={streamInfoUrl}
            startSeconds={startSeconds}
            endSeconds={endSeconds}
            posterUrl={posterUrl}
            segmentRange={segmentRange}
            variant="minimal"
            fit="cover"
            showSegmentControls
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <StrandIcon name="vision-disabled" className="h-5 w-5 text-text-tertiary" />
            <p className="text-xs font-semibold leading-5 text-text-secondary">No timestamped stream clip was saved for this entry.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SavedMetadataDetail({ item }: { item: JockeyWorkspaceItem }) {
  return item.kind === 'jockey_turn'
    ? <SavedJockeyTurnDetail item={item} />
    : <SavedClipAnalysisDetail item={item} />
}

function SavedClipAnalysisDetail({ item }: { item: JockeyWorkspaceItem }) {
  const analysis = item.payload?.analysis || {}
  const context = item.payload?.search_context || {}
  const title = cleanString(item.title) || cleanString(context.title) || cleanString(analysis.key_action) || 'Selected clip analysis'
  const rows = [
    { label: 'Read', value: cleanString(analysis.description) || cleanString(context.description) },
    { label: 'Action', value: cleanString(analysis.key_action) },
    { label: 'Tone', value: cleanString(analysis.emotional_tone) },
    { label: 'Score', value: cleanString(analysis.score_context) },
    { label: 'Use', value: cleanString(analysis.editorial_use) },
  ].filter((row) => row.value)
  const tags = [
    ...savedWorkspaceStringList(analysis.moment_types),
    ...savedWorkspaceStringList(analysis.tags),
    ...savedWorkspaceStringList(analysis.recommended_formats),
  ].slice(0, 8)
  const evidence = [
    ...savedWorkspaceStringList(analysis.visual_evidence),
    ...savedWorkspaceStringList(analysis.audio_evidence),
    ...savedWorkspaceStringList(analysis.transcript_evidence),
  ].slice(0, 5)

  return (
    <article className="min-w-0 rounded-sm border border-border-light bg-card px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Pegasus 1.5 detail</p>
      <h4 className="mt-1 text-sm font-semibold text-text-primary">{title}</h4>
      <div className="mt-3 grid gap-2">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{row.label}</p>
            <p className="text-xs leading-5 text-text-secondary">{row.value}</p>
          </div>
        ))}
      </div>
      {tags.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag, index) => (
            <span key={`${tag}-${index}`} className="rounded-sm border border-border-light bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-text-tertiary">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {evidence.length ? (
        <ul className="mt-3 grid gap-1.5">
          {evidence.map((value, index) => (
            <li key={`${value}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-1.5 text-xs leading-5 text-text-secondary">
              <StrandIcon name="checkmark" className="mt-0.5 h-3 w-3 text-accent" />
              <span>{value}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function SavedJockeyTurnDetail({ item }: { item: JockeyWorkspaceItem }) {
  const payload = item.payload || {}
  const clips = Array.isArray(payload.clips) ? payload.clips : []
  const title = cleanString(payload.prompt) || cleanString(item.title) || 'Jockey chat turn'
  const detail = cleanString(payload.narrative_summary)
  return (
    <article className="min-w-0 rounded-sm border border-border-light bg-card px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Jockey chat detail</p>
      <h4 className="mt-1 text-sm font-semibold text-text-primary">{title}</h4>
      {detail ? <p className="mt-2 text-xs leading-5 text-text-secondary">{detail}</p> : null}
      {clips.length ? (
        <div className="mt-3 grid gap-2">
          {clips.slice(0, 4).map((clip, index) => {
            const start = cleanString(clip.start_time)
            const end = cleanString(clip.end_time)
            return (
              <div key={`${start}-${end}-${index}`} className="rounded-sm border border-border-light bg-surface px-2.5 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] font-semibold text-text-tertiary">
                    {end ? `${start} - ${end}` : start || `Clip ${index + 1}`}
                  </span>
                  {cleanString(clip.moment_type) && (
                    <span className="rounded-sm bg-card px-1.5 py-0.5 text-[11px] font-semibold text-text-tertiary">
                      {cleanString(clip.moment_type)}
                    </span>
                  )}
                </div>
                {cleanString(clip.jockey_rationale) && (
                  <p className="mt-1 text-xs leading-5 text-text-secondary">{cleanString(clip.jockey_rationale)}</p>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}

function savedWorkspaceItemSummary(item: JockeyWorkspaceItem) {
  if (item.kind === 'jockey_turn') {
    const payload = item.payload || {}
    const clips = Array.isArray(payload.clips) ? payload.clips : []
    return {
      kindLabel: 'Jockey chat',
      icon: 'speech',
      title: cleanString(payload.prompt) || cleanString(item.title) || 'Jockey chat turn',
      detail: cleanString(payload.narrative_summary) || `${clips.length} saved clips`,
    }
  }
  const analysis = item.payload?.analysis || {}
  const context = item.payload?.search_context || {}
  return {
    kindLabel: 'Clip analysis',
    icon: 'analyze',
    title: cleanString(item.title) || cleanString(context.title) || cleanString(analysis.key_action) || 'Selected clip analysis',
    detail: cleanString(analysis.key_action) || cleanString(analysis.description) || cleanString(context.description),
  }
}

function savedWorkspaceVideoName(item: JockeyWorkspaceItem, fallbackVideoName: string) {
  const primaryClip = savedWorkspacePrimaryClip(item)
  return cleanString(primaryClip?.video_name) || cleanString(item.video_name) || fallbackVideoName
}

function savedWorkspacePrimaryClip(item: JockeyWorkspaceItem) {
  const clips = item.payload?.clips
  if (!Array.isArray(clips)) return null
  return clips.find((clip) => cleanString(clip.start_time) || cleanString(clip.end_time)) || clips[0] || null
}

function savedWorkspacePreviewRange(item: JockeyWorkspaceItem): { startTime: string; endTime?: string } | null {
  const primaryClip = item.kind === 'jockey_turn' ? savedWorkspacePrimaryClip(item) : null
  const start = cleanString(primaryClip?.start_time)
    || cleanString(item.clip_bounds?.start_time)
    || cleanString(item.payload?.analysis?.start_time)
  const end = cleanString(primaryClip?.end_time)
    || cleanString(item.clip_bounds?.end_time)
    || cleanString(item.payload?.analysis?.end_time)
  if (!start && !end) return null
  return { startTime: start || '0:00', endTime: end || undefined }
}

function savedWorkspaceStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter(Boolean)
}

function savedWorkspaceItems(metadata?: JockeyWorkspaceMetadataResponse) {
  const items = metadata?.workspace?.saved_items
  if (!Array.isArray(items)) return []
  return items
    .filter((item): item is JockeyWorkspaceItem => Boolean(item && typeof item === 'object' && item.id))
    .slice()
    .sort((left, right) => workspaceSavedAtSortValue(right.saved_at) - workspaceSavedAtSortValue(left.saved_at))
}

function savedWorkspaceItemsByKind(items: JockeyWorkspaceItem[], kind: JockeyWorkspaceItem['kind']) {
  return items.filter((item) => item.kind === kind)
}

function selectedSearchClipWorkspaceItem(metadata: JockeyWorkspaceMetadataResponse | undefined, searchMoment: SearchMoment) {
  if (!searchMoment.startTime) return null
  const targetStart = secondsFromTime(searchMoment.startTime)
  const targetEnd = searchMoment.endTime ? secondsFromTime(searchMoment.endTime) : null
  const targetQuery = cleanString(searchMoment.query).toLowerCase()
  const targetTitle = cleanString(searchMoment.title).toLowerCase()
  const targetLabels = [targetQuery, targetTitle].filter(Boolean)

  return savedWorkspaceItemsByKind(savedWorkspaceItems(metadata), 'clip_analysis').find((item) => {
    const range = savedWorkspacePreviewRange(item)
    if (!range?.startTime) return false

    const itemStart = secondsFromTime(range.startTime)
    const itemEnd = range.endTime ? secondsFromTime(range.endTime) : null
    const startsMatch = Math.abs(itemStart - targetStart) <= 1
    const endsMatch = targetEnd === null || itemEnd === null || Math.abs(itemEnd - targetEnd) <= 1
    if (!startsMatch || !endsMatch) return false

    const context = item.payload?.search_context || {}
    const itemLabels = [
      cleanString(context.query),
      cleanString(context.title),
      cleanString(item.title),
    ].map((value) => value.toLowerCase()).filter(Boolean)

    if (!targetLabels.length || !itemLabels.length) return true
    return targetLabels.some((target) =>
      itemLabels.some((label) => label === target || label.includes(target) || target.includes(label)),
    )
  }) || null
}

function savedWorkspaceRange(item: JockeyWorkspaceItem) {
  const range = savedWorkspacePreviewRange(item)
  if (!range) return ''
  return range.endTime ? `${range.startTime} - ${range.endTime}` : range.startTime
}

function workspaceSavedAtSortValue(value?: string | null) {
  if (!value) return 0
  const normalized = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  if (normalized) {
    return Date.UTC(
      Number(normalized[1]),
      Number(normalized[2]) - 1,
      Number(normalized[3]),
      Number(normalized[4]),
      Number(normalized[5]),
      Number(normalized[6]),
    )
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function formatWorkspaceSavedAt(value: string) {
  const normalized = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/)
  if (normalized) return `${normalized[1]}-${normalized[2]}-${normalized[3]} ${normalized[4]}:${normalized[5]}`
  return value
}

function notifyWorkspaceMetadataSaved(tag: string, videoNames: string[]) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(WORKSPACE_METADATA_SAVED_EVENT, {
    detail: { tag, videoNames: Array.from(new Set(videoNames.filter(Boolean))) },
  }))
}

function EntityTrackingSection({
  game,
  videoName,
  tracking,
  loading,
  error,
}: {
  game: Game | null
  videoName?: string
  tracking?: EntityTrackingResponse
  loading: boolean
  error: string
}) {
  const entities = tracking?.entities || []
  const relationships = tracking?.relationships || []
  const appearanceCount = entities.reduce((total, entity) => total + entity.appearances.length, 0)
  const [collapsed, setCollapsed] = useState(false)
  const [previewMoment, setPreviewMoment] = useState<EntityMomentPreview | null>(null)

  useEffect(() => {
    setPreviewMoment(null)
  }, [tracking?.video_name, videoName])

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      if (!value) setPreviewMoment(null)
      return !value
    })
  }

  return (
    <section id="entity-tracking" data-tour-id="entity-tracking" className="scroll-mt-[calc(var(--sj-explainability-top)+24px)] overflow-hidden rounded-md border border-border bg-surface shadow-[0_10px_28px_rgba(29,28,27,0.045)]">
      <div className={['relative grid gap-4 overflow-hidden bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start', collapsed ? '' : 'border-b border-border-light'].join(' ')}>
        <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-[#DFF43F] to-[#FF8BC7]" aria-hidden="true" />
        <div className="min-w-0 pt-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-accent/45 bg-accent-light text-brand-charcoal shadow-[0_6px_16px_rgba(0,220,130,0.12)]">
              <StrandIcon name="entity-collection" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">Jockey entity map</p>
              <h3 className="truncate text-base font-semibold text-text-primary">Entity Tracking</h3>
            </div>
          </div>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-text-secondary">
            {tracking?.summary || 'Jockey is extracting grounded players, teams, crowd groups, and interactions from this source.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 lg:justify-end">
          {tracking && (
            <span className="inline-flex h-8 items-center rounded-sm border border-border-light bg-surface px-2.5 font-mono text-xs font-semibold text-text-secondary">
              {entities.length} entities
            </span>
          )}
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-light bg-surface px-2.5 text-xs font-semibold text-text-secondary transition hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
            aria-expanded={!collapsed}
            aria-controls="entity-tracking-body"
            onClick={toggleCollapsed}
          >
            <StrandIcon name={collapsed ? 'expand' : 'collapse'} className="h-3.5 w-3.5" />
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>

      {!collapsed && (loading ? (
        <div id="entity-tracking-body" className="m-5 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-text-secondary">
          <StrandIcon name="spinner" className="h-4 w-4 animate-spin text-accent" />
          Loading entity tracks
        </div>
      ) : error ? (
        <div id="entity-tracking-body" className="m-5 rounded-md border border-error bg-error-light px-3 py-2 text-sm font-semibold text-error-dark">
          {error}
        </div>
      ) : tracking ? (
        <div id="entity-tracking-body" className="grid gap-5 px-5 py-4">
          <div className="grid gap-2 md:grid-cols-3">
            <EntityTrackingMetric icon="members" label="Grounded entities" value={String(entities.length)} detail="Teams, players, officials, fan groups" />
            <EntityTrackingMetric icon="hourglass" label="Tracked moments" value={String(appearanceCount)} detail="Timestamped appearances" />
            <EntityTrackingMetric icon="neural-network" label="Interactions" value={String(relationships.length)} detail="Entity-to-entity links" />
          </div>

          {entities.length ? (
            <section className="grid gap-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <StrandIcon name="list" className="h-4 w-4 text-accent" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Entity evidence ledger</p>
                </div>
                <span className="rounded-sm border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary">
                  {entities.length} entities / {appearanceCount} moments
                </span>
              </div>
              <div className="grid gap-2">
                {entities.map((entity) => (
                  <EntityTrackCard
                    key={`${videoName || 'source'}-${entity.name}-${entity.role}`}
                    entity={entity}
                    game={game}
                    videoName={videoName}
                    onOpenMoment={setPreviewMoment}
                  />
                ))}
              </div>
            </section>
          ) : (
            <p className="text-sm font-semibold text-text-tertiary">No grounded entity tracks were returned for this source.</p>
          )}

          <EntityInteractionMap
            relationships={relationships}
            game={game}
            videoName={videoName}
            onOpenMoment={setPreviewMoment}
          />
        </div>
      ) : (
        <p id="entity-tracking-body" className="px-5 py-4 text-sm font-semibold text-text-tertiary">Entity tracks will appear after Jockey analyzes the active source.</p>
      ))}
      {previewMoment ? (
        <EntityMomentPreviewModal
          game={game}
          videoName={videoName}
          moment={previewMoment}
          onClose={() => setPreviewMoment(null)}
        />
      ) : null}
    </section>
  )
}

function EntityTrackingMetric({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-md border border-border-light bg-card px-3 py-3 shadow-[0_1px_2px_rgba(29,28,27,0.035)]">
      <span className="row-span-2 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-secondary">
        <StrandIcon name={icon} className="h-4 w-4" />
      </span>
      <p className="font-mono text-xl font-bold leading-none text-text-primary">{value}</p>
      <p className="mt-1 min-w-0 text-xs font-semibold leading-5 text-text-secondary">
        <span className="uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
        {' · '}
        {detail}
      </p>
    </div>
  )
}

type EntityMomentRange = {
  displayLabel: string
  endSeconds: number
  endTime?: string
  startSeconds: number
  startTime: string
}

type EntityMomentPreview = {
  description: string
  eyebrow: string
  range: EntityMomentRange
  subtitle: string
  title: string
}

function EntityTrackCard({
  entity,
  game,
  videoName,
  onOpenMoment,
}: {
  entity: EntityTrack
  game: Game | null
  videoName?: string
  onOpenMoment: (moment: EntityMomentPreview) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const appearances = entity.appearances.slice(0, 5)
  const extraAppearances = entity.appearances.length - appearances.length
  const entityBadges = Array.from(
    new Set(
      [entity.entity_type, entity.team_or_group, entity.role]
        .map(entityTrackingDisplayLabel)
        .filter((value): value is string => Boolean(value)),
    ),
  )

  useEffect(() => {
    setExpanded(false)
  }, [entity.name, entity.role, videoName])

  return (
    <article
      className={[
        'min-w-0 overflow-hidden rounded-md border bg-card transition-colors',
        expanded ? 'border-accent/55 shadow-[0_8px_22px_rgba(0,220,130,0.08)]' : 'border-border-light hover:border-border',
      ].join(' ')}
    >
      <div className="px-3 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-accent">
                <StrandIcon name={entityTypeIcon(entity.entity_type)} className="h-4 w-4" />
              </span>
              <h4 className="truncate text-sm font-semibold text-text-primary">{entity.name}</h4>
            </div>
            {entityBadges.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5 pl-10">
                {entityBadges.map((value) => (
                  <span key={`${entity.name}-${value}`} className="rounded-sm border border-border-light bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
                    {value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-1.5">
              <span className="rounded-sm border border-border-light bg-surface px-2 py-1 font-mono text-[11px] font-semibold text-text-secondary">
                {entity.appearances.length} moments
              </span>
              <span className="rounded-sm border border-border-light bg-surface px-2 py-1 font-mono text-[11px] font-semibold text-text-secondary">
                {confidenceLabel(entity.confidence)}
              </span>
            </div>
            <button
              type="button"
              className={[
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition',
                expanded
                  ? 'border-brand-charcoal bg-brand-charcoal text-white shadow-[0_0_0_3px_rgba(29,28,27,0.12),0_8px_18px_rgba(29,28,27,0.16)]'
                  : 'border-border text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal',
              ].join(' ')}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <StrandIcon name={expanded ? 'collapse' : 'expand'} className="h-3.5 w-3.5" />
              {expanded ? 'Hide moments' : 'Show moments'}
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm leading-5 text-text-secondary">{entity.description}</p>
      </div>
      {expanded && appearances.length ? (
        <ol className="grid gap-0 border-t border-border-light bg-surface">
          {appearances.map((appearance) => {
            const emotion = entityTrackingDisplayLabel(appearance.emotion)
            const context = entityTrackingDisplayLabel(appearance.context)
            const range = entityMomentRangeFromParts(appearance.start_time, appearance.end_time)
            return (
              <li
                key={`${entity.name}-${appearance.start_time}-${appearance.end_time}-${appearance.action}`}
                className="grid gap-3 border-b border-border-light px-3 py-3 last:border-b-0 sm:grid-cols-[132px_minmax(0,1fr)]"
              >
                <EntityMomentThumbnailButton
                  game={game}
                  videoName={videoName}
                  range={range}
                  title={`${entity.name} at ${range.displayLabel}`}
                  onOpen={() => onOpenMoment({
                    description: appearance.action,
                    eyebrow: 'Entity evidence',
                    range,
                    subtitle: entity.name,
                    title: appearance.action,
                  })}
                />
                <div className="min-w-0 self-center">
                  <p className="text-sm font-semibold leading-5 text-text-primary">{appearance.action}</p>
                  {emotion || context ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {emotion && (
                        <span className="rounded-sm border border-border-light bg-card px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
                          {emotion}
                        </span>
                      )}
                      {context && (
                        <span className="rounded-sm border border-border-light bg-card px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
                          {context}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
          {extraAppearances > 0 && (
            <li className="px-3 py-2 text-xs font-semibold text-text-tertiary">
              +{extraAppearances} more tracked moments
            </li>
          )}
        </ol>
      ) : null}
    </article>
  )
}

function EntityInteractionMap({
  relationships,
  game,
  videoName,
  onOpenMoment,
}: {
  relationships: EntityRelationship[]
  game: Game | null
  videoName?: string
  onOpenMoment: (moment: EntityMomentPreview) => void
}) {
  if (!relationships.length) return null
  return (
    <section className="min-w-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-accent">
            <StrandIcon name="play-next" className="h-4 w-4" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Interaction evidence timeline</p>
        </div>
        <span className="shrink-0 rounded-sm border border-border-light bg-card px-2 py-1 text-[11px] font-semibold text-text-secondary">
          {relationships.length} moments
        </span>
      </div>
      <div className="relative mt-3 grid gap-2">
        <span className="absolute bottom-4 left-[50px] top-4 hidden w-px bg-border-light sm:block" aria-hidden="true" />
        {relationships.map((relationship, index) => {
          const interactionType = entityTrackingDisplayLabel(relationship.interaction_type) || 'interaction'
          const range = entityMomentRangeFromTimestamp(relationship.timestamp)
          return (
            <article
              key={`${relationship.entity}-${relationship.related_entity}-${relationship.timestamp}-${relationship.description}`}
              className="relative grid gap-3 rounded-md border border-border-light bg-card px-3 py-3 shadow-[0_1px_2px_rgba(29,28,27,0.035)] sm:grid-cols-[132px_minmax(0,1fr)]"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="z-[1] mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/45 bg-accent-light font-mono text-[10px] font-bold text-brand-charcoal">
                  {index + 1}
                </span>
                <EntityMomentThumbnailButton
                  game={game}
                  videoName={videoName}
                  range={range}
                  title={`${relationship.entity} ${interactionType} ${relationship.related_entity}`}
                  compact
                  onOpen={() => onOpenMoment({
                    description: relationship.description,
                    eyebrow: 'Interaction evidence',
                    range,
                    subtitle: `${relationship.entity} -> ${relationship.related_entity}`,
                    title: interactionType,
                  })}
                />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="rounded-sm border border-border-light bg-surface px-2 py-1 text-xs font-semibold text-text-secondary">
                    {relationship.entity}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-sm border border-accent/35 bg-accent-light px-2 py-1 text-[11px] font-semibold text-brand-charcoal">
                    <StrandIcon name="play-next" className="h-3 w-3 text-accent" />
                    {interactionType}
                  </span>
                  <span className="rounded-sm border border-border-light bg-surface px-2 py-1 text-xs font-semibold text-text-secondary">
                    {relationship.related_entity}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-5 text-text-secondary">{relationship.description}</p>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function EntityMomentThumbnailButton({
  game,
  videoName,
  range,
  title,
  onOpen,
  compact = false,
}: {
  game: Game | null
  videoName?: string
  range: EntityMomentRange
  title: string
  onOpen: () => void
  compact?: boolean
}) {
  const canPreview = Boolean(game && videoName)
  const posterUrl = game && videoName ? entityMomentThumbnailUrl(game, videoName, range.startTime) : ''
  return (
    <button
      type="button"
      data-preserve-hover="true"
      disabled={!canPreview}
      onClick={onOpen}
      className={[
        'group relative isolate block w-full min-w-0 overflow-hidden rounded-md border border-border-light bg-surface text-left transition-colors',
        'aspect-video',
        canPreview
          ? 'cursor-pointer hover:border-accent'
          : 'cursor-not-allowed opacity-65',
      ].join(' ')}
      aria-label={canPreview ? `Open ${title} at ${range.displayLabel}` : `${title} at ${range.displayLabel}`}
      title={canPreview ? `Open at ${range.displayLabel}` : range.displayLabel}
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center"
          loading="lazy"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-text-tertiary">
          <StrandIcon name="vision" className="h-4 w-4 text-accent" />
        </span>
      )}
      {canPreview && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-accent bg-accent text-brand-charcoal opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <StrandIcon name="play" className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-[2] rounded-sm border border-border-light bg-surface/95 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-primary backdrop-blur-[2px]">
        {range.displayLabel}
      </span>
    </button>
  )
}

function EntityMomentPreviewModal({
  game,
  videoName,
  moment,
  onClose,
}: {
  game: Game | null
  videoName?: string
  moment: EntityMomentPreview
  onClose: () => void
}) {
  const streamInfoUrl = game && videoName ? streamInfoForVideoName(game, videoName) : null
  const posterUrl = game && videoName ? entityMomentThumbnailUrl(game, videoName, moment.range.startTime) : undefined
  const segmentRange: SegmentRange = {
    startSeconds: moment.range.startSeconds,
    endSeconds: moment.range.endSeconds,
    startLabel: moment.range.startTime,
    endLabel: moment.range.endTime,
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-moment-preview-title"
        className="flex max-h-[calc(100vh-40px)] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-border bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.3)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-light bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{moment.eyebrow}</p>
            <h3 id="entity-moment-preview-title" className="mt-1 truncate text-base font-semibold text-text-primary">{moment.title}</h3>
            <p className="mt-1 truncate text-sm font-medium text-text-secondary">{moment.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-sm border border-border-light bg-surface px-2 py-1 font-mono text-[11px] font-semibold text-text-tertiary">
              {moment.range.displayLabel}
            </span>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border-light bg-surface text-text-secondary hover:border-accent hover:bg-accent-light hover:text-brand-charcoal"
              onClick={onClose}
              aria-label="Close entity moment preview"
              title="Close"
            >
              <StrandIcon name="close" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          <div className="overflow-hidden rounded-md border border-border-light bg-card">
            <div className="aspect-video">
              {streamInfoUrl ? (
                <TwelveLabsVideoPlayer
                  key={`${streamInfoUrl}-${moment.range.startSeconds}-${moment.range.endSeconds}`}
                  streamInfoUrl={streamInfoUrl}
                  startSeconds={moment.range.startSeconds}
                  endSeconds={moment.range.endSeconds}
                  posterUrl={posterUrl}
                  segmentRange={segmentRange}
                  variant="minimal"
                  statusOverlayStyle="loader"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm font-semibold text-text-secondary">
                  Timestamp playback is unavailable for this source.
                </div>
              )}
            </div>
          </div>
          {moment.description ? (
            <p className="mt-3 rounded-md border border-border-light bg-card px-3 py-2 text-sm leading-5 text-text-secondary">
              {moment.description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function entityMomentRangeFromTimestamp(timestamp?: string | null) {
  const normalized = entityTrackingDisplayLabel(timestamp)?.replace(/[–—]/g, '-') || ''
  const [startTime, endTime] = normalized.split(/\s*-\s*/).filter(Boolean)
  return entityMomentRangeFromParts(startTime || '0:00', endTime)
}

function entityMomentRangeFromParts(startTime?: string | null, endTime?: string | null): EntityMomentRange {
  const startLabel = entityTrackingDisplayLabel(startTime) || '0:00'
  const endLabel = entityTrackingDisplayLabel(endTime)
  const startSeconds = secondsFromTime(startLabel)
  const explicitEndSeconds = endLabel ? secondsFromTime(endLabel) : 0
  const endSeconds = explicitEndSeconds > startSeconds ? explicitEndSeconds : startSeconds + 8
  return {
    displayLabel: endLabel && explicitEndSeconds > startSeconds ? `${startLabel} - ${endLabel}` : startLabel,
    endSeconds,
    endTime: endLabel && explicitEndSeconds > startSeconds ? endLabel : undefined,
    startSeconds,
    startTime: startLabel,
  }
}

function entityMomentThumbnailUrl(game: Game, videoName: string, startTime: string) {
  const params = new URLSearchParams({
    time: String(secondsFromTime(startTime)),
    format: '16x9',
  })
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/reel-thumbnail/${encodeURIComponent(videoName)}?${params.toString()}`)
}

const ENTITY_TRACKING_HIDDEN_LABELS = [
  'na',
  'n/a',
  'none',
  'null',
  'unclear',
  'unknown',
  'unspecified',
  'not applicable',
  'not available',
  'not clearly supported',
  'not clearly visible',
  'not provided',
  'not supported',
  'no clear evidence',
  'no visual evidence',
]

function entityTrackingDisplayLabel(value?: string | null) {
  const normalized = `${value ?? ''}`.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const comparable = normalized.toLowerCase()
  if (ENTITY_TRACKING_HIDDEN_LABELS.includes(comparable)) return ''
  if (comparable.includes('not clearly supported')) return ''
  return normalized
}

function entityTypeIcon(entityType: string) {
  const normalized = entityType.toLowerCase()
  if (normalized.includes('team')) return 'members'
  if (normalized.includes('fan')) return 'flame'
  if (normalized.includes('official') || normalized.includes('referee')) return 'checkmark'
  return 'profile'
}

function TagRow({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span key={value} className="rounded-sm border border-border-light bg-card px-2 py-1 text-xs font-semibold text-text-secondary">
            {value}
          </span>
        ))}
      </div>
    </div>
  )
}

function AnalysisIndexNotice({ game }: { game: Game | null }) {
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
  const playbackVideoName = sourceVideoName || clipVideoName || searchMoment?.videoName
  const streamInfoUrl =
    game && playbackVideoName
      ? streamInfoForWorkspacePlayback(game, playbackVideoName, {
          videoReference: clip?.video_reference || searchMoment?.videoReference,
        })
      : null
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0)
  const searchStartSeconds = searchMoment?.startTime ? secondsFromTime(searchMoment.startTime) : 0
  const clipStartSeconds = clip ? secondsFromTime(clip.start_time) : searchStartSeconds
  const clipRangeLabel = clip
    ? `${clip.start_time} - ${clip.end_time}`
    : searchMoment?.startTime
      ? `${searchMoment.startTime}${searchMoment.endTime ? ` - ${searchMoment.endTime}` : ''}`
      : ''
  const sourceName = playbackVideoName
  const posterUrl = game && sourceName && clip
    ? reelThumbnailUrl(game, sourceName, clip, '16x9')
    : game && sourceName
      ? thumbnailForVideoName(game, sourceName)
      : undefined

  useEffect(() => {
    setVideoDurationSeconds(0)
  }, [streamInfoUrl, clip?.start_time, clip?.end_time, searchMoment?.startTime, searchMoment?.endTime])

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
          {clip && <Confidence value={clip.confidence} />}
        </div>
      </div>
      {streamInfoUrl || clip ? (
        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_380px]">
          <div className="min-w-0 border-b border-border-light lg:border-b-0 lg:border-r">
            <div className="flex aspect-video items-center justify-center bg-card text-text-primary">
              {streamInfoUrl ? (
                <TwelveLabsVideoPlayer
                  key={`${streamInfoUrl}-${clip?.start_time || 'source'}-${clip?.end_time || 'full'}`}
                  streamInfoUrl={streamInfoUrl}
                  startSeconds={clipStartSeconds}
                  posterUrl={posterUrl}
                  onDuration={setVideoDurationSeconds}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <StrandIcon name="info" className="h-8 w-8 text-text-tertiary" />
                  <p className="max-w-sm text-sm font-medium text-text-secondary">No TwelveLabs stream mapping for this video</p>
                  {clip && <p className="max-w-md break-all text-xs text-text-tertiary">{clip.video_reference}</p>}
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
            ) : clip ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Timecode" value={clipRangeLabel} />
                  <Detail label="Source" value={sourceLabel(clip.source_type)} />
                  <Detail label="Clip type" value={cleanClipTypeLabel(clip.clip_type)} />
                  <Detail label="Reference" value={clip.video_reference} />
                </div>
                <div className="rounded-md border border-border-light bg-card p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Grounded Citation</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{clip.description}</p>
                  {clip.score_context && <p className="mt-2 text-sm leading-5 text-text-secondary">{clip.score_context}</p>}
                </div>
                <div className="rounded-md border border-border-light bg-surface p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selection Signal</p>
                  <p className="mt-2 text-sm font-semibold leading-5 text-text-primary">{clip.explainability_label}</p>
                  {clip.evidence_summary && (
                    <p className="mt-2 text-sm leading-5 text-text-primary">{clip.evidence_summary}</p>
                  )}
                  <p className="mt-2 text-sm leading-5 text-text-secondary">{clip.selection_reason}</p>
                  <EvidenceStack clip={clip} />
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
  secondaryClips = [],
  secondaryLabel,
  secondaryColor = signalColors.emotional_moments,
  onSecondarySelect,
  selectedIndex,
  durationSeconds,
  onSelect,
  variant = 'default',
}: {
  clips: Clip[]
  label: string
  secondaryClips?: Clip[]
  secondaryLabel?: string
  secondaryColor?: { bg: string; border: string; text: string; track: string }
  onSecondarySelect?: (index: number) => void
  selectedIndex: number
  durationSeconds: number
  onSelect: (index: number) => void
  variant?: 'default' | 'preview'
}) {
  if (clips.length === 0) return null
  const selectedClip = clips[selectedIndex] || clips[0]
  const timelineClips = [...clips, ...secondaryClips]
  const maxClipEnd = Math.max(
    ...timelineClips.map((clip) => Math.max(secondsFromTime(clip.end_time), secondsFromTime(clip.start_time) + 1)),
  )
  const safeDuration = Math.max(durationSeconds, maxClipEnd, 1)
  const preview = variant === 'preview'
  return (
    <div className={preview ? 'mx-3 mt-3 border-t border-border-light px-1 py-3 text-text-secondary' : 'border-b border-border bg-card px-4 py-3 text-text-secondary lg:border-b-0'}>
      <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        <span>{clips.length} {label} points</span>
        <span>
          {selectedClip.start_time} - {selectedClip.end_time}
        </span>
      </div>
      <div className="relative mt-3 h-7" aria-label={`${label} clip points on player timeline`}>
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border-light" />
        {secondaryClips.map((clip, index) => {
          const start = secondsFromTime(clip.start_time)
          const end = Math.max(secondsFromTime(clip.end_time), start + 1)
          const left = clamp((start / safeDuration) * 100, 0, 98)
          const width = clamp(((end - start) / safeDuration) * 100, 1.4, 100 - left)
          const markerStyle: CSSProperties = {
            left: `${left}%`,
            width: `${width}%`,
            minWidth: 14,
            zIndex: 1,
            backgroundColor: secondaryColor.bg,
            borderColor: secondaryColor.border,
            boxShadow: '0 0 12px rgba(250,186,23,0.28)',
          }
          const markerClass = 'absolute top-1/2 h-3 -translate-y-1/2 rounded-full border transition-transform hover:scale-y-150 focus:outline-none focus:ring-2 focus:ring-[rgba(250,186,23,0.35)]'
          const markerLabel = `${secondaryLabel || 'Secondary'} point ${index + 1}: ${clip.start_time} to ${clip.end_time}`
          if (!onSecondarySelect) {
            return (
              <span
                key={`${clip.video_reference}-${clip.start_time}-${index}-secondary-marker`}
                aria-hidden="true"
                className={markerClass}
                style={markerStyle}
              />
            )
          }
          return (
            <button
              key={`${clip.video_reference}-${clip.start_time}-${index}-secondary-marker`}
              type="button"
              onClick={() => onSecondarySelect(index)}
              aria-label={markerLabel}
              title={markerLabel}
              className={markerClass}
              style={markerStyle}
            />
          )
        })}
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
                  : 'border-border bg-card hover:border-accent hover:bg-accent',
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
  indexVideos,
  categoryKey,
  category,
  format,
  onFormatChange,
}: {
  game: Game
  videoName: string
  indexVideos: IndexVideo[]
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
    <section data-tour-id="tag-reels" className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_rgba(29,28,27,0.045)]">
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
                    ? 'bg-brand-charcoal text-white'
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
                indexVideos={indexVideos}
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
  indexVideos,
  categoryKey,
  clip,
  index,
  format,
  formatSpec,
}: {
  game: Game
  videoName: string
  indexVideos: IndexVideo[]
  categoryKey: CategoryKey
  clip: Clip
  index: number
  format: ReelFormatKey
  formatSpec: { key: ReelFormatKey; label: string; detail: string; aspect: string }
}) {
  const [hoverPreviewing, setHoverPreviewing] = useState(false)
  const [previewLocked, setPreviewLocked] = useState(false)
  const [playerStatus, setPlayerStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const hoverPreviewTimerRef = useRef<number | null>(null)
  const paddedRange = paddedRangeForClip(clip)
  const streamInfoUrl = streamInfoForWorkspacePlayback(game, videoName, { videoReference: clip.video_reference })
  const cardPosterUrl = clipPosterUrl(game, videoName, clip, format, indexVideos)
  const segmentPosterUrl = clipPosterUrl(game, videoName, clip, format, indexVideos, true)
  const downloadUrl = reelDownloadUrl(game, videoName, clip, categoryKey, index, format)
  const categoryLabel = categories.find((category) => category.key === categoryKey)?.label || 'Reel'
  const segmentRange = useMemo(() => ({
    startSeconds: paddedRange.start,
    endSeconds: paddedRange.end,
    startLabel: formatSeconds(paddedRange.start),
    endLabel: formatSeconds(paddedRange.end),
  }), [paddedRange.end, paddedRange.start])
  const previewing = hoverPreviewing || previewLocked

  const clearHoverPreviewTimer = useCallback(() => {
    if (hoverPreviewTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewTimerRef.current)
      hoverPreviewTimerRef.current = null
    }
  }, [])

  const queueHoverPreview = useCallback(() => {
    if (previewLocked || hoverPreviewTimerRef.current !== null) return
    hoverPreviewTimerRef.current = window.setTimeout(() => {
      hoverPreviewTimerRef.current = null
      setHoverPreviewing(true)
    }, REEL_PREVIEW_HOVER_DELAY_MS)
  }, [previewLocked])

  const stopHoverPreview = useCallback(() => {
    clearHoverPreviewTimer()
    setHoverPreviewing(false)
  }, [clearHoverPreviewTimer])

  useEffect(() => {
    setPlayerStatus('loading')
  }, [format, segmentRange.endSeconds, segmentRange.startSeconds, streamInfoUrl])

  useEffect(() => clearHoverPreviewTimer, [clearHoverPreviewTimer])

  return (
    <article
      tabIndex={0}
      aria-label={`Preview reel clip ${index + 1}`}
      aria-busy={playerStatus === 'loading'}
      className="group w-[224px] shrink-0 snap-start cursor-pointer overflow-hidden rounded-md border border-border-light bg-surface shadow-[0_1px_2px_rgba(31,41,33,0.035)] outline-none transition duration-200 hover:-translate-y-1 hover:border-accent hover:bg-accent-light focus:border-accent focus:bg-accent-light focus:ring-2 focus:ring-accent/25 focus-within:border-accent"
      onClick={() => {
        clearHoverPreviewTimer()
        prefetchTwelveLabsStream(streamInfoUrl)
        setPreviewLocked(true)
      }}
      onFocus={queueHoverPreview}
      onPointerEnter={queueHoverPreview}
      onPointerLeave={stopHoverPreview}
      onMouseEnter={queueHoverPreview}
      onMouseLeave={stopHoverPreview}
      onFocusCapture={queueHoverPreview}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) stopHoverPreview()
      }}
    >
      <div className="relative overflow-hidden bg-card" style={{ aspectRatio: formatSpec.aspect }}>
        <img alt="" src={cardPosterUrl} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        {previewing ? (
          <div className="absolute inset-0">
            <TwelveLabsVideoPlayer
              key={`${streamInfoUrl}-${segmentRange.startSeconds}-${segmentRange.endSeconds}-${format}`}
              streamInfoUrl={streamInfoUrl}
              startSeconds={segmentRange.startSeconds}
              endSeconds={segmentRange.endSeconds}
              posterUrl={segmentPosterUrl}
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
        ) : null}
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
            onClick={(event) => startDownloadAfterHlsWarmup(event, streamInfoUrl, downloadUrl)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/24 bg-brand-charcoal/92 text-white shadow-[0_8px_18px_rgba(0,0,0,0.2)] backdrop-blur-sm transition hover:border-accent hover:bg-accent hover:text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <StrandIcon name="download" className="h-4 w-4" />
          </a>
        </div>
        {!previewing && (
          <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-text-primary opacity-95 backdrop-blur-sm transition group-hover:scale-105 group-hover:border-accent group-hover:bg-accent">
            <StrandIcon name="play" className="h-4 w-4" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/68 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex min-w-0 items-center justify-end">
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
  const showMediaEvidence = !isStatsBaselineClip(clip)
  const evidenceRows = [
    showMediaEvidence ? { label: 'Visual', values: clip.visual_evidence || [] } : null,
    showMediaEvidence ? { label: 'Audio', values: clip.audio_evidence || [] } : null,
    { label: 'Transcript', values: clip.transcript_evidence || [] },
  ].filter((row): row is { label: string; values: string[] } => Boolean(row && row.values.length))
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
  const showMediaEvidence = !isStatsBaselineClip(clip)
  const rows = [
    showMediaEvidence ? { label: 'Visual', values: clip.visual_evidence || [] } : null,
    showMediaEvidence ? { label: 'Audio', values: clip.audio_evidence || [] } : null,
    { label: 'Transcript', values: clip.transcript_evidence || [] },
  ].filter((row): row is { label: string; values: string[] } => Boolean(row && row.values.length))
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

function isStatsBaselineClip(clip: Clip) {
  return clip.category === 'standard_stats' || clip.source_type === 'stats'
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
    <span className="shrink-0 rounded-sm border border-border bg-card px-2 py-1 font-mono text-xs font-semibold text-text-primary">
      {confidenceLabel(value)}
    </span>
  )
}

function StrandIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const svg = icons[name] || icons.info
  return <span className={`strand-icon shrink-0 ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />
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

function cleanVideoCardTitle(videoName?: string) {
  const normalized = cleanString(videoName)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || 'Source Video'
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

function isWorkspaceAnalysisResponse(value: HighlightReels | WorkspaceAnalysisResponse): value is WorkspaceAnalysisResponse {
  return typeof value === 'object' && value !== null && 'highlight_reels' in value
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
    clips: category.clips.filter((clip) => clipBelongsToVideo(game, clip, videoName)),
    assembly_notes: category.assembly_notes.filter((note) => note.toLowerCase().includes(normalizedVideoName)),
  }
}

function isOpaqueVideoReference(reference?: string | null) {
  const clean = cleanString(reference)
  if (!clean) return false
  if (clean.includes('.mp4') || clean.includes('/')) return false
  return (
    /^[0-9a-f]{24}$/i.test(clean)
    || /^6a[0-9a-f]{22}$/i.test(clean)
    || /^ksi_[0-9a-f-]+$/i.test(clean)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)
  )
}

function referencesSameVideo(_game: Game, left?: string | null, right?: string | null) {
  const a = cleanString(left)
  const b = cleanString(right)
  if (!a || !b) return false
  if (a === b) return true
  const normalizedLeft = normalizeSearchText(a)
  const normalizedRight = normalizeSearchText(b)
  if (normalizedLeft === normalizedRight) return true
  return normalizeSearchText(videoNameStem(a)) === normalizeSearchText(videoNameStem(b))
}

function mapsToDifferentSourceVideo(game: Game, reference: string, videoName: string) {
  const mapped = videoNameForReference(game, reference)
  if (!mapped || mapped === reference) return false
  if (referencesSameVideo(game, mapped, videoName)) return false
  if ((game.source_videos || []).includes(mapped)) return true
  return normalizeSearchText(mapped) !== normalizeSearchText(videoName)
}

function clipBelongsToVideo(game: Game, clip: Clip, videoName: string) {
  const resolved = videoNameForClip(game, clip)
  if (referencesSameVideo(game, resolved, videoName)) return true
  if (isOpaqueVideoReference(clip.video_reference) && !mapsToDifferentSourceVideo(game, clip.video_reference, videoName)) {
    return true
  }
  return false
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

function latestJockeySessionId(exchanges: JockeyChatExchange[]) {
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const sessionId = exchanges[index].response?.session_id?.trim()
    if (sessionId) return sessionId
  }
  return ''
}

function upsertJockeyChatExchange(exchanges: JockeyChatExchange[], nextExchange: JockeyChatExchange) {
  let matched = false
  const nextExchanges = exchanges.map((exchange) => {
    if (exchange.id !== nextExchange.id) return exchange
    matched = true
    return nextExchange
  })
  return matched ? nextExchanges : [...exchanges, nextExchange]
}

function jockeyConversationHistory(exchanges: JockeyChatExchange[], limit: number): JockeyConversationTurn[] {
  return exchanges
    .filter((exchange) => exchange.response && !exchange.error)
    .slice(-limit)
    .map((exchange) => ({
      prompt: exchange.prompt,
      narrative_summary: exchange.response?.narrative_summary,
      clips: (Array.isArray(exchange.response?.clips) ? exchange.response.clips : []).slice(0, 8).map((clip) => ({
        video_reference: clip.video_reference,
        start_time: clip.start_time,
        end_time: clip.end_time,
        moment_type: clip.moment_type,
        confidence: clip.confidence,
      })),
    }))
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
    return parsed
      .map(normalizeJockeyChatExchange)
      .filter((exchange): exchange is JockeyChatExchange => Boolean(exchange))
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

function normalizeJockeyChatExchange(value: unknown): JockeyChatExchange | null {
  if (!value || typeof value !== 'object') return null
  const exchange = value as Partial<JockeyChatExchange>
  if (typeof exchange.id !== 'string' || typeof exchange.prompt !== 'string' || typeof exchange.showReel !== 'boolean') return null
  return {
    id: exchange.id,
    prompt: exchange.prompt,
    skillKey: typeof exchange.skillKey === 'string' ? exchange.skillKey : undefined,
    response: exchange.response ? normalizeJockeyChatResponse(exchange.response, exchange.prompt) : undefined,
    error: typeof exchange.error === 'string' ? exchange.error : undefined,
    showReel: exchange.showReel,
  }
}

function normalizeJockeyChatResponse(value: unknown, fallbackMessage = ''): JockeyChatResponse {
  const response = value && typeof value === 'object' ? value as Partial<JockeyChatResponse> : {}
  return {
    session_id: typeof response.session_id === 'string' ? response.session_id : null,
    message: typeof response.message === 'string' ? response.message : fallbackMessage,
    narrative_summary: typeof response.narrative_summary === 'string' && response.narrative_summary.trim()
      ? response.narrative_summary
      : 'Jockey did not return a narrative summary.',
    clips: Array.isArray(response.clips)
      ? response.clips.map(normalizeJockeyManifestClip).filter((clip): clip is JockeyManifestClip => Boolean(clip))
      : [],
  }
}

function normalizeJockeyManifestClip(value: unknown, index: number): JockeyManifestClip | null {
  if (!value || typeof value !== 'object') return null
  const clip = value as Partial<JockeyManifestClip>
  const startTime = typeof clip.start_time === 'string' ? clip.start_time : ''
  const rationale = typeof clip.jockey_rationale === 'string' ? clip.jockey_rationale : ''
  if (!startTime || !rationale) return null
  const reference = typeof clip.video_reference === 'string' && clip.video_reference.trim()
    ? clip.video_reference
    : typeof clip.video_name === 'string'
      ? clip.video_name
      : ''
  if (!reference) return null
  return {
    id: typeof clip.id === 'string' && clip.id.trim() ? clip.id : `jockey-chat-cached-${index}`,
    video_name: typeof clip.video_name === 'string' ? clip.video_name : null,
    video_reference: reference,
    start_time: startTime,
    end_time: typeof clip.end_time === 'string' && clip.end_time.trim() ? clip.end_time : startTime,
    moment_type: typeof clip.moment_type === 'string' && clip.moment_type.trim() ? clip.moment_type : 'jockey_curated',
    emotional_intensity: typeof clip.emotional_intensity === 'string' && clip.emotional_intensity.trim() ? clip.emotional_intensity : 'unknown',
    jockey_rationale: rationale,
    confidence: typeof clip.confidence === 'number' && Number.isFinite(clip.confidence) ? clip.confidence : 0.75,
    highlight_potential: typeof clip.highlight_potential === 'number' && Number.isFinite(clip.highlight_potential) ? clip.highlight_potential : 0,
    source_asset_id: typeof clip.source_asset_id === 'string' ? clip.source_asset_id : null,
    thumbnail_url: typeof clip.thumbnail_url === 'string' ? clip.thumbnail_url : null,
    stream_info_path: typeof clip.stream_info_path === 'string' ? clip.stream_info_path : null,
    video_url: typeof clip.video_url === 'string' ? clip.video_url : null,
  }
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

function formatTimecodeLike(totalSeconds: number, template = '') {
  const rounded = Math.max(0, Math.round(totalSeconds))
  const wantsHours = template.split(':').length >= 3 || rounded >= 3600
  if (!wantsHours) return formatSeconds(rounded)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function deoverlapSequenceClips(clips: SequenceClip[]) {
  const lastEndBySource = new Map<string, number>()
  return clips.flatMap((clip) => {
    const sourceStart = secondsFromTime(clip.startTime)
    const sourceEnd = Math.max(secondsFromTime(clip.endTime), sourceStart + 1)
    const previousEnd = lastEndBySource.get(clip.sourceName) ?? -1
    const trimmedStart = Math.max(sourceStart, previousEnd)
    lastEndBySource.set(clip.sourceName, Math.max(previousEnd, sourceEnd))

    if (sourceEnd <= trimmedStart + 0.5) return []
    if (trimmedStart <= sourceStart + 0.05) return [clip]

    return [{
      ...clip,
      id: `${clip.id}-trimmed-${Math.round(trimmedStart * 1000)}`,
      startTime: formatTimecodeLike(trimmedStart, clip.startTime),
    }]
  })
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

function assemblyReelPlaybackTarget(game: Game, workspaceVideoName: string | undefined, clip: SequenceClip) {
  const playbackVideoName = workspaceVideoName || clip.sourceName
  const reference = cleanString(clip.videoReference)
  if ((game.source_videos || []).includes(playbackVideoName) || !isOpaqueVideoReference(playbackVideoName)) {
    return { videoName: playbackVideoName }
  }
  if (!reference) {
    return { videoName: playbackVideoName }
  }
  const mappedName = videoNameForReference(game, reference)
  if (mappedName && referencesSameVideo(game, mappedName, playbackVideoName)) {
    return { videoName: playbackVideoName }
  }
  return { videoName: playbackVideoName, reference }
}

function assemblyReelUrl(
  game: Game,
  videoName: string,
  clips: SequenceClip[],
  name: string,
  reference?: string,
  download = false,
) {
  const segments = clips
    .map((clip) => {
      const start = secondsFromTime(clip.startTime)
      const end = Math.max(secondsFromTime(clip.endTime), start + 1)
      return `${start.toFixed(3)}-${end.toFixed(3)}`
    })
    .join(';')
  const params = new URLSearchParams({
    segments,
    format: '16x9',
    name,
  })
  if (reference) params.set('reference', reference)
  if (download) params.set('download', '1')
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/assembly-reel/${encodeURIComponent(videoName)}?${params.toString()}`)
}

function assemblyReelStatusUrl(
  game: Game,
  videoName: string,
  clips: SequenceClip[],
  name: string,
  reference?: string,
) {
  const segments = clips
    .map((clip) => {
      const start = secondsFromTime(clip.startTime)
      const end = Math.max(secondsFromTime(clip.endTime), start + 1)
      return `${start.toFixed(3)}-${end.toFixed(3)}`
    })
    .join(';')
  const params = new URLSearchParams({
    segments,
    format: '16x9',
    name,
  })
  if (reference) params.set('reference', reference)
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/assembly-reel-status/${encodeURIComponent(videoName)}?${params.toString()}`)
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

function clipPosterUrl(
  game: Game,
  videoName: string,
  clip: Pick<Clip, 'start_time' | 'end_time'>,
  format: ReelFormatKey,
  indexVideos: IndexVideo[] = [],
  preferExactFrame = false,
) {
  if (preferExactFrame) {
    return reelThumbnailUrl(game, videoName, clip, format)
  }
  const indexedPoster = cleanString(indexVideoForName(game, indexVideos, videoName)?.thumbnail_url)
  if (indexedPoster) return indexedPoster
  return thumbnailForVideoName(game, videoName)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function seekVideoTo(video: HTMLVideoElement, seconds: number, fallbackDuration?: number) {
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : fallbackDuration
  const maxSeconds = duration && duration > 0 ? Math.max(duration, seconds) : Math.max(seconds, 0)
  const targetSeconds = clamp(seconds, 0, maxSeconds)
  if (typeof video.fastSeek === 'function') {
    try {
      video.fastSeek(targetSeconds)
      return targetSeconds
    } catch {
      // Some HLS-backed media elements expose fastSeek but reject until enough data is buffered.
    }
  }
  video.currentTime = targetSeconds
  return targetSeconds
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

function streamInfoForClip(game: Game, clip: Clip, workspaceVideoName?: string) {
  const mappedName = videoNameForReference(game, clip.video_reference)
  const playbackVideoName = workspaceVideoName || mappedName
  if (!playbackVideoName) return null
  return streamInfoForWorkspacePlayback(game, playbackVideoName, { videoReference: clip.video_reference })
}

function streamInfoForWorkspacePlayback(
  game: Game,
  workspaceVideoName: string,
  options?: { videoReference?: string | null },
) {
  const reference = cleanString(options?.videoReference)
  if ((game.source_videos || []).includes(workspaceVideoName) || !isOpaqueVideoReference(workspaceVideoName)) {
    return streamInfoForVideoName(game, workspaceVideoName)
  }
  if (!reference) {
    return streamInfoForVideoName(game, workspaceVideoName)
  }
  const mappedName = videoNameForReference(game, reference)
  if (
    mappedName
    && referencesSameVideo(game, mappedName, workspaceVideoName)
  ) {
    return streamInfoForVideoName(game, workspaceVideoName)
  }
  return streamInfoForSearchMoment(game, {
    videoName: workspaceVideoName,
    videoReference: reference,
    sourceAssetId: reference,
  })
}

function streamInfoForVideoName(game: Game, videoName: string) {
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/stream/${encodeURIComponent(videoName)}`)
}

function streamInfoForSearchMoment(
  game: Game,
  searchMoment: Pick<SearchMoment, 'videoName' | 'videoReference' | 'sourceAssetId'>,
) {
  const params = new URLSearchParams()
  const reference = cleanString(searchMoment.sourceAssetId) || cleanString(searchMoment.videoReference)
  if (reference) {
    params.set('reference', reference)
  }
  const query = params.toString()
  const base = `/games/${encodeURIComponent(game.tag)}/stream/${encodeURIComponent(searchMoment.videoName)}`
  return apiUrl(query ? `${base}?${query}` : base)
}

function thumbnailForVideoName(game: Game, videoName: string) {
  return apiUrl(`/games/${encodeURIComponent(game.tag)}/thumbnail/${encodeURIComponent(videoName)}`)
}

function indexVideoForName(game: Game, indexVideos: IndexVideo[], videoName: string) {
  return indexVideos.find((video) => {
    const candidates = [
      indexVideoWorkspaceName(game, video),
      cleanString(video.source_video_name),
      cleanString(video.metadata_source_video_name),
      cleanString(video.name),
      cleanString(video.display_name),
    ].filter(Boolean)
    return candidates.includes(videoName)
  })
}

function posterForVideoName(
  game: Game,
  videoName: string,
  discoverVideos: DiscoverVideo[] = [],
  indexVideos: IndexVideo[] = [],
) {
  const discoverVideo = discoverVideos.find((video) => video.video_name === videoName)
  const discoverPoster = cleanString(discoverVideo?.thumbnail_url)
  if (discoverPoster) return discoverPoster
  const indexedPoster = cleanString(indexVideoForName(game, indexVideos, videoName)?.thumbnail_url)
  if (indexedPoster) return indexedPoster
  if (discoverVideo?.thumbnail_path) return apiUrl(discoverVideo.thumbnail_path)
  return thumbnailForVideoName(game, videoName)
}

function uniqueVideoNames(sourceVideos: string[]) {
  return Array.from(new Set(sourceVideos.filter(Boolean)))
}

function uniqueIndexVideos(videos: IndexVideo[]) {
  const seen = new Set<string>()
  const ordered = orderIndexVideosForMetadataFirst(videos)
  return ordered.filter((video) => {
    const key = indexVideoDedupeKey(video)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function indexVideoDedupeKey(video: IndexVideo) {
  const sourceKey =
    cleanString(video.source_video_name)
    || cleanString(video.metadata_source_video_name)
    || cleanString(video.name)
    || cleanString(video.display_name)
  if (sourceKey) return `source:${sourceKey.toLowerCase()}`
  const assetKey = cleanString(video.indexed_asset_id) || cleanString(video.asset_id) || cleanString(video.id)
  return assetKey ? `asset:${assetKey.toLowerCase()}` : ''
}

function orderIndexVideosForMetadataFirst(videos: IndexVideo[]) {
  return [...videos].sort((left, right) => {
    const leftScore = Number(Boolean(left.has_jockey_highlight_metadata)) + Number(Boolean(left.has_pegasus_metadata))
    const rightScore = Number(Boolean(right.has_jockey_highlight_metadata)) + Number(Boolean(right.has_pegasus_metadata))
    return rightScore - leftScore
  })
}

function workspaceVideoNamesFromIndex(game: Game, videos: IndexVideo[]) {
  return uniqueVideoNames(uniqueIndexVideos(videos).map((video) => indexVideoWorkspaceName(game, video)))
}

function resolveWorkspaceVideoName(
  game: Game,
  workspaceVideoNames: string[],
  requestedVideoName: string,
  searchMoment?: SearchMoment,
) {
  const candidates = [
    requestedVideoName,
    searchMoment?.videoName,
    searchMoment?.videoReference,
    searchMoment?.sourceAssetId,
  ]

  for (const candidate of candidates) {
    const directMatch = matchingWorkspaceVideoName(game, workspaceVideoNames, candidate)
    if (directMatch) return directMatch

    const mappedName = candidate ? videoNameForReference(game, candidate) : undefined
    const mappedMatch = matchingWorkspaceVideoName(game, workspaceVideoNames, mappedName)
    if (mappedMatch) return mappedMatch
    if (mappedName && game.source_videos?.includes(mappedName)) return mappedName
  }

  return null
}

function matchingWorkspaceVideoName(game: Game, workspaceVideoNames: string[], candidate?: string | null) {
  const cleanCandidate = cleanString(candidate)
  if (!cleanCandidate) return null
  if (workspaceVideoNames.includes(cleanCandidate)) return cleanCandidate
  if (game.source_videos?.includes(cleanCandidate)) return cleanCandidate

  const normalizedCandidate = normalizeSearchText(cleanCandidate)
  const candidateStem = normalizeSearchText(videoNameStem(cleanCandidate))
  return (
    workspaceVideoNames.find((videoName) => {
      const normalizedVideoName = normalizeSearchText(videoName)
      const videoStem = normalizeSearchText(videoNameStem(videoName))
      return normalizedVideoName === normalizedCandidate || videoStem === candidateStem
    })
    || null
  )
}

function videoNameStem(value: string) {
  return value.split('/').pop()?.replace(/\.[^.]+$/, '') || value
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

function cleanString(value?: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function clipSelectionForVideo(game: Game, reels: HighlightReels, videoName: string): { category: MapCategoryKey; index: number } | null {
  const lanes = [
    ...categories.map((category) => category.key),
    'standard_stats' as const,
  ]
  for (const category of lanes) {
    const index = reels[category].clips.findIndex((clip) => clipBelongsToVideo(game, clip, videoName))
    if (index !== -1) return { category, index }
  }
  return null
}

function videoNameForClip(game: Game, clip: Clip) {
  return videoNameForReference(game, clip.video_reference)
}

function jockeyClipVideoName(game: Game, clip: JockeyManifestClip) {
  const backendName = cleanString(clip.video_name)
  if (backendName) return backendName
  return videoNameForReference(game, clip.video_reference)
}

function jockeyExchangeTargetVideos(game: Game, response: JockeyChatResponse) {
  const names = new Set<string>()
  for (const clip of response.clips || []) {
    const name = jockeyClipVideoName(game, clip)
    if (name) names.add(name)
  }
  return [...names]
}

function jockeyClipStreamInfoUrl(game: Game, clip: JockeyManifestClip) {
  if (clip.stream_info_path) return apiUrl(clip.stream_info_path)
  const sourceName = jockeyClipVideoName(game, clip)
  return sourceName ? streamInfoForVideoName(game, sourceName) : null
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
  if (reference.startsWith('ksi_')) {
    const bareReference = reference.slice(4)
    const bareMapped = game.video_reference_map?.[bareReference]
    if (bareMapped) return bareMapped
  } else {
    const prefixedMapped = game.video_reference_map?.[`ksi_${reference}`]
    if (prefixedMapped) return prefixedMapped
  }
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
  const registryMatch = sourceVideos.find((videoName) => {
    const normalizedVideo = normalizeSearchText(videoName)
    const stem = normalizeSearchText(videoName.replace(/\.[^.]+$/, ''))
    return normalizedReference === normalizedVideo || normalizedReference.includes(normalizedVideo) || normalizedReference.includes(stem) || normalizedVideo.includes(normalizedReference)
  })
  if (registryMatch) return registryMatch

  return reference
}

function gameOptionLabel(game: Game) {
  return game.label === game.sport ? game.label : `${game.label} · ${game.sport}`
}

function searchResultItems(game: Game, response: MarengoSearchResponse): DiscoverItem[] {
  return response.results
    .map((result, index) => discoverItemFromSearchResult(game, response, result, index))
    .filter((item): item is DiscoverItem => Boolean(item))
}

function discoverItemFromSearchResult(
  game: Game,
  response: MarengoSearchResponse,
  result: MarengoSearchResult,
  index: number,
): DiscoverItem | null {
  const videoName =
    videoNameForReference(game, result.video_reference)
    || (result.source_asset_id ? videoNameForReference(game, result.source_asset_id) : undefined)
    || cleanString(result.video_name)
  if (!videoName) return null
  const startTime = result.start_time || result.timestamp
  const endTime = result.end_time
  const title = result.title || result.description
  const subtitle = `${videoName}${startTime ? ` · ${startTime}${endTime ? `-${endTime}` : ''}` : ''}`
  const searchMoment: SearchMoment = {
    videoName,
    videoReference: result.video_reference,
    query: response.query,
    sourceAssetId: result.source_asset_id,
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
    media: streamInfoForSearchMoment(game, searchMoment),
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
    searchRank: typeof result.rank === 'number' ? result.rank : index + 1,
    searchMoment,
  }
}

function responseScore(result: MarengoSearchResult, index: number) {
  return typeof result.confidence === 'number' && Number.isFinite(result.confidence)
    ? result.confidence
    : 1 / (index + 1)
}

function indexReadyDiscoverItems(
  game: Game,
  indexVideos: IndexVideo[],
  discoverVideos: DiscoverVideo[],
): DiscoverItem[] {
  const discoverByName = new Map(discoverVideos.map((video) => [video.video_name, video]))
  const readyIndexVideos = uniqueIndexVideos(
    indexVideos.filter((video) => cleanString(video.status) === 'ready' && cleanString(video.asset_id)),
  )
  const videoNames = workspaceVideoNamesFromIndex(game, readyIndexVideos)
  const indexedDiscoverVideos = videoNames
    .map((videoName) => {
      const discoverVideo = discoverByName.get(videoName)
      if (discoverVideo?.in_live_index && discoverVideo.playback_ready !== false) {
        return discoverVideo
      }
      const indexedVideo = indexVideoForName(game, readyIndexVideos, videoName)
      if (!indexedVideo) return null
      return {
        video_name: videoName,
        status: cleanString(indexedVideo.status) || 'ready',
        in_live_index: true,
        playback_ready: true,
        stream_info_path: `/games/${encodeURIComponent(game.tag)}/stream/${encodeURIComponent(videoName)}`,
        thumbnail_url: cleanString(indexedVideo.thumbnail_url) || null,
      } satisfies DiscoverVideo
    })
    .filter((video): video is DiscoverVideo => Boolean(video))

  return discoverVideoItems(game, indexedDiscoverVideos, indexVideos)
}

function discoverVideoItems(
  game: Game,
  discoverVideos: DiscoverVideo[],
  indexVideos: IndexVideo[] = [],
): DiscoverItem[] {
  return discoverVideos.map((video, index) => ({
    id: `${game.tag}-${video.video_name}-${index}`,
    label: 'Indexed Video',
    title: video.video_name,
    subtitle: video.status || 'TwelveLabs index',
    media: video.stream_info_path ? apiUrl(video.stream_info_path) : streamInfoForVideoName(game, video.video_name),
    poster: posterForVideoName(game, video.video_name, discoverVideos, indexVideos),
    videoName: video.video_name,
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

function sourceVideoItems(
  game: Game,
  sourceVideos: string[],
  discoverVideos: DiscoverVideo[] = [],
  indexVideos: IndexVideo[] = [],
): DiscoverItem[] {
  const discoverByName = new Map(discoverVideos.map((video) => [video.video_name, video]))
  return Array.from(new Set(sourceVideos)).map((videoName, index) => {
    const discoverVideo = discoverByName.get(videoName)
    const media = discoverVideo?.stream_info_path
      ? apiUrl(discoverVideo.stream_info_path)
      : streamInfoForVideoName(game, videoName)
    return {
    id: `${game.tag}-${videoName}-${index}`,
    label: discoverVideo?.indexed ? 'Indexed Video' : 'Source Video',
    title: videoName,
    subtitle: discoverVideo?.indexed ? 'TwelveLabs index' : discoverVideo?.status || '',
    media,
    poster: posterForVideoName(game, videoName, discoverVideos, indexVideos),
    videoName,
    knowledgeStoreId: game.knowledge_store_id,
    clipCount: 0,
    semanticCount: 0,
    matches: [],
    matchHeading: 'Matched Evidence',
    searchScore: 0,
    hasMarengoSearch: false,
    resultType: 'video',
  }})
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

function selectedClipAnalysisCacheKey(tag: string, moment: SearchMoment) {
  return [
    tag,
    moment.videoName,
    moment.startTime || '0:00',
    moment.endTime || '',
    normalizeSearchText(moment.query || moment.title || ''),
  ].join('|')
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

function warmHlsManifest(manifestUrl: string) {
  if (!manifestUrl) return Promise.resolve()
  const existingRequest = manifestWarmupRequests.get(manifestUrl)
  if (existingRequest) return existingRequest
  const request = fetch(manifestUrl, {
    cache: 'force-cache',
    mode: 'cors',
  })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      manifestWarmupRequests.delete(manifestUrl)
    })
  manifestWarmupRequests.set(manifestUrl, request)
  return request
}

function startDownloadAfterHlsWarmup(
  event: MouseEvent<HTMLAnchorElement>,
  streamInfoUrl: string | null | undefined,
  downloadUrl: string,
) {
  event.preventDefault()
  event.stopPropagation()

  void warmTwelveLabsStreamForExport(streamInfoUrl)
    .catch(() => undefined)
    .finally(() => {
      triggerBrowserDownload(downloadUrl)
    })
}

async function warmTwelveLabsStreamForExport(streamInfoUrl: string | null | undefined) {
  if (!streamInfoUrl) return
  const stream = await fetchTwelveLabsStreamInfo(streamInfoUrl)
  const manifestUrl = secureHttpsUrl(stream.manifest_url)
  if (!manifestUrl) return
  preconnectManifestOrigin(manifestUrl)
  await warmHlsManifest(manifestUrl)
}

function triggerBrowserDownload(downloadUrl: string) {
  if (typeof document === 'undefined') {
    window.location.href = downloadUrl
    return
  }
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = ''
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  clientSessionId()
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

function prefetchTwelveLabsStream(streamInfoUrl: string) {
  void fetchTwelveLabsStreamInfo(streamInfoUrl)
    .then((stream) => {
      const manifestUrl = secureHttpsUrl(stream.manifest_url)
      if (manifestUrl) warmHlsManifest(manifestUrl)
    })
    .catch(() => undefined)
}

async function fetchTwelveLabsStreamInfo(url: string, signal?: AbortSignal): Promise<TwelveLabsStreamInfo> {
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError')
  }
  const cached = streamInfoCache.get(url)
  if (cached) return cached

  let request = streamInfoRequests.get(url)
  if (!request) {
    request = fetchJson<TwelveLabsStreamInfo>(url, { cache: 'force-cache' })
      .then((stream) => {
        streamInfoCache.set(url, stream)
        const manifestUrl = secureHttpsUrl(stream.manifest_url)
        if (manifestUrl) {
          preconnectManifestOrigin(manifestUrl)
          warmHlsManifest(manifestUrl)
        }
        return stream
      })
      .finally(() => {
        streamInfoRequests.delete(url)
      })
    streamInfoRequests.set(url, request)
  }

  return abortablePromise(request, signal)
}

function abortablePromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'))

  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Request aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

export default App
