# Third-party licences and credits

PrayAlong itself is under the Quran-Lab No-Profit License 1.2 (see
[LICENSE](LICENSE)). The components below keep their own licences and terms.
Each npm package ships its full licence text in `node_modules/<package>/`.

## npm runtime dependencies

From `dependencies` in `package.json`; versions are the ones in
`package-lock.json`.

| Package | Version | Licence |
| --- | --- | --- |
| @fontsource-variable/figtree | 5.3.0 | OFL-1.1 |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 |
| @fontsource-variable/noto-sans-arabic | 5.3.0 | OFL-1.1 |
| @fontsource-variable/source-serif-4 | 5.3.0 | OFL-1.1 |
| @fontsource/amiri | 5.3.0 | OFL-1.1 |
| @fontsource/amiri-quran | 5.3.0 | OFL-1.1 |
| @fontsource/noto-nastaliq-urdu | 5.3.0 | OFL-1.1 |
| @mediapipe/tasks-vision | 1.0.1 | Apache-2.0 |
| @pixiv/three-vrm | 3.5.5 | MIT |
| @react-three/drei | 10.7.9 | MIT |
| @react-three/fiber | 9.8.1 | MIT |
| @react-three/postprocessing | 3.1.3 | MIT |
| adhan | 4.4.6 | MIT |
| clsx | 2.1.1 | MIT |
| lucide-react | 1.52.0 | ISC |
| motion | 14.0.0 | MIT |
| onnxruntime-web | 1.30.0 | MIT |
| postprocessing | 6.39.5 | Zlib |
| radix-ui | 1.6.7 | MIT |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |
| tailwind-merge | 3.7.0 | MIT |
| three | 0.186.1 | MIT |
| zustand | 5.0.15 | MIT |

Development tools (Vite, TypeScript, Tailwind CSS, Vitest, Playwright,
Wrangler and others in `devDependencies`) are not shipped to users.

## Fonts

| Font | Used for | Licence |
| --- | --- | --- |
| Figtree | Interface text | SIL Open Font License 1.1 |
| Inter | Installed as a dependency; not imported by the app at present | SIL Open Font License 1.1 |
| Source Serif 4 | Serif text | SIL Open Font License 1.1 |
| Noto Sans Arabic | Arabic interface text | SIL Open Font License 1.1 |
| Noto Nastaliq Urdu | Urdu text | SIL Open Font License 1.1 |
| Amiri | Arabic of the supplications | SIL Open Font License 1.1 |
| Amiri Quran | Arabic of the Quran | SIL Open Font License 1.1 |

The fonts the app uses are bundled from the @fontsource packages listed above
(imported in `src/main.tsx`).

## Models and runtimes outside npm

| Component | Where | Licence or terms |
| --- | --- | --- |
| Quran Lab zipformer2 CTC phoneme model v3.1 (int8) | Downloaded at run time from Quran Lab storage | Quran Lab, NPL-1.2 |
| sherpa-onnx WASM runtime | `public/voice/runtime/` | Apache-2.0 (`public/voice/runtime/LICENSE.sherpa-onnx`) |
| MediaPipe Pose Landmarker and Face Landmarker models | `public/models/*.task` | Apache-2.0 |
| DETRPose-N (github.com/SebastianJanampa/DETRPose), browser export | `public/models/detrpose.onnx` | Apache-2.0 (see `tools/detrpose/README.md`) |

## Religious text

| Content | Source | Licence or terms |
| --- | --- | --- |
| Arabic text of the Quran (`src/content/quran/ar.json`) | Tanzil Quran Text, simple script (tanzil.net), edition `ara-quransimple` | Tanzil licence: may be copied and used only verbatim, with no change to the text, and with a credit to Tanzil and a link to tanzil.net |
| Meanings of the verses (`src/content/quran/<locale>.json`) | Fetched verbatim through fawazahmed0/quran-api | Each translation stays under its publisher's terms. The credit stored in each file is shown in the app (Settings) |

Translation editions, as credited in the edition metadata of each file:

| Locale | Edition id | Credit |
| --- | --- | --- |
| de | deu-frankbubenheima | Bubenheim & Elyas |
| en | eng-ummmuhammad | Saheeh International |
| es | spa-muhammadisagarc | Isa García |
| fr | fra-muhammadhamidul | Muhammad Hamidullah |
| id | ind-indonesianislam | Kementerian Agama RI |
| nl | nld-sofianssiregar | Sofian S. Siregar |
| tr | tur-diyanetisleri | Diyanet İşleri |
| ur | urd-muhammadjunagar | Muhammad Junagarhi |

Sources and verification for every text, including the supplications, are in
[docs/SOURCES.md](docs/SOURCES.md).

## Generated media

| Asset | How it was made | Terms |
| --- | --- | --- |
| Recited lines and spoken guidance (`public/audio/`) | Generated for PrayAlong with ElevenLabs (eleven_v4) from voices designed for the project, not cloned from a person | ElevenLabs terms for generated output |
| The four companions (`public/avatars/*.glb`) | Bodies generated for PrayAlong with Meshy (meshy-7.1, auto-rig) from the project's own concept art, then edited and rigged; see [docs/characters.md](docs/characters.md) | Meshy terms for generated output |
| Companion hands | Quaternius Universal Base Characters | CC0 |
| Concept art and posture close-ups (`public/guides/`) | Generated for PrayAlong with an image model (gemini-3.1-flash-image) | The provider's terms for generated output |
