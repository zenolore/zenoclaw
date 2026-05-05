import fs from 'node:fs'

export const SUPPORTED_VIDEO_FACTORY_PLATFORMS = ['toutiao', 'baijiahao', 'douyin']

export function assertSupportedVideoFactoryPlatform(platform) {
  if (!SUPPORTED_VIDEO_FACTORY_PLATFORMS.includes(platform)) {
    throw new Error(`不支持的视频发布平台: ${platform}，可选: ${SUPPORTED_VIDEO_FACTORY_PLATFORMS.join(', ')}`)
  }
}

export function bundleToVideoPost(bundle, platform, options = {}) {
  if (!bundle || typeof bundle !== 'object') throw new Error('缺少 video-factory publish bundle')
  assertSupportedVideoFactoryPlatform(platform)
  const targets = Array.isArray(bundle.targetPlatforms) ? bundle.targetPlatforms : []
  if (targets.length > 0 && !targets.includes(platform)) {
    throw new Error(`${platform} 不是该 bundle 的目标平台，可选: ${targets.join(', ')}`)
  }
  const copy = bundle.platformCopies?.[platform]
  if (!copy) throw new Error(`bundle 缺少 ${platform} 平台文案`)
  const videoPath = bundle.video?.absolutePath
  if (!videoPath) throw new Error('bundle 缺少 video.absolutePath')
  if (options.requireFiles !== false && !fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`)
  }
  const douyinLandscapeCoverPath = bundle.cover?.douyin?.landscape4x3?.absolutePath || null
  const douyinPortraitCoverPath = bundle.cover?.douyin?.portrait3x4?.absolutePath || null
  const coverPath = platform === 'douyin'
    ? (douyinPortraitCoverPath || douyinLandscapeCoverPath || bundle.cover?.absolutePath || null)
    : (bundle.cover?.absolutePath || null)
  const usableCoverPath = coverPath && (!options.requireFiles || fs.existsSync(coverPath)) ? coverPath : null
  const usableDouyinLandscapeCoverPath = douyinLandscapeCoverPath && (!options.requireFiles || fs.existsSync(douyinLandscapeCoverPath)) ? douyinLandscapeCoverPath : null
  const usableDouyinPortraitCoverPath = douyinPortraitCoverPath && (!options.requireFiles || fs.existsSync(douyinPortraitCoverPath)) ? douyinPortraitCoverPath : null
  return {
    contentType: 'video',
    source: 'video-factory',
    projectId: bundle.projectId,
    sourceArticleId: bundle.sourceArticleId,
    sourceArticleTargetPlatform: bundle.sourceArticleTargetPlatform || null,
    variant: bundle.variant || null,
    platform,
    title: copy.title || bundle.title || '未命名视频',
    content: copy.body || '',
    description: copy.body || '',
    tags: Array.isArray(copy.hashtags) ? copy.hashtags : [],
    videoPath,
    coverPath: usableCoverPath,
    coverPaths: platform === 'douyin'
      ? {
          landscape4x3: usableDouyinLandscapeCoverPath,
          portrait3x4: usableDouyinPortraitCoverPath,
        }
      : undefined,
    dryRun: options.dryRun !== false,
  }
}

export function buildPublishPostCliArgs(post, options = {}) {
  const args = [
    '--platform', post.platform,
    '--title', post.title || '',
    '--content', post.content || '',
    '--description', post.description || post.content || '',
    '--videoPath', post.videoPath,
    '--mode', options.mode || (post.dryRun ? 'review' : 'publish'),
  ]
  if (post.coverPath) args.push('--coverPath', post.coverPath)
  if (post.coverPaths?.landscape4x3) args.push('--coverLandscapePath', post.coverPaths.landscape4x3)
  if (post.coverPaths?.portrait3x4) args.push('--coverPortraitPath', post.coverPaths.portrait3x4)
  if (post.tags?.length) args.push('--tags', post.tags.join(','))
  if (options.port) args.push('--port', String(options.port))
  return args
}

export class VideoFactoryPublishClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || 'http://127.0.0.1:4322').replace(/\/$/, '')
    this.token = options.token || process.env.VIDEO_FACTORY_PUBLISH_TOKEN || ''
  }

  headers() {
    const headers = { 'Content-Type': 'application/json' }
    if (this.token) headers['X-Publish-Token'] = this.token
    return headers
  }

  async request(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || `video-factory HTTP ${res.status}`)
    }
    return data
  }

  async listPending(platform, query = {}) {
    assertSupportedVideoFactoryPlatform(platform)
    const params = new URLSearchParams({ platform })
    if (query.limit) params.set('limit', String(query.limit))
    if (query.includeFailed === false) params.set('includeFailed', '0')
    return this.request('GET', `/api/video-factory/publish/pending?${params.toString()}`)
  }

  async claim(projectId, platform, clientId = 'zenoclaw-evo') {
    assertSupportedVideoFactoryPlatform(platform)
    return this.request('POST', `/api/video-factory/projects/${projectId}/publish-claim`, { platform, clientId })
  }

  async reportResult(projectId, platform, claimToken, result) {
    assertSupportedVideoFactoryPlatform(platform)
    return this.request('POST', `/api/video-factory/projects/${projectId}/publish-result`, {
      platform,
      claimToken,
      success: !!result.success,
      externalPostId: result.externalPostId,
      externalUrl: result.externalUrl || result.publishedUrl,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage || result.message,
      meta: result.meta,
    })
  }
}
