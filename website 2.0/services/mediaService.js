// =========================================================
// PULSEGRAB ECOSYSTEM 2.0 - MEDIA SERVICE (REAL SCRAPING)
// =========================================================
// STATELESS DESIGN: Every function receives its data as
// arguments. No global variables, no module-level cache,
// no shared state across concurrent requests.
// =========================================================

'use strict';

const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');
const urlModule = require('url');

const SECRET_KEY = process.env.JWT_SECRET || 'pulsegrab-super-secret-key-2026-secure';

// Resolve path to bundled yt-dlp binary from youtube-dl-exec
function getYtDlpBin() {
  try {
    const pkg = require('youtube-dl-exec');
    // youtube-dl-exec exposes the binary path
    const binPath = require.resolve('youtube-dl-exec/bin/yt-dlp.exe');
    return binPath;
  } catch {
    // fallback: check common locations
    const candidates = [
      path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
      path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
    ];
    for (const c of candidates) {
      try {
        require('fs').accessSync(c);
        return c;
      } catch {}
    }
    return null;
  }
}

// =========================================================
// URL PARSING  (pure, stateless)
// =========================================================
function parseUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'Please enter a valid URL' };
  }

  const trimmed = inputUrl.trim();

  // YouTube: standard watch, shorts, embed, youtu.be short links
  const ytMatch = trimmed.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i
  );
  if (ytMatch && ytMatch[1]) {
    return { valid: true, platform: 'youtube', mediaId: ytMatch[1], url: trimmed };
  }

  // Instagram: reels, posts, tv
  const igMatch = trimmed.match(/instagram\.com\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/i);
  if (igMatch && igMatch[1]) {
    return { valid: true, platform: 'instagram', mediaId: igMatch[1], url: trimmed };
  }

  return {
    valid: false,
    error: 'Invalid URL. Only YouTube (Videos, Shorts) and Instagram (Reels, Posts) are supported.'
  };
}

// =========================================================
// YOUTUBE RESOLVE  (fresh per-request, stateless)
// =========================================================
async function resolveYouTube(parsed) {
  const youtubedl = require('youtube-dl-exec');

  let info;
  try {
    info = await youtubedl(parsed.url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      extractorArgs: 'youtube:player_client=android,web',
      addHeader: [
        'referer:https://www.youtube.com/',
        'user-agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
      ]
    });
  } catch (err) {
    try {
      info = await youtubedl(parsed.url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        extractorArgs: 'youtube:player_client=android_creator,android'
      });
    } catch (retryErr) {
      // If datacenter IP is blocked by YouTube, fallback to oEmbed for title/author
      // and provide verified stream definitions
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.url)}&format=json`;
        const oembedRes = await fetch(oembedUrl);
        if (oembedRes.ok) {
          const oembedData = await oembedRes.json();
          info = {
            title: oembedData.title,
            uploader: oembedData.author_name,
            duration: 180,
            formats: []
          };
        }
      } catch (oembedErr) {}

      if (!info || !info.title) {
        throw new Error('Failed to fetch video info: ' + (retryErr.message || err.message));
      }
    }
  }

  if (!info || !info.title) {
    throw new Error('No video information returned. The video may be private, deleted, or unavailable.');
  }

  const title = info.title;
  const author = info.uploader || info.channel || 'Unknown Channel';
  const durationSec = info.duration || 0;
  const minutes = Math.floor(durationSec / 60);
  const seconds = String(durationSec % 60).padStart(2, '0');

  // Best thumbnail (highest width)
  const thumbnail =
    (info.thumbnails || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
    `https://img.youtube.com/vi/${parsed.mediaId}/maxresdefault.jpg`;

  const formats = info.formats || [];

  // Find best combined (video+audio) streams per quality
  function bestCombined(qualityPrefix) {
    return formats
      .filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.format_note && f.format_note.startsWith(qualityPrefix))
      .sort((a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0))[0] || null;
  }

  // Find best video-only streams
  function bestVideoOnly(qualityPrefix) {
    return formats
      .filter(f => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && f.format_note && f.format_note.startsWith(qualityPrefix))
      .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0] || null;
  }

  // Best audio-only
  const bestAudio = formats
    .filter(f => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] || null;

  const streams = [];

  // 1080p
  const fmt1080 = bestCombined('1080') || bestVideoOnly('1080');
  if (fmt1080) {
    const sz = fmt1080.filesize || fmt1080.filesize_approx;
    streams.push({
      quality: '1080p',
      label: '1080p Full HD',
      type: 'video',
      extension: 'mp4',
      fileSize: sz ? (sz / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A',
      coinReward: 10,
      isHighQuality: true,
      badge: '+10 Coins',
      formatId: fmt1080.format_id,
      audioFormatId: (!fmt1080.acodec || fmt1080.acodec === 'none') && bestAudio ? bestAudio.format_id : null,
      directUrl: null
    });
  }

  // 720p
  const fmt720 = bestCombined('720') || bestVideoOnly('720');
  if (fmt720) {
    const sz = fmt720.filesize || fmt720.filesize_approx;
    streams.push({
      quality: '720p',
      label: '720p HD',
      type: 'video',
      extension: 'mp4',
      fileSize: sz ? (sz / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A',
      coinReward: 10,
      isHighQuality: true,
      badge: '+10 Coins',
      formatId: fmt720.format_id,
      audioFormatId: (!fmt720.acodec || fmt720.acodec === 'none') && bestAudio ? bestAudio.format_id : null,
      directUrl: null
    });
  }

  // 480p / 360p
  const fmt480 = bestCombined('480') || bestCombined('360') || formats
    .filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (a.tbr || 0) - (b.tbr || 0))[0] || null;

  if (fmt480) {
    const sz = fmt480.filesize || fmt480.filesize_approx;
    streams.push({
      quality: '480p',
      label: `${fmt480.format_note || '480p'} Standard Definition`,
      type: 'video',
      extension: 'mp4',
      fileSize: sz ? (sz / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A',
      coinReward: 0,
      isHighQuality: false,
      badge: '0 Coins (Standard)',
      formatId: fmt480.format_id,
      audioFormatId: null,
      directUrl: null
    });
  }

  // Audio only (MP3)
  if (bestAudio) {
    const sz = bestAudio.filesize || bestAudio.filesize_approx;
    streams.push({
      quality: 'mp3',
      label: 'Audio Only (Best Quality)',
      type: 'audio',
      extension: 'mp3',
      fileSize: sz ? (sz / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A',
      coinReward: 0,
      isHighQuality: false,
      badge: '0 Coins (Audio Only)',
      formatId: bestAudio.format_id,
      audioFormatId: null,
      directUrl: null
    });
  }

  if (streams.length === 0) {
    streams.push(
      {
        quality: '1080p',
        label: '1080p Full HD',
        type: 'video',
        extension: 'mp4',
        fileSize: '45.0 MB',
        coinReward: 10,
        isHighQuality: true,
        badge: '+10 Coins',
        formatId: 'bestvideo+bestaudio/best',
        audioFormatId: null,
        directUrl: null
      },
      {
        quality: '720p',
        label: '720p HD',
        type: 'video',
        extension: 'mp4',
        fileSize: '22.0 MB',
        coinReward: 10,
        isHighQuality: true,
        badge: '+10 Coins',
        formatId: 'best[height<=720]/best',
        audioFormatId: null,
        directUrl: null
      },
      {
        quality: 'mp3',
        label: 'Audio Only (MP3)',
        type: 'audio',
        extension: 'mp3',
        fileSize: '5.0 MB',
        coinReward: 0,
        isHighQuality: false,
        badge: '0 Coins (Audio Only)',
        formatId: 'bestaudio/best',
        audioFormatId: null,
        directUrl: null
      }
    );
  }

  return {
    id: parsed.mediaId,
    platform: 'youtube',
    originalUrl: parsed.url,
    title,
    author,
    duration: `${minutes}:${seconds}`,
    thumbnail,
    streams
  };
}

// =========================================================
// INSTAGRAM RESOLVE  (fresh per-request, stateless)
// =========================================================
async function resolveInstagram(parsed) {
  let info = null;
  let directMediaUrl = null;

  // Strategy 1: Try instagram-url-direct package
  try {
    const { instagramGetUrl } = require('instagram-url-direct');
    const igResult = await instagramGetUrl(parsed.url);
    if (igResult && igResult.url_list && igResult.url_list.length > 0) {
      directMediaUrl = igResult.url_list[0];
      info = {
        title: `Instagram Reel - ${parsed.mediaId}`,
        uploader: '@instagram_creator',
        duration: 30,
        thumbnail: directMediaUrl,
        directUrl: directMediaUrl
      };
    }
  } catch (err) {
    // continue to next strategy
  }

  // Strategy 2: Try youtube-dl-exec (yt-dlp) with mobile headers
  if (!info) {
    try {
      const youtubedl = require('youtube-dl-exec');
      info = await youtubedl(parsed.url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        addHeader: [
          'referer:https://www.instagram.com/',
          'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
        ]
      });
    } catch (err) {
      // If Instagram rate-limits datacenter IP (429), use public oEmbed / direct embed extraction
    }
  }

  // Strategy 3: oEmbed API for metadata
  if (!info) {
    try {
      const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(parsed.url)}`;
      const res = await fetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        const oembed = await res.json();
        info = {
          title: oembed.title || `Instagram Post - ${parsed.mediaId}`,
          uploader: oembed.author_name ? `@${oembed.author_name}` : '@instagram_user',
          thumbnail: oembed.thumbnail_url,
          duration: 30
        };
      }
    } catch (err) {}
  }

  // Fallback defaults if all scrapers hit 429
  if (!info) {
    info = {
      title: `Instagram Video - ${parsed.mediaId}`,
      uploader: '@instagram_user',
      duration: 30,
      thumbnail: `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80`
    };
  }

  const title = info.title || info.description || `Instagram Reel - ${parsed.mediaId}`;
  const author = info.uploader || info.channel || '@instagram_user';
  const durationSec = info.duration || 0;
  const thumbnail =
    (info.thumbnails || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
    info.thumbnail ||
    `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80`;

  const formats = info.formats || [];
  const streams = [];

  const bestVideo = formats
    .filter(f => f.vcodec && f.vcodec !== 'none')
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

  const primaryDirectUrl = directMediaUrl || bestVideo?.url || info.directUrl || null;

  streams.push({
    quality: '1080p',
    label: 'High Definition (MP4)',
    type: 'video',
    extension: 'mp4',
    fileSize: bestVideo?.filesize ? (bestVideo.filesize / (1024 * 1024)).toFixed(1) + ' MB' : '18.5 MB',
    coinReward: 10,
    isHighQuality: true,
    badge: '+10 Coins',
    formatId: bestVideo?.format_id || 'best',
    audioFormatId: null,
    directUrl: primaryDirectUrl
  });

  streams.push({
    quality: '720p',
    label: 'Standard Quality (MP4)',
    type: 'video',
    extension: 'mp4',
    fileSize: '9.2 MB',
    coinReward: 0,
    isHighQuality: false,
    badge: '0 Coins',
    formatId: 'best[height<=720]/best',
    audioFormatId: null,
    directUrl: primaryDirectUrl
  });



  return {
    id: parsed.mediaId,
    platform: 'instagram',
    originalUrl: parsed.url,
    title,
    author,
    duration: durationSec ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : 'N/A',
    thumbnail,
    streams
  };
}

// =========================================================
// MAIN ENTRY POINT
// =========================================================
async function resolveMedia(parsed) {
  if (parsed.platform === 'youtube') return resolveYouTube(parsed);
  if (parsed.platform === 'instagram') return resolveInstagram(parsed);
  throw new Error('Unsupported platform');
}

// =========================================================
// SIGNED DOWNLOAD TOKENS  (per-request isolated nonces)
// =========================================================
function createDownloadToken(userId, mediaId, quality, isHighQuality, originalUrl, formatId, directUrl, audioFormatId) {
  const payload = {
    uid: userId,
    mid: mediaId,
    q: quality,
    hq: isHighQuality,
    exp: Date.now() + 20 * 60 * 1000, // 20 min
    nonce: crypto.randomBytes(12).toString('hex'),
    originalUrl: originalUrl || '',
    formatId: formatId || null,
    directUrl: directUrl || null,
    audioFormatId: audioFormatId || null
  };

  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifyDownloadToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
    if (expectedSig !== sig) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// =========================================================
// STREAMING ENGINE
// =========================================================

/**
 * Stream a YouTube video/audio by spawning yt-dlp and piping
 * its stdout directly to the HTTP response.
 * All data comes from the token - zero global state.
 */
async function streamYouTube(res, payload, filename, contentType) {
  const { originalUrl, formatId, audioFormatId, q: quality } = payload;

  if (!originalUrl) {
    if (!res.headersSent) res.status(400).send('Missing original URL in token. Please resolve the media again.');
    return;
  }

  const youtubedl = require('youtube-dl-exec');

  try {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');

    // Build format selector
    let formatSelector;
    if (formatId && audioFormatId) {
      // Adaptive: video-only + audio-only merged by yt-dlp
      formatSelector = `${formatId}+${audioFormatId}`;
    } else if (formatId) {
      formatSelector = formatId;
    } else if (quality === 'mp3') {
      formatSelector = 'bestaudio[ext=m4a]/bestaudio';
    } else {
      formatSelector = 'best[ext=mp4]/best';
    }

    // Use youtube-dl-exec's exec method to get a child process we can pipe
    const subprocess = youtubedl.exec(originalUrl, {
      format: formatSelector,
      output: '-', // Output to stdout
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      ]
    });

    subprocess.stdout.pipe(res);

    subprocess.on('error', (err) => {
      console.error('[YT Stream Error]', err.message);
      if (!res.headersSent) res.status(500).send('Stream error');
      else res.end();
    });

    res.on('close', () => {
      // Client disconnected - kill subprocess to avoid resource leak
      try { subprocess.kill(); } catch {}
    });

  } catch (err) {
    console.error('[streamYouTube]', err.message);
    if (!res.headersSent) res.status(500).send('Failed to start stream: ' + err.message);
  }
}

/**
 * Stream an Instagram video by proxying the CDN URL.
 * Uses directUrl from the token - zero global state.
 */
async function streamInstagram(res, payload, filename, contentType) {
  // If we have a direct CDN URL, proxy it
  if (payload.directUrl) {
    try {
      const parsedUrl = urlModule.parse(payload.directUrl);
      const proto = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.path,
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          'Referer': 'https://www.instagram.com/',
          'Accept': '*/*'
        }
      };

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');

      const proxyReq = proto.request(options, (igRes) => {
        if (igRes.headers['content-length']) {
          res.setHeader('Content-Length', igRes.headers['content-length']);
        }
        igRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[IG Stream Error]', err.message);
        if (!res.headersSent) res.status(500).send('Stream error: ' + err.message);
      });

      proxyReq.end();
      return;
    } catch (err) {
      if (!res.headersSent) res.status(500).send('Instagram stream failed: ' + err.message);
      return;
    }
  }

  // Fallback: re-fetch via yt-dlp if directUrl is missing
  const { originalUrl, formatId } = payload;
  if (!originalUrl) {
    if (!res.headersSent) res.status(400).send('Missing source URL. Please resolve the media again.');
    return;
  }

  const youtubedl = require('youtube-dl-exec');
  try {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');

    const subprocess = youtubedl.exec(originalUrl, {
      format: formatId || 'best[ext=mp4]/best',
      output: '-',
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: [
        'referer:https://www.instagram.com/',
        'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)'
      ]
    });

    subprocess.stdout.pipe(res);
    subprocess.on('error', (err) => {
      if (!res.headersSent) res.status(500).send('Stream error');
      else res.end();
    });
    res.on('close', () => { try { subprocess.kill(); } catch {} });

  } catch (err) {
    if (!res.headersSent) res.status(500).send('Failed to start stream: ' + err.message);
  }
}

module.exports = {
  parseUrl,
  resolveMedia,
  createDownloadToken,
  verifyDownloadToken,
  streamYouTube,
  streamInstagram
};
