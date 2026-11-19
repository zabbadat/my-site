# YouTube relay for Zabba Washers Live Match (not provisioned)

The Live tab’s **peer-to-peer WebRTC mesh** already uses **Cloudflare Realtime TURN** when a direct connection fails. That went live on 14 November 2026 (main `bc20c50`; Netlify `CF_TURN_KEY_ID` / `CF_TURN_API_SECRET` set). It is only a NAT relay for watchers of a match code. It is **not** a YouTube path, and this branch does not change it.

YouTube is a **separate** small server you run:

- In: **WHIP / WebRTC** from the phone or browser (the already PFP-covered stream).
- Out: **RTMP / RTMPS** directly to YouTube (`rtmp://a.rtmp.youtube.com/live2/<KEY>`).
- The YouTube stream key stays on that server only. The site never sees it.

Nothing in this branch creates, pays for, or points at a specific host.

## Why not Cloudflare Stream for this hop

Cloudflare Stream is **optional** and not required. Its **WHIP inputs cannot simulcast** (restream via RTMP/SRT). Cloudflare documents that WHIP and WHEP must be used together, and that simulcasting is not supported for WHIP inputs. See [Ultra-low Latency with WebRTC — Limitations](https://developers.cloudflare.com/stream/webrtc/). Stream can simulcast **RTMP/SRT inputs** to YouTube, but a browser or app leaving over WHIP cannot use that as the WHIP→YouTube hop. Do not plan on it for this path.

The existing **Cloudflare Realtime TURN** service stays what it is: a Live-tab NAT relay. It does not forward to YouTube.

## Relay software (host-agnostic)

- **[MediaMTX](https://github.com/bluenviron/mediamtx)** (WHIP ingest + RTMP path / ffmpeg egress), or a thin **ffmpeg / GStreamer** front end that accepts WHIP/WebRTC and pushes RTMP to YouTube.
- **Host is TBD** — a small cloud VPS or a home Mac mini are both fine. The site only needs the public WHIP URL. This code does not care which you pick, and nothing has been provisioned.

## What to set up (owner), once a host is chosen

1. A YouTube live event (or Stream Now) in YouTube Studio. Copy the **stream key** into the relay only — never into the website repo, Netlify UI, chat, or the iOS app.
2. Run MediaMTX or ffmpeg/GStreamer on the chosen host so it accepts WHIP and forwards RTMP to YouTube.
3. On Netlify, set **`LIVE_WHIP_URL`** to that WHIP endpoint (a secret in the path is fine). Do not set a `YOUTUBE_STREAM_KEY` on Netlify; `youtube-whip.js` will not return one even if present. Do not reuse the TURN env vars for this.
4. After the env var is set, the Live Match “YouTube” button can start WHIP from the **PFP-covered** stream. Until then, the button reports that YouTube isn’t set up.

## Cost (check current prices before paying)

- **YouTube Live** for a standard verified channel has no extra YouTube ingest fee. Confirm at https://support.google.com/youtube/answer/2853702
- **MediaMTX** is open source (Apache 2.0). You only pay the host. A small 2 vCPU VPS is typically enough for one 720p, 2-person match (often in the $5–12/month range — confirm with the host). A home Mac mini is electricity plus your upload (YouTube 1080p usually wants a steady 4–8 Mbps up).
- The already-live Cloudflare Realtime TURN usage is unchanged; no new Cloudflare Stream live input is required.

This path is **code only** in this branch. No YouTube relay was created, and no Netlify env var was set.
