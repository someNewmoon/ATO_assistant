# Panel overhead image restorations

The final Cycle I board models use the selected `hekaton-v1.webp`, `labyrinthauros-v1.webp`, `pursuer-v1.webp`, and `temenos-v7-original-style.webp`. Each has a 1024px maximum edge and an alpha channel. AIBP selection, battle summaries, and the campaign record use matching transparent 160px thumbnails from the same masters.

The Labyrinthauros head and the Pursuer beak point southeast in their source images. Hekaton and Temenos use a south-facing source reference. Temenos draws at 110% to keep the tentacles visible. The renderer rotates each image to the game-facing angle and draws the direction arrow and footprint independently.

The earlier restorations below were generated with the built-in `image_gen` tool, not the CLI. One edit call per input: `hekaton-top.png`, `labyrinthauros-top.png`, `temenos-top.png`, `pursuer-top.png` from the existing hosted card-art pack. Originals are unchanged.

Earlier outputs: `hekaton-hd.webp`, `labyrinthauros-hd.webp`, `temenos-hd.webp`, `pursuer-hd.webp`. The generated transparent PNGs were encoded as WebP at 1024px maximum edge, quality 0.94, preserving alpha. The runtime draws the full artwork with its transparent outline.

## Prompt set

The following prompt was used separately with `{name}` replaced by each of the four IDs above:

```text
Use case: precise image restoration. Edit target: the attached original board-game monster-panel overhead diagram ({name}). Restore THIS EXACT printed illustration at high resolution for a small board marker. Preserve its exact silhouette, pose, top-down projection, limb count, horns/head/robe/weapon shapes, proportions, orientation, brown/ochre or gray palette, original fine ink strokes and shading. Only remove print halftone/noise, reconstruct crisp edges and sharpen the existing illustration. Do NOT redesign, stylize, cartoonize, simplify into an icon, add details, anatomy, limbs, framing, logos, text or a direction arrow. No creative reinterpretation. Remove only the surrounding gray grid/card background, and any printed grid lines outside the figure. Transparent background. Keep all of the original figure, centered with a small transparent margin. This is faithful cleanup of an existing image, NOT a new character design.
```
