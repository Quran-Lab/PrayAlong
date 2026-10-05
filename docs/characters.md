# Companion characters

Both companions are one figure: **"MUSLIM PRAYER ISLAM SALAH" by sameka**
([Sketchfab](https://sketchfab.com/3d-models/muslim-prayer-islam-salah-eb0f80a7278243b4988b159fc957bbd5),
CC BY 4.0, credited in Settings → About and in `CHARACTERS`), a man with a Mixamo skeleton who
prays two rak'ahs on a mat. We keep his body, his proportions and his motion, make him faceless
like the Quran Lab mascot, with two hamzahs (ء, in the app's KFGQPC Uthman Taha Naskh) for eyes,
and dress him twice.

| Id | Clothes | Build |
| --- | --- | --- |
| `brother` | A loose gamis above the ankles (mandarin collar, buttoned placket, chest pocket, no logo) over loose trousers that stop above the ankles; short hair; bare feet | `tools/characters/build_brother.py` |
| `sister` | A loose abaya to the floor; a khimar with a niqab (an opening at the eyes only) falling from the head over the shoulders, the chest and the arms to the thighs; black socks | `tools/characters/build_sister.py` |

Nothing is tight: every garment hangs from the shoulders (and the khimar from the head) with
3–4 cm of ease and is draped by a cloth simulation in every posture. The clothes are black by
default; Settings → Companion → Clothes recolours the `Thobe`, `Sirwal`, `Abaya` and `Khimar`
materials (`OUTFITS` in `src/components/stage/characters.ts`).

## The postures, and where they come from

The postures are taken from the figure's own prayer and set right where it differs from
al-Albani's *Talkhis Sifat Salat an-Nabi* (the app's main source; a woman prays as a man does,
"الرجل والمرأة في ذلك سواء"). `tools/characters/poses.py`:

| Posture | Talkhis | The clip | Here |
| --- | --- | --- | --- |
| `takbir` | palms level with the shoulders, sometimes up to the tips of the ears, fingers outstretched | hands above the head, fingers splayed | wrists at the shoulders, fingertips at the ears, palms to the qibla, fingers outstretched, in front of the ears |
| `qiyam` | the right hand on the left, on the chest | at the stomach | on the chest, right over left |
| `ruku` | palms on the knees, fingers apart, back stretched, head neither raised nor lowered, elbows away | back rounded, head hanging | back flat (the legs lean back slightly so the palms reach), head in line, palms over the kneecaps |
| raising the hands | before bowing and on rising from it (al-Bukhari 735) | only on rising | both (`takbir` as a waypoint) |
| `itidal` | stand straight; no folding of the hands here | arms by the sides | as the clip |
| `descend` | down onto the hands, before the knees (Abu Dawud 840) | hands and knees together | hands on the mat first, knees still up |
| `sujud` | forehead and nose, palms flat by the shoulders, fingers together to the qibla, forearms raised, heels together, toes bent | as described, fingers splayed | fingers together |
| `jalsah` | iftirash, the right foot upright | iftirash | as the clip (lifted onto the mat) |
| sitting of rest, `rise` | sit straight, then rise on the fists like kneading dough (al-Bukhari 823) | stands straight up from sujud | `jalsah`, then up on clenched fists |
| `tashahhud` | iftirash; the right hand closed, the index finger pointing; the left palm open | — | as described |
| `tawarruk` | the final tashahhud: the left hip on the mat | tawarruk | as the clip, pointing finger |
| `salam-*` | turn until the whiteness of the cheek is seen | ~45° | 75° |

Each posture is a glTF animation in the character file. The app (`performer.ts`) blends the bones
between them, through the waypoints the Sunnah moves by (`waypoints()` in `prayer-poses.ts`):
the hands rise before ruku and on rising, the hands go down before the knees, the body sits for a
moment before standing up from a prostration and rises on its fists, and the hands rise again
when standing up from the first tashahhud. `performer.test.ts` checks every posture against the
table above (hand heights, a level back, contacts with the mat, the pointing finger, the turn of
the salam).

## How a companion is built

```bash
# Blender 5.0 (bpy) on Python 3.11 with numpy, scipy, scikit-image, Pillow
# tools/characters/source/muslim_prayer_islam_salah.glb: download it from Sketchfab (not in git)
CHAR_CACHE=/tmp/chars python3 tools/characters/build_brother.py   # ~25 min with the cloth bake
CHAR_CACHE=/tmp/chars python3 tools/characters/build_sister.py    # ~40 min
node tools/characters/portrait.mjs brother sister                  # the picker portraits (dev server on :5180)
```

1. **`reference.py`** loads the figure into a clean scene: the 52 human bones only (the face rig
   and the animation controls go, their weights handed to the nearest human bone), the meshes
   bound in a standing A-pose at 1.75 m, and every frame of his prayer sampled as world matrices.
   The importer must not guess the bind pose (the head is bound with the face rig).
2. **`poses.py`** picks each posture's frame from the clip and applies the corrections above (IK
   for the hands, the spine levelled in ruku, fingers curled or opened), then settles the sitting
   postures onto the mat.
3. **`figure.py`** makes the head faceless (the face smoothed into one surface, the painted
   features covered with the skin's own colour, the eyes as hamzah decals traced from the font),
   gives the brother short hair, keeps the figure's own loose trousers cut above the ankles, and
   adds a slim body under the clothes. `FACE=1` keeps the face.
4. **`wardrobe.py`** turns a garment shape into an open sheet of cloth (cut at the hem, cuffs,
   neckline and the niqab's eye slit), with skin weights from the body underneath and a pin group
   (what is held to the body: the shoulders, the hood, the gamis' placket and pocket).
5. **`drape.py`** walks the body through the prayer in order and simulates the cloth around it
   (the body, the trousers and the mat are colliders; the abaya is one for the khimar). Each
   posture's settled cloth is pushed clear of the body, kept on the mat, and un-skinned into the
   rest pose as a morph target `pose_<posture>`; `ClothDrape` (`garment.ts`) blends them in the app.
   With `CHAR_CACHE` set the simulation is reused while the garments, the poses and the walk are
   unchanged; `DRAPE=0` skips it for a quick look.

## Adding one

A companion is a GLB with Mixamo bone names, one animation per posture named as in `POSE_NAMES`
(`prayer-poses.ts`), and, for long clothes, `pose_<posture>` morph targets. The quickest way is a
new `build_*.py` on the same reference figure with other clothes. Then add an entry with a
`thumbnail` to `src/components/stage/characters.ts` and check it in the Pose Lab:
`/?lab&pose=sujud&character=/avatars/<file>.glb` (add `&az=1.57` for a side view).

The four earlier companions in `public/avatars/` (Yusuf, Maryam, Ahmad, Aisha, from
`build_yusuf.py` and friends) carry no postures and are not offered.
