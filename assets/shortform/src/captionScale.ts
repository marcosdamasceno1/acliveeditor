/**
 * captionScale — ONE multiplier over every caption style's natural size.
 *
 * `captions.fontScale` in edit-data.json. 1 = the size the style was designed
 * at, which is why each style keeps its own numbers (52px for "classica",
 * 84px for "serifada") instead of the JSON carrying an absolute px: the six
 * styles have six natural sizes and one absolute value would mean something
 * different in each.
 *
 * THE PART THAT IS EASY TO GET WRONG: scaling the font alone does not scale
 * the caption. Every style groups its words by MEASURED WIDTH against a budget
 * (safeWidth / maxW), so a bigger font against the same budget just re-breaks
 * the lines — and karaoke, whose fit is `min(1, safeWidth/width)`, cancels the
 * increase outright on any line that was already at the budget. The budget has
 * to scale with the font. `scaledBudget` is that, with the ceiling below.
 *
 * The ceiling is not a style choice. Short-form runs under the platform's
 * action rail (the like/comment column), which is why the template's default
 * safeWidth is 720 on a 1080 frame. Scale far enough and the caption slides
 * under those buttons — unreadable in the only place the video gets watched.
 * SAFE_MAX_FRAC caps how wide the budget may ever get, so a large fontScale
 * grows the glyphs and stops widening the block.
 */

const MIN = 0.7;
const MAX = 1.5;

/** Widest a caption block may ever be, as a fraction of frame width. */
export const SAFE_MAX_FRAC = 0.86;

const clamp = (v: number) => (v < MIN ? MIN : v > MAX ? MAX : v);

// Read straight from the JSON — the template is data-driven and this is data.
// Clamped here rather than trusted: below 0.7 the caption stops being legible on
// a phone, above 1.5 no phrase fits a 1080 frame, and a typo in the JSON should
// degrade to the nearest sane size instead of rendering an unusable pass.
import editData from '../public/edit-data.json';

const raw = ((editData as any).captions ?? {}).fontScale;
export const CAPTION_SCALE: number = typeof raw === 'number' && isFinite(raw) ? clamp(raw) : 1;

/**
 * Scale a style's width budget alongside its font, without letting the block
 * grow into the platform's action rail. Pass the frame width from
 * useVideoConfig() where you have it; the 1080 default matches the template.
 */
export const scaledBudget = (budget: number, frameWidth = 1080): number =>
  Math.min(budget * CAPTION_SCALE, frameWidth * SAFE_MAX_FRAC);
