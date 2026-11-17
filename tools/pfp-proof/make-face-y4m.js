// Fake camera clip for the PFP face-exposure proof, pure Node (no ffmpeg): a bright-green "face" ellipse (rx 30, ry 38 px,
// RGB ~ 0,255,0) on a textured grey background with a darker torso. It sways 120 px every 2 s, bobs 20 px, and jumps
// 150 px sideways at 4 s / 6 s (fast moves). 30 fps, Y4M 4:2:0 - the format Chrome's --use-file-for-fake-video-capture reads.
// Usage: node make-face-y4m.js <width> <height> <frames> <out.y4m>
"use strict";
const fs = require("fs");
function make(W, H, N, out) {
  const fd = fs.openSync(out, "w");
  fs.writeSync(fd, `YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  for (let f = 0; f < N; f++) {
    const t = f / 30, jump = t % 8 > 4 ? 150 * (W > H ? 1 : 0.6) * (t % 8 > 6 ? -1 : 1) : 0;
    const cx = W / 2 + 120 * Math.sin((2 * Math.PI * t) / 2) + jump, cy = H * 0.38 + 20 * Math.sin((2 * Math.PI * t) / 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let yy = 90 + ((x * 7 + y * 13 + f * 5) % 23);
      if (Math.abs(x - cx) < 80 && y > cy + 70) yy = 60;
      Y[y * W + x] = ((x - cx) / 30) ** 2 + ((y - cy) / 38) ** 2 <= 1 ? 150 : yy;
    }
    for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
      const inFace = ((x * 2 + 1 - cx) / 30) ** 2 + ((y * 2 + 1 - cy) / 38) ** 2 <= 1;
      U[y * (W / 2) + x] = inFace ? 44 : 128; V[y * (W / 2) + x] = inFace ? 21 : 128;
    }
    fs.writeSync(fd, "FRAME\n"); fs.writeSync(fd, Y); fs.writeSync(fd, U); fs.writeSync(fd, V);
  }
  fs.closeSync(fd);
}
module.exports = make;
if (require.main === module) { const [W, H, N, out] = process.argv.slice(2); make(+W, +H, +N, out); }
