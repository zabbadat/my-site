// Today's Hide "Paint with AI" path. Wired, but dark on this launch.
// Returns 404/disabled unless HIDE_AI_ENABLED and XAI_API_KEY are both present.
// No key is added in this branch. Do not change Netlify env from here.
"use strict";

const IMAGINE_MODEL = "grok-imagine-image-2.0";
const IMAGINE_DAILY_CAP = 5;
const capMap = new Map();

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

function enabled() {
  const flag = String(process.env.HIDE_AI_ENABLED || "").toLowerCase();
  const key = String(process.env.XAI_API_KEY || "").trim();
  return (flag === "true" || flag === "1") && !!key;
}

async function runImagine(event) {
  const key = String(process.env.XAI_API_KEY || "").trim();
  const headers = (event && event.headers) || {};
  const uid = String(headers["x-hide-uid"] || headers["X-Hide-Uid"] || "anon");
  const day = new Date().toISOString().slice(0, 10);
  const capKey = uid + ":" + day;
  const used = capMap.get(capKey) || 0;
  if (used >= IMAGINE_DAILY_CAP) {
    return json(429, { error: "daily cap", cap: IMAGINE_DAILY_CAP });
  }
  let payload = {};
  try { payload = JSON.parse((event && event.body) || "{}"); } catch (e) {
    return json(400, { error: "bad json" });
  }
  // One image-edit call per upload, all five items in a single prompt.
  const res = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGINE_MODEL,
      prompt: payload.prompt || "Hide five training-yard items naturally in this photo: a steel washer, a water bottle, a jump rope, a work glove, and chalk.",
      image: payload.image
    })
  });
  capMap.set(capKey, used + 1);
  return {
    statusCode: res.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: await res.text()
  };
}

exports.handler = async function (event) {
  if (event && event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  }
  if (!enabled()) return json(404, { disabled: true });
  return runImagine(event);
};

exports.IMAGINE_MODEL = IMAGINE_MODEL;
exports.IMAGINE_DAILY_CAP = IMAGINE_DAILY_CAP;
exports.enabled = enabled;
