# PFP face-exposure proof (one command)

Checks, frame by frame, that with the **profile logo (PFP) switch on** no camera ever shows any part of a face on screen,
on every camera surface (push-ups, plank, Gyatt Squats, TUT battle, Go live self view, Live Match), from the very first frame.

It runs on any Mac, Windows or Linux laptop. You don't need a GPU or a real camera, and nothing touches the live site or any account.

## Steps

1. Install **Node.js 20 or newer** from https://nodejs.org (the LTS button).
2. Open a terminal (Mac: Terminal; Windows: PowerShell) and run:

```
git clone -b tools/pfp-proof https://github.com/zabbadat/my-site.git zab-pfp-proof
cd zab-pfp-proof
npm install
npx playwright install chromium
npm run pfp-proof
```

For a shorter run, use `npm run pfp-proof:quick` in the last step.

The last line says **`RESULT: PASS - zero exposed face frames in every scenario`**, or **`RESULT: FAIL (...)`**.
On a FAIL, the exit code is 1 and every failing frame is listed with its frame number, time, scenario and pixel count. **Every** exposed screencast frame is saved as an image, and each frame's file path is printed.

## What it does

- **Fake camera.** It generates a fake camera clip in pure Node (no ffmpeg). The clip has a bright-green "face" that sways, bobs and jumps.
- **Fake detector.** It plugs that clip into Chromium as the camera (`--use-fake-device-for-media-stream`, `--use-file-for-fake-video-capture`). It then replaces the pose model's output with keypoints measured from the green face in the model's own input frame. That is a perfect detector with the real model's timing.
- **Local site.** It serves this repo locally with a tiny built-in Node server. No Netlify is needed, and nothing is deployed.
- **Frame checks.** Every displayed frame is checked two ways:
  - the browser's real screen output (DevTools screencast), every frame, **only inside the on-screen camera/video area** (the camera video or shield canvas rectangle, plus its cover). Page UI outside that area is not scanned;
  - a pixel readback after every repaint of each visible camera video and logo canvas (unchanged: the whole video / logo canvas).

  The screencast is captured as lossless PNG.

  Both checks are strict: **zero** green face pixels are allowed in any frame, so a single green pixel in the checked area counts as an exposed frame.

  A face pixel is the fake face's bright green only, the same test on both checks: G > 180 with R and B both under 90. The plank guide and other site greens do not match.
- **Scenarios:**
  - **startup:** open the camera cold, then reload and open again warm. Each surface is run on phone and desktop viewports, with the pose model normal, slow (8 s) or blocked.
  - **tracking:**
    - first lock (big logo → shrink onto the head);
    - tracking lost, low confidence, and face hidden (hood), each followed by a re-lock;
    - tab hidden and back;
    - camera switch (Live Match front ↔ rear; other cameras get a new stream);
    - resolution/orientation change to a portrait stream;
    - a stalled model.

    Tracking also runs at 640x480, 1280x720, 720x1280, and in landscape.
- **Proven, not just passed.** A scenario only passes if the camera really ran under test. Frames must have been read back, the logo canvas must have existed, and the tracking runs must have locked onto the head at least once. Otherwise the scenario is marked UNPROVEN, which also counts as a fail.

## Options

- `npm run pfp-proof:quick`: a shorter matrix (push and Live Match startup on phone/desktop with the model normal/blocked, plus tracking on push, Go live and Live Match).
- `npm run pfp-proof -- --only=push,match`: run only some surfaces. The names are push, plank, squats, tut, zlSelf and match.
- `npm run pfp-proof -- --control`: a negative control. A proof-only hook (it must never ship in the site) bypasses the shield, forces the raw camera video visible and hides the logo, so the run **must FAIL** on both readback and the camera-area screencast. This proves the checker really sees faces.
- `npm run pfp-proof -- --base=https://www.zabbadat.com`: check a deployed site instead of this repo (read only).
- `--headed`: watch it run.

## Time and disk

- **Full run:** about 25-35 minutes (51 scenarios). **Quick:** about 5-7 minutes (11 scenarios). It is slower on old laptops, because all video work runs on the CPU.
- **Disk:**
  - about 200 MB for `npm install` plus Chromium;
  - the fake camera clips go in your temp folder (`zab-pfp-proof`, or set `PFP_PROOF_DIR`); each run's report, screenshots and exposed frames go in a `run-<time>` folder inside it: 110 MB for quick, about 800 MB for full. Delete that folder any time.
- **Internet:** needed while it runs, because the page loads its pose library (TensorFlow.js) from a CDN, as on the live site.

`npm test` (the unit tests) is unchanged and does not need Playwright.
