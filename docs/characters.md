# Companion characters

PrayAlong never hand-animates a character. Postures are authored once in a
normalized humanoid space (`src/components/stage/rig/prayer-poses.ts`) and
applied to whichever character is loaded:

- **Spine, head and legs**: forward kinematics on standard humanoid bones.
- **Hands**: IK to landmarks on *that* character: its chest, knees, thighs,
  ears, the mat beside its head: with an explicit palm orientation.
- **Grounding**: knees, feet and toes are kept on the mat and the toes stay
  on one spot, as a real worshipper's do.
- **Sujud**: the torso pitches until the character's own forehead rests on
  the mat, whatever its proportions.

Tested on three unrelated third-party rigs (a Mixamo mannequin, a Ready
Player Me avatar and a stylised cartoon character) with no per-character
changes, and on the four PrayAlong companions below.

## The cast

| | File | Look |
| --- | --- | --- |
| Yusuf | `public/avatars/yusuf.glb` | Boy, white thobe, knitted kufi |
| Ahmad | `public/avatars/ahmad.glb` | Man, sand thobe, kufi, short beard |
| Maryam | `public/avatars/maryam.glb` | Woman, sage hijab, dusty-blue abaya |
| Aisha | `public/avatars/aisha.glb` | Girl, lilac hijab, cream dress |

Style rules (halal): soft rounded 3D, modest loose clothing, and a smooth
face with only two soft eyebrows: no eyes, no nose, no mouth. This follows
the common scholarly position that an image without those features is not a
complete image. Every new companion must keep it.

Each file is ~0.6 to 0.8 MB (meshopt geometry, WebP texture), A-pose, Mixamo
skeleton with full 3-joint finger chains, so the right index finger can
point in tashahhud.

### How they are made (`tools/characters/pipeline/`)

1. `gen_cast.py` / `gen_brows.py`: concept art (soft 3D style, eyebrows-only
   face) through the image router. Needs `QL_KEY` in the environment.
2. `gen_views.py`: matching front, side, back and 3/4 views of the approved
   concept (image edits with the front as reference).
3. `meshy_mv.py`: Meshy multi-image to 3D (meshy-7.1, triangle remesh ~40k,
   A-pose, front view as texture reference). Needs `MESHY_KEY`. Meshy runs
   vary; regenerate until the face is clean.
4. `smooth_bump.py`: Meshy always sculpts a small nose/mouth bump. Bilaplacian
   fairing of only that patch removes it; the texture is untouched.
   `skin_tone.py` evens a too-pale skin tone if needed.
5. `meshy_rig.py`: Meshy auto-rig (body, spine, head, legs, toes).
6. `swap_hands.py`: Meshy fingers are fused, so the hands are replaced by the
   CC0 Quaternius Universal Base Characters hands (3 joints per finger),
   scaled and aligned at the wrist, coloured with the character's skin. Also
   renames the spine to Mixamo names, smooths the skirt weights so long
   robes drape when kneeling, and recomputes normals.
7. Compress: `npx @gltf-transform/cli optimize in.glb public/avatars/x.glb
   --compress meshopt --texture-compress webp --simplify false`.
8. `validate_glb.py` on the uncompressed file; `render_turn.py` for turntables.

Credits: hands from Quaternius Universal Base Characters (CC0). Bodies
generated with Meshy from PrayAlong's own concept art.

Known rough edges: the robe reads as a smooth block on the lap when sitting;
the hands are a touch lighter than the face texture.

Portraits for the picker (`public/avatars/<id>.webp`) are cropped from
turntable renders.

## Asset spec

| | |
| --- | --- |
| Format | **GLB** (glTF 2.0 binary) or **VRM** 0.x/1.0 |
| Skeleton | Humanoid. GLB: Mixamo bone names, with or without the `mixamorig:` prefix (Mixamo, AccuRIG, Meshy, Tripo and Avaturn all export these). VRM: standard humanoid mapping. |
| Rest pose | T-pose or A-pose, facing +Z, Y up. Any scale. |
| Required bones | Hips, Spine, Head, both arms (upper/lower/hand), both legs (upper/lower/foot). Recommended: Spine1/2, Neck, ToeBase, full finger chains (Thumb/Index/Middle/Ring/Pinky 1-3) for hand shapes and the tashahhud finger. |
| Face | Smooth, eyebrows only (see the style rules above). |
| Budget | ≤ 50k triangles, one 2048² texture, ≤ 1 MB compressed. |
| Clothing | Modest prayer clothing. Long garments (thobe, abaya, jilbab) work best skinned to the legs with a little extra hip/thigh weight so the hem follows when kneeling. |

## Adding one

1. Drop the file in `public/avatars/`.
2. Add an entry (with a `thumbnail`) to `src/components/stage/characters.ts`.
3. Check it in the Pose Lab: `/?lab&pose=sujud&character=/avatars/<file>.glb`
   (add `&az=1.57` for a side view).

The **Companion** picker in Settings lists every entry.
