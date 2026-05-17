# Task D: Free Mode Pose Generation And QA Notes

This note is intentionally offline-first. It documents how to prepare Free Mode
standing portraits and pose variants without wiring anything into the runtime
or calling an external image API by accident.

## Script Availability

Checked on 2026-05-14 in `C:\Game\jingling-desktop-pet`.

- Requested path:
  `C:\Users\LY\.codex\skills\openai-image-proxy\generate_image.py`
  - Result: missing.
- Actual available path:
  `C:\Users\LY\.codex\skills\openai-image-proxy\scripts\generate_image.py`
  - Result: present.
  - `python ...\scripts\generate_image.py --help` works.
  - This help check does not call the image API.

Do not place API keys in this repository. The helper script reads
`OPENAI_IMAGE_API_KEY`, `OPENAI_IMAGE_BASE_URL`, and `OPENAI_IMAGE_MODEL` from
the process environment or from `C:\Users\LY\.openai-image-proxy.env`.

## Current Free Mode Asset Surface

Free Mode currently renders one character portrait via `activeCharacter.avatar`
and falls back to `/assets/jingling-placeholder.png`. Pose switching is not part
of the current runtime surface. Treat this task as an asset-generation and QA
support pass only; do not edit `src/components/FreeModeWindow.tsx` or core
runtime logic for this task.

Generated drafts can live outside the runtime path first, for example:

```text
design/free-mode-poses/<character-id>/
```

Only move approved final PNGs into `public/assets/...` after a separate runtime
or content-card integration task decides the exact IDs and paths.

## Recommended Pose Set

Use a consistent canvas and character identity across all poses:

- `idle`: relaxed neutral standing portrait.
- `greeting`: small wave, warm but not loud.
- `listening`: slight forward lean, attentive eyes.
- `thinking`: one hand near chin, focused expression.
- `encourage`: gentle supportive smile, open posture.
- `alert`: surprised or noticing something on screen.
- `sleepy`: soft tired expression for late-night ambience.
- `celebrate`: small spark of happiness after a success.

Suggested file names:

```text
<character-id>-free-idle.png
<character-id>-free-greeting.png
<character-id>-free-listening.png
<character-id>-free-thinking.png
<character-id>-free-encourage.png
<character-id>-free-alert.png
<character-id>-free-sleepy.png
<character-id>-free-celebrate.png
```

## Base Prompt Template

Replace bracketed fields before generation.

```text
Create a polished anime desktop assistant standing portrait for Jingling Free
Mode. Same adult character identity across the whole pose set:
[character identity, hair, eyes, outfit, signature accessories].

Pose: [pose name].
Expression: [expression].
Body language: [gesture and posture].

Requirements:
- single character only
- waist-up or three-quarter standing portrait
- centered composition with full head and hands visible
- transparent background if supported; otherwise clean pale neutral background
- clean silhouette for a floating desktop assistant panel
- expressive face readable at small UI size
- consistent outfit, hair color, eye color, face shape, and accessories
- soft visual-novel character rendering, high quality, polished linework
- no text, no watermark, no logo, no extra characters, no cropped head
- avoid busy background, heavy props, extreme camera angles, or distorted hands
```

Negative prompt block, if the provider supports one:

```text
text, watermark, logo, extra fingers, missing fingers, bad hands, extra limbs,
cropped head, cropped hands, duplicate character, childlike proportions,
photorealistic skin, messy background, low resolution, blurry, noisy
```

## Pose Prompt Fillers

Use these fillers with the base prompt.

| Pose | Expression | Body language |
| --- | --- | --- |
| idle | calm, lightly curious | relaxed shoulders, hands near torso |
| greeting | bright and friendly | one hand raised in a small wave |
| listening | attentive and patient | slight forward lean, hands clasped |
| thinking | focused and gentle | one hand near chin, eyes looking aside |
| encourage | reassuring smile | open palm gesture, supportive posture |
| alert | surprised but composed | eyes widened, hand near chest |
| sleepy | soft tired smile | relaxed posture, half-lidded eyes |
| celebrate | happy and proud | small fist pump or lifted hand |

## Manual Generation Commands

Do not run these commands until image API configuration is intentionally set up.
Keep calls sequential so the proxy is easier to debug.

Text-only generation:

```powershell
$prompt = @'
<paste one completed prompt here>
'@
python C:\Users\LY\.codex\skills\openai-image-proxy\scripts\generate_image.py `
  $prompt `
  --output C:\Game\jingling-desktop-pet\design\free-mode-poses\<character-id>\<character-id>-free-idle.png `
  --size 1024x1024 `
  --show-revised-prompt
```

Reference-preserving edit, preferred after the first approved portrait:

```powershell
$prompt = @'
Use the provided image as the primary character reference. Keep identity, hair
color, eye color, outfit, accessories, face shape, and overall rendering style
consistent. Change only the pose to: [pose]. Change only the expression to:
[expression]. Single character, centered desktop assistant standing portrait,
clean silhouette, no text, no watermark.
'@
python C:\Users\LY\.codex\skills\openai-image-proxy\scripts\generate_image.py `
  $prompt `
  --reference-image C:\Game\jingling-desktop-pet\design\free-mode-poses\<character-id>\<character-id>-free-idle.png `
  --reference-max-size 512 `
  --output C:\Game\jingling-desktop-pet\design\free-mode-poses\<character-id>\<character-id>-free-greeting.png `
  --size 1024x1024 `
  --show-revised-prompt
```

## QA Checklist

Use this checklist before any generated asset is wired into a character card or
runtime view.

- Asset opens locally and is a valid PNG.
- Character identity is consistent across every pose.
- Face and hands remain readable at the Free Mode window size.
- No text, watermark, extra character, malformed hands, or cropped head.
- Background is transparent or simple enough for the floating panel.
- Pose reads clearly without changing outfit, age, or character species.
- File name matches the planned pose ID.
- If moved under `public/assets`, verify it loads through the app path and not
  only through an absolute Windows path.

For browser QA, use the existing Free Mode preview route:

```text
http://localhost:5173/?view=free-mode
```

The current Free Mode preview validates the portrait rendering surface only; it
does not validate pose switching until a separate integration task adds that
behavior.
