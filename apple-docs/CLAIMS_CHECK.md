# CLAIMS_CHECK

**Caveat:** `apple-motion-platform-docs.md` was not found in the working folder (searched `Downloads/test` and `Downloads`), so Sections 2 and 3 could not be read. Only the nine "check first" claims from the task are checked here. Re-run once the notes file is present.

Quotes are short and verbatim from the files in `raw/` (retrieved 2026-11-14).

| # | Claim | Verdict | Official evidence | File |
|---|---|---|---|---|
| 1 | CMHeadphoneMotionManager first available iOS 14, macOS 14 | CONFIRMED | Header availability: `"iOS: 14.0.0 -"`, `"macOS: 14.0.0 -"` (also iPadOS 14, macCatalyst 14, watchOS 7). WWDC23: "first made available in iOS and iPadOS 14... also coming to macOS 14". | raw/coremotion__cmheadphonemotionmanager.md; raw/wwdc2023_10179.html |
| 2 | Which headphones are supported | NOT FOUND (no full list) | Only examples: "Headphones that support motion updates, such as AirPods Pro 2 or AirPods 4" (sample for CMHeadphoneActivityManager, iOS 18+); WWDC23: "audio products that support spatial audio with dynamic head tracking, like AirPods Pro"; the manager page's axes figure shows AirPods Max and AirPods Pro. No exhaustive model list. | raw/coremotion__getting-motion-activity-data-from-headphones.md; raw/wwdc2023_10179.html; raw/coremotion__cmheadphonemotionmanager.md |
| 3 | Rotation only, no position data | NOT FOUND (no explicit statement) | Docs list data as "attitude, user acceleration, and rotation rate" (WWDC23). No "position"/"translation" text appears in any saved CMDeviceMotion, CMAttitude or headphone page. Consistent with the claim, but Apple never says "no position". | raw/wwdc2023_10179.html |
| 4 | Only one earbud streams; ear detection switches buds | CONFIRMED (WWDC only, not API reference) | "motion data is delivered to you from one bud at a time"; "if data was streaming from my right bud but I take it out... then my left bud will take over the data stream". `SensorLocation` cases: `headphoneLeft`, `headphoneRight`. | raw/wwdc2023_10179.html; raw/coremotion__cmdevicemotion__SensorLocation-swift.enum.md |
| 5 | Needs NSMotionUsageDescription | CONFIRMED | "include the NSMotionUsageDescription key... If this key is absent, the system crashes your app when you start device-motion updates." | raw/coremotion__cmheadphonemotionmanager.md |
| 6 | Does not work in Simulator | NOT FOUND for CMHeadphoneMotionManager | Only the headphone *activity* sample says "it needs to run on a device, not in Simulator". Nothing equivalent on the manager pages. | raw/coremotion__getting-motion-activity-data-from-headphones.md |
| 7 | Max sample rate for headphone motion | NOT FOUND | No Hz figure for headphones. The only rates are for other APIs: CMMotionManager "maximum supported frequency is 100 Hz"; CMBatchedSensorManager "800 Hz accelerometer and 200 Hz device motion" (WWDC23). Do not apply these to headphones. | raw/wwdc2023_10179.html |
| 8a | CMBatchedSensorManager needs a workout session | CONFIRMED (WWDC only) | "Because this a workout-centric API, you need to have an active HealthKit workout session to get data." The API reference page says nothing about workouts. | raw/wwdc2023_10179.html; raw/coremotion__cmbatchedsensormanager.md |
| 8b | Which watches | CONFIRMED for WWDC23 (may be stale) | "Apple Watch Series 8 and Ultra support both high rate accelerometer and device motion." Page tag: watchOS 10.0+. Check `isAccelerometerSupported` / `isDeviceMotionSupported` at runtime for newer models. | raw/wwdc2023_10179.html; raw/coremotion__cmbatchedsensormanager.md |
| 9 | Any new head-motion API in iOS 27 | NOT FOUND | Searched iOS & iPadOS 27 and macOS 27 release notes for "motion", "CMHeadphone", "head track", "spatial", "AirPods": no Core Motion or headphone-motion entry. Closest hits are unrelated (AudioAccessoryKit fixed spatial audio; AirPods Max 2 firmware). The CMHeadphoneMotionManager page lists no iOS 27 tag. Absence in release notes is not proof of absence in the SDK. | raw/ios-ipados-release-notes_ios-ipados-27-release-notes.md; raw/macos-release-notes_macos-27-release-notes.md |

## Other findings
- `CMBatchedSensorManager` header says `iOS: 4.0.0 -` which looks odd for a watchOS 10 class; trust the watchOS 10.0 tag and verify before using on iPhone.
- Forum threads 844940 and 113537 could not be saved (bot-challenge page), so nothing is checked against them.
