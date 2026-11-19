# Washers PFP cover — tripod facing out

Owner, Nov 19, 2026: the room-mirror / reflection idea for the logo cover is dropped. The Washers setup is a tripod facing outward, with the player's back and the back of the head in the picture. The body tracker holds the logo over the back of the head; when the player turns toward the camera (walking to the rubber mound) the face is picked up and the logo follows. The same cover holds through a bend to pick up a washer.

Staged on `feat/washers-tripod-back`. Nothing is live until the owner says fire.

The live shield in `pfp.js` locks on the shoulders / upper body when there is no face cluster (`coverFromPose`). Face placement is unchanged when a face is visible. The opening logo and the locked size rule (r ≥ `shTop` × shoulder width, 0.72) are unchanged. The rear camera is the Live Match default and is not mirrored. The Mirror-21 test page is a separate debug surface and was not changed.
