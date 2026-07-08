# Tablist

Tablist is a Firefox-first WebExtension that turns selected YouTube tabs into a tab-based playlist. It plays the selected tabs in browser tab order and moves to the next selected tab when the current video ends.

## Install from GitHub release

1. Open the latest release: <https://github.com/stianfro/tablist/releases/latest>
2. Download the signed `.xpi` file from the release assets, for example `tablist-0.1.2.xpi`.
3. Open the downloaded `.xpi` file in Firefox, or drag it into a Firefox window.
4. Confirm the install prompt.

Use the signed `.xpi` for normal installs. The `.zip` file is the unsigned source package used for AMO submission and temporary development installs.

Tablist requires Firefox 140 or newer. Firefox for Android requires version 142 or newer.

## Temporary development install

1. Open the latest release: <https://github.com/stianfro/tablist/releases/latest>
2. Download `tablist-0.1.2.zip` from the release assets.
3. Open `about:debugging#/runtime/this-firefox` in Firefox.
4. Click **Load Temporary Add-on**.
5. Select the downloaded zip file. If Firefox does not accept the zip, unzip it and select `manifest.json` from the extracted folder.

Firefox temporary add-ons are removed when Firefox restarts.

## Required Firefox autoplay setting

For hands-free tab-to-tab playback, YouTube must be allowed to autoplay audio:

1. Open any `youtube.com` video tab.
2. Click the site controls or permissions icon in the Firefox address bar.
3. Set **Autoplay** to **Allow Audio and Video** for YouTube.

If YouTube is set to block audio, Tablist can focus the next tab, but Firefox will block script-started playback.

## How to use

1. Open the YouTube videos you want as tabs.
2. Click the Tablist toolbar button.
3. Select the tabs that should be in the playlist.
4. Click **Start selected**.
5. Leave the selected tabs open while the playlist runs.

Tablist uses the selected tab order as the initial playlist order. You can move items up or down in the popup after creating the playlist.

## What it does

- Finds open YouTube watch and Shorts tabs.
- Lets you select which tabs belong in the playlist.
- Starts playback from the first selected tab.
- Stops the current managed tab when its video ends.
- Focuses the next selected tab and starts that tab's video.
- Tries to turn off YouTube native autoplay while Tablist is managing playback.

## Troubleshooting

### The next tab opens but does not play

Check YouTube autoplay permissions in Firefox. Set YouTube to **Allow Audio and Video**.

### A tab does not respond after loading the extension

Reload that YouTube tab once. Tabs that were already open before the extension loaded may need a reload before the content script is active.

### YouTube tries to choose another video

Tablist turns off YouTube native autoplay while it is managing playback. If YouTube still changes videos by itself, reopen the Tablist popup, stop the playlist, then start it again.

## Development

Use `just` for project tasks:

```sh
just ci
just package
```

The package task writes a zip file to `dist/`.

## Release

1. Update the version in `manifest.json` and `package.json`.
2. Run `just package`. This writes the unsigned AMO submission zip to `dist/`.
3. Submit the zip to addons.mozilla.org for self-distribution signing.
4. After AMO approves it, download the signed `.xpi` from AMO Developer Hub.
5. Create or update the GitHub release and upload the signed `.xpi` as the install package.
6. Upload the unsigned zip only when you also want to provide the source package used for AMO submission.
