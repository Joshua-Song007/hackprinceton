# apple-docs overview

Local, **private** copy of Apple developer documentation for our motion-game platform (AirPods head motion, phone/watch sensors, webcam pose). Do not commit this folder to the public repo (it is git-ignored; Apple's text is copyrighted). Retrieved 2026-11-14.

## 1. What is in the folder

| Item | What it is |
|---|---|
| `raw/` | 41 files exactly as downloaded. Never edit. Source of truth. |
| `manifest.json` | Per file: URL, retrieval time, HTTP status, SHA-256, source type, availability tags. Also lists the failed downloads. |
| `INDEX.md` | One-line description per file. |
| `CLAIMS_CHECK.md` | Our notes' claims vs. official text (only the 9 priority claims; the notes file was missing). |
| `AGENT_README.md` | Rules for agents reading this folder. |
| `download_log.jsonl` | Every request made, including the 404s. |
| `OVERVIEW.md` | This file. |

`raw/` groups:
- **Core Motion core:** `coremotion.md`, `coremotion__cmheadphonemotionmanager.md` (+ delegate), `coremotion__cmdevicemotion.md`, `...SensorLocation-swift.enum.md`, `cmattitude`, `cmmotionmanager`, `cmbatchedsensormanager`.
- **Member pages (21):** files starting `CoreMotion__CMHeadphoneMotionManager__...` and `CoreMotion__CMDeviceMotion__...` (one per property/method).
- **Articles:** headphone activity sample, processed device motion, raw accelerometer, Core Motion updates log.
- **Other frameworks (overview only):** Vision 2D/3D body pose, WatchConnectivity (`WCSession`), HealthKit `HKWorkoutSession`, GameController, NearbyInteraction.
- **WWDC23 session 10179** (`.html`, includes the transcript) and the **iOS 27 / macOS 27 release notes**.
- Format notes: `.md` files start with a JSON comment holding the `availability` tags. Accented characters may look garbled in some viewers (UTF-8; read as UTF-8).

## 2. What we learned (for building the platform)

**Headphone motion (`CMHeadphoneMotionManager`)**
- Available iOS 14, iPadOS 14, macCatalyst 14, macOS 14, watchOS 7 per the page header. Check `isDeviceMotionAvailable` first.
- Needs `NSMotionUsageDescription` in Info.plist or the app crashes on start.
- Delivers `CMDeviceMotion` (attitude, rotation rate, user acceleration, gravity). Data comes from one bud at a time; `sensorLocation` says `headphoneLeft`/`headphoneRight`. With Automatic Ear Detection the other bud takes over when one is removed (WWDC23).
- Delegate gets connect/disconnect events (also fired when buds leave/enter ears).
- Use `CMAttitude.multiply(byInverseOf:)` against a saved reference pose for relative head rotation (WWDC23 describes this).

**Phone/watch (`CMMotionManager`)** – processed device motion, update interval property; Apple says the max rate is hardware dependent, "usually at least 100 Hz".
**Watch high rate (`CMBatchedSensorManager`)** – watchOS 10; 800 Hz accelerometer and 200 Hz device motion, batched once per second; needs an active HealthKit workout session; Series 8 and Ultra at WWDC23.
**Vision** – `VNDetectHumanBodyPoseRequest` (2D) and `VNDetectHumanBodyPose3DRequest` (3D) for webcam/camera pose; availability tags are in each file's header.

## 3. Answers to the previously open questions

These were NOT FOUND in the first pass. Second pass results; "official" = Apple text, "unofficial" = third party (treat as hints).

| Question | Answer | Confidence |
|---|---|---|
| Does headphone motion work on watchOS? | **Yes since June 2024.** Core Motion updates log: "You can also use `CMHeadphoneMotionManager` to support AirPods device motion data on watchOS." Also: connect/disconnect monitoring is possible outside a motion session. (Older forum posts say it returned false on watch; that predates the change.) | Official (`raw/updates__coremotion.md`) |
| New head-motion API in iOS 27? | **None found.** The Core Motion updates log ends at Sept 2024 with no 2025-26 entry, and the iOS 27 / macOS 27 release notes have no Core Motion or headphone-motion item. The newest official headphone additions are `CMHeadphoneActivityManager` (iOS 18-era, June 2024) and the watchOS/connection-status changes. | Official, absence only |
| Max headphone sample rate? | **Not published by Apple.** General Core Motion rule: "hardware dependent, but is usually at least 100 Hz"; this is stated for `CMMotionManager`, not headphones. A third-party app lists 60-100 Hz for AirPods. Plan: measure on a real device and design for roughly 25-100 Hz with timestamps, not a fixed rate. | Unknown; measure |
| Which headphones? | Apple gives only examples: AirPods Pro 2 and AirPods 4 (official sample page), AirPods Max and AirPods Pro (axes figure). Apple's support page says AirPods 3, AirPods 4, AirPods Pro (all) and AirPods Max support Spatial Audio with head tracking; original AirPods/AirPods 2 do not. Beats models are unclear. Treat the support-page list as likely, then verify with `isDeviceMotionAvailable` at runtime. | Partly official (support.apple.com, not in `raw/`) |
| Simulator? | Official only for the headphone activity sample: run on a device. Third-party and a visionOS forum report `isDeviceMotionAvailable == false` in Simulator. Practical rule: test on a real iPhone/iPad/Mac with AirPods; code should handle `false`. | Official (sample) + unofficial |
| Rotation only, no position? | Apple lists only attitude, rotation rate, user acceleration (and gravity). No position/translation API exists in the saved pages. Treat head **position** as unavailable; user acceleration could be integrated but will drift. | Inferred |
| Forum threads 844940, 113537 | Could not be saved (bot-challenge page, not bypassed). Save them by hand if needed; they are non-official. | Failed |

## 4. Still unresolved
- `apple-motion-platform-docs.md` (team notes, Sections 2-3) is missing, so those claims are unchecked.
- Exact AirPods sample rate and full headphone list need a device test or an Apple support page saved into `raw/`.
- `CMBatchedSensorManager` header says `iOS: 4.0.0 -`, which looks wrong; trust watchOS 10.
- The updates log and release notes are absence evidence only; the real iOS 27 SDK may differ.

## 5. Sources outside `raw/` used in section 3 (unofficial or non-developer.apple.com)
- Apple Support: https://support.apple.com/guide/airpods/Control+spatial-audio-and-head-tracking-dev00eb7e0a3/web
- Third-party rate/model claim: https://makersportal.com/apps/motionlink
- Simulator report: https://scriptingapp.github.io/TestFlight/guide/Utilities/HeadphoneMotionManager
