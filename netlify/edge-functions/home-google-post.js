// Google sometimes posts the phone credential to / instead of the handler.
// Hand that post to the homepage hash. Leave every other request on the site.
import { acceptGooglePost, CLIENT_ID, handOffResponse } from "./google-credential.js";

export default async function homeGooglePost(request, context) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/") return context.next();
  const decision = acceptGooglePost(await request.clone().text(), request.headers.get("cookie"), CLIENT_ID, Date.now());
  const handed = handOffResponse(decision);
  if (handed) return handed;
  return context.next();
}
