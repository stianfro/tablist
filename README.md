# Tablist

Tablist is a Firefox-first WebExtension that turns selected YouTube tabs into a tab-based playlist. It plays the selected tabs in browser tab order and moves to the next selected tab when the current video ends.

## What it does

- Finds open YouTube watch and Shorts tabs.
- Lets you select which tabs belong in the playlist.
- Starts playback from the first selected tab.
- Stops the current managed tab when its video ends.
- Focuses the next selected tab and starts that tab's video.
- Tries to turn off YouTube native autoplay while Tablist is managing playback.

## Install for local testing

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from this folder.
4. Open a few YouTube video tabs.
5. Click the Tablist toolbar button, select tabs, then click **Start selected**.

Temporary add-ons are removed when Firefox restarts. Package the extension when you want a zip file for signing or sharing.

## Development

Use `just` for project tasks:

```sh
just ci
just package
```

The package task writes a zip file to `dist/`.

## Notes

YouTube is a single-page app and can change its controls over time. Tablist uses video events for the playlist handoff, and uses a best-effort selector for YouTube autoplay controls. Firefox can reject script-started media playback. If playback is blocked, click play once in the focused YouTube tab, or allow audio and video autoplay for YouTube in Firefox site permissions.
