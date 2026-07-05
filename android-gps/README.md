# HeartlandStormChaser Android GPS

Android sender app for HeartlandStormChaser. Pair a device, broadcast GPS every 10 seconds, and set the platform GPS source for weather and overlays.

## Requirements

- Android Studio Ladybug or newer
- JDK 17
- Android SDK 34

## Open the project

1. Open Android Studio
2. **File → Open** and select the `android-gps/` folder
3. Let Gradle sync complete (Android Studio will create the Gradle wrapper if needed)

## Configure for local dev

On the pairing screen, set **Server URL** to your machine's LAN address when testing against `npm run dev`:

```
http://192.168.x.x:8787
```

For production:

```
https://heartlandstormchaser.ike-j-rebout.workers.dev
```

Enter the same **GPS_PAIRING_PIN** configured on the Worker.

## Pairing flow

1. Launch the app
2. Enter server URL, PIN, and device name
3. Tap **Pair device**
4. On success, credentials are stored locally:
   - `device_id`
   - `device_token` (Bearer auth for GPS updates)
   - server URL and device name

Verify on the web GPS page: `/gps.html`

Use **Re-pair device** from the main menu to change server or credentials.

## GPS tab (Phase 7)

After pairing, the **GPS** tab provides:

- **GPS broadcast** toggle — starts a foreground service that uploads location every 10 seconds
- **Set as Platform GPS Source** — marks this device as the platform location for weather/overlays
- Live status: lat/lon, speed, heading, accuracy, battery, last upload time
- **Weather at platform location** — refreshed every 60 seconds from `/api/weather/platform`

The app requests location and notification permissions when you enable broadcast. A persistent notification shows broadcast status; tap **Stop GPS** in the notification to stop.

## Build APK (debug)

### GitHub Actions (recommended)

Push to **`main`**. The workflow builds a debug APK, publishes it to GitHub Releases, and updates the GPS page QR download URL in D1.

Bump `versionCode` / `versionName` in `app/build.gradle.kts` before pushing when you want a new installable version.

### Local build (Android Studio)

```bash
./gradlew :app:assembleDebug
```

APK output:

```
app/build/outputs/apk/debug/app-debug.apk
```

The app toolbar shows the installed version (`versionName` / `versionCode`). Match that against the **Current APK** label on `/gps.html`.

## Overlays tab (Phase 8)

The **Overlays** tab lets you configure data used by OBS browser sources:

- **Overlay target location** — city + state with autocomplete suggestions (Heartland-focused city list). Saved to `overlay_target_city` and `overlay_target_state` in D1.
- **Ticker / status text** — freeform status line saved to `overlay_ticker_text` for future ticker overlays.

Settings sync via:

- `GET /api/overlay/settings`
- `PUT /api/overlay/settings`

The OBS GPS/weather overlay uses the saved city/state as the display location when set; otherwise it falls back to the nearest city from GPS weather data.

## Phase status

| Phase | Feature | Status |
|-------|---------|--------|
| 6 | Pairing screen | Done |
| 7 | GPS broadcast tab | Done |
| 8 | Overlays tab | Done |

## API used

- `POST /api/gps/pair` with `{ pin, device_name, device_id? }`
- `POST /api/gps/update` with Bearer token — GPS fields every 10s
- `GET /api/gps/platform` / `POST /api/gps/platform` with `{ device_id }`
- `GET /api/weather/platform`
- `GET /api/overlay/settings` / `PUT /api/overlay/settings`
