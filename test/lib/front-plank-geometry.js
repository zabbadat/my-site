const f = 457, cx = 320, cy = 240;
module.exports = function make({ cam = 0.05, D = 0.9, hipY = null, kneeL = null, kneeR = null, stand = false, legsConf = 0.9, back = 0 } = {}) {
  const sh = [0.2, 0.45, D + back], an = [0.08, 0.08, D + 1.5 + back];
  const lin = (k) => sh[1] + (an[1] - sh[1]) * k;
  let b = { shoulder: sh, hip: [0.15, hipY != null ? hipY : lin(0.53), D + 0.8 + back], knee: [0.1, lin(0.77), D + 1.15 + back], ankle: an };
  if (stand) b = { shoulder: [0.2, 1.45, D + 0.3], hip: [0.15, 0.95, D + 0.3], knee: [0.1, 0.5, D + 0.3], ankle: [0.08, 0.08, D + 0.3] };
  const out = [];
  for (const [j, [x, y, z]] of Object.entries(b)) for (const [s, sg] of [["left", -1], ["right", 1]]) {
    let yy = y; if (j === "knee" && s === "left" && kneeL != null) yy = kneeL; if (j === "knee" && s === "right" && kneeR != null) yy = kneeR;
    const u = cx + f * sg * x / z, v = cy - f * (yy - cam) / z;
    const inFrame = u >= 0 && u <= 640 && v >= 0 && v <= 480;
    out.push({ name: s + "_" + j, x: u, y: v, score: !inFrame ? 0.05 : j === "shoulder" ? 0.9 : legsConf });
  }
  return out;
};
