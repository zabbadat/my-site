# External camera (DJI Osmo Pocket 3) for arena-style court coverage — feasibility

Plan only. This does not block the iOS-first Go Live + Record work or the TestFlight build. Nothing was provisioned, and no court-camera path is required to ship voice scoring, PFP-covered outbound, or Record.

Goal: a wide court / arena shot from an external camera (example: Osmo Pocket 3) goes through the app’s **PFP face tracking + logo cover before it leaves** for the mesh, the WHIP relay, or YouTube. Only the covered picture is allowed out.

## What pfp.js does today

`ZabPfp.frame(vid, kps, …)` tracks **one head per camera id**. Live Match already feeds it `poses[0]` only. The fail-safe shield paints that one logo. A court-wide shot with two players (and maybe spectators) needs a multi-person extension: `estimatePoses` with multiple poses, one tracker and logo per detected face, and a fail-safe that does **not** let an uncovered face through if a person is present but not locked. That work is not in this branch and should land before any wide-shot source is offered as a live input.

The existing `sourceStream` / in-DOM `shieldCanvas.captureStream` path is the right egress once multiple logos are drawn on that same shield.

## Route 1 — Osmo as a UVC webcam, cover on-device (preferred for zero exposure)

DJI documents Webcam mode: power on Pocket 3, USB-C data cable, tap **Webcam**. It then appears as a standard **UVC** device (label is often “UVC Camera”). Firmware v01.04.08.02 added 4K UVC at 25/30p; later firmware added 10-bit D-Log M. Audio over the UVC link should be verified, not assumed. Official sequence: [Osmo Pocket 3 user manual](https://dl.djicdn.com/downloads/DJI_Osmo_Pocket_3/UM/20231110/DJI_Osmo_Pocket_3_User_Manual_v1.0_en.pdf).

Once the frame is a `getUserMedia` (or native capture) stream, it can enter the same `#zlSelf` / `ZabPfp` pipeline as the phone camera. `WashersLive.listCameras()` / `getCamera(facing, deviceId)` already accept a `deviceId` so a picker can be wired later. No visible picker is in the Live Match chrome yet — iPhone cannot use this route, and shipping a dead control on the flagship phone would be confusing.

| Surface | Feasible? | Notes |
|---|---|---|
| **Desktop browser** (Safari / Chrome / Edge / Firefox on macOS or Windows) | **Yes — best Route 1 path today** | `enumerateDevices` + `getUserMedia({ video: { deviceId } })` lists UVC webcams. Cover with pfp.js, send `captureStream` to WebRTC / WHIP. This is the practical way to try a Pocket 3 court shot against the current site branch (local or a future preview), without a store build. |
| **iPad (USB-C, iPadOS 17+)** | **Promising, must be tested** | Apple added `AVCaptureDevice.DeviceType.external` for UVC on USB-C iPads in iPadOS 17 ([WWDC23 “Support external cameras in your iPadOS app”](https://developer.apple.com/videos/play/wwdc2023/10106/)). Safari / WebKit has some external-camera support; whether Capacitor’s WKWebView lists the Osmo in `enumerateDevices` has to be checked on a real iPad. If WebView does not see it, a small native `AVCapture` plugin can pipe frames into the same PFP canvas. Settings → Privacy → Wired Accessories may need “Always Allow”. The iPad is also the device that can physically hold USB + stay charged with a powered hub. |
| **iPhone** | **No, not via USB UVC** | Apple’s own session says external cameras are an iPad feature. `AVCaptureDevice.DiscoverySession` with `.external` does not return UVC devices on iPhone, including USB-C iPhone 15 and later. The Pocket 3 will not appear in `getUserMedia` on iPhone. Do not plan the flagship iPhone TestFlight build around a plugged-in Osmo. Workarounds (RTMP hop, or a companion iPad / laptop as the court camera) are Route 2 or a second caster seat. |
| **Android WebView / Chrome** | **Generally no via getUserMedia** | Android’s camera APIs and Chrome / WebView typically expose only built-in cameras. UVC devices usually need a native library (UVCCamera / AndroidUSBCamera) and a JS bridge to feed frames into the PFP canvas. Treat a native Android UVC plugin as later work, after iOS TestFlight and the desktop/iPad path. |

**Recommendation for Route 1:** implement the picker and multi-face cover first against **desktop Safari/Chrome + Pocket 3 in Webcam mode**, then test **iPad WebView**. Keep iPhone on its built-in camera. Same PFP pipeline; only the input `deviceId` changes.

## Route 2 — Osmo RTMP into the relay, cover on the server

DJI Mimo can livestream the Pocket 3 over **RTMP** (custom URL, typically 1080p / 25–30 fps) on the camera’s Wi-Fi or a phone hotspot. That can be aimed at the same small relay (MediaMTX / ffmpeg) instead of YouTube.

This is the wrong place to apply the cover if the rule is “only the covered picture leaves.”

- The frames that leave the Osmo (and usually the phone running Mimo) are **raw** until the relay paints logos.
- If that RTMP URL were ever the YouTube key, or any third-party ingest, uncovered faces would be on the public stream. The zero-exposure rule would be broken.
- Even when the ingest is a private relay you control, the trust boundary moves: cover quality, model, and fail-safe all live on the server; a crash, a missed face in a wide shot, or a restream started before the cover process attaches would leak faces. Client-side pfp.js plus “no shield, no outbound” is the guarantee we already have.
- Wide court shots make faces small. A server detector must cover **every** person, including people who walk into frame later. A miss is an exposure.

Route 2 is only acceptable if: (1) the ingest is a **private** relay that never restreams until server-side cover is proven on the current frame, (2) fail-safe is “cover or hold,” never “pass raw,” and (3) we accept that this is a different, weaker guarantee than on-device PFP. It is a fallback when no UVC host is at the court (no laptop or iPad), not the default.

## Suggested sequence (after the iOS flagship build)

1. Ship phone-camera Go Live + Record with on-device PFP (this branch / TestFlight).
2. Extend pfp.js to multi-person logos + a “don’t send until every detected face is covered” gate for a `court` / external source.
3. Wire a camera-source picker (`WashersLive.listCameras`) on desktop and iPad; keep it hidden on iPhone if only built-in devices exist.
4. Try Pocket 3 UVC into desktop, then iPad. Only then consider a private RTMP cover on the relay, with the caveats above.

No Osmo, VPS, or server-side detector was set up here.
