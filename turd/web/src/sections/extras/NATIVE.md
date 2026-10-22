# Extras ↔ native bridge

What the Extras section (`sections/extras.js` + `extras/engine.js`) calls on `window.TURD_NATIVE`.
Everything is optional: with no bridge the section runs in **browser preview** mode (official links,
winget / F-Droid commands to copy, reader opens local `.zim` files via the file picker).

## Top level
| call | used for |
|---|---|
| `platform` | `"windows"` / `"android"`: picks the default platform tab |
| `http(url, opts)` | CORS-free fetch for resolving newest builds (Kiwix OPDS + `.sha256`, HF tree API, F-Droid `api/v1`) and Ollama on 127.0.0.1:11434 when the webview blocks it |
| `on("extras:progress", fn)` | `{id, received, total, state?: "downloading"\|"verifying", line?}` while a download runs |
| `openExternal(url)` | system browser for "Official page", Play Store, external article links in the reader |

## `extras.*`
| call | shape | notes |
|---|---|---|
| `info({dir?})` | → `{dir, freeBytes, totalBytes, platform}` | shows free space in the header |
| `dirs()` | → `[{path, label?, freeBytes?}]` | suggested storage roots (SD card, second drive) |
| `pickDir()` | → `{path}` or `null` | saved as LS `turd_xtr_dir`, passed as `dir` to `download` |
| `download({id, url, name, sha256?, dir?})` | → `{id, path, size, verified?}` | must resume from `name.part`; must reject on sha256 mismatch |
| `cancel(id)` | | keep the `.part` so a later `download` resumes |
| `remove(id)` | | deletes the file (and unzip dir) |
| `list()` | → `[{id, name, size, path}]` | completed files, reconciles state on mount |
| `open(id)` | | run installer (.exe/.msi) / open APK installer / reveal file |
| `unzip(id)` | → `{dir}` | portable Windows apps shipped as .zip |
| `isInstalled(ids)` | → `{id: version\|null}` | winget ids on Windows, package names on Android |
| `winget(id)` | → `{ok, code, err?}` | `winget install --id <id> -e --accept-*` silently; engine falls back to `download`+`open` if missing or failing |
| `launch(pkg)` | | Android: open an installed app |

## Reader (needed to read downloaded ZIMs in-app)
Provide **one** of these; without either, "Read" tells the user to open the file in Kiwix.

- `readRange(id, offset, length)` → `ArrayBuffer | Uint8Array`. The reader asks for 64 KB aligned pages
  plus occasional larger cluster reads (≤ a few MB), so plain file seek+read is ideal.
- `fileUrl(id)` → a URL that honours HTTP `Range` (Tauri `asset://` / `convertFileSrc`, Capacitor
  `Capacitor.convertFileSrc`). Must return `206` + `Content-Range`.

## IDs
`id` is the catalog item id (`extras/catalog.js`), e.g. `wp-top-mini`, `kiwix`, `gguf-gemma3-1b`.
Files land in `<dir>/<name>`; `name` is the upstream filename so Kiwix and other readers recognise it.
