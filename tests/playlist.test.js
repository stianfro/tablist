const test = require("node:test");
const assert = require("node:assert/strict");
const playlist = require("../src/playlist.js");

test("detects playable YouTube URLs", () => {
  assert.equal(playlist.isPlayableYouTubeUrl("https://www.youtube.com/watch?v=abc123"), true);
  assert.equal(playlist.isPlayableYouTubeUrl("https://m.youtube.com/watch?v=abc123&list=one"), true);
  assert.equal(playlist.isPlayableYouTubeUrl("https://www.youtube.com/shorts/abc123"), true);
  assert.equal(playlist.isPlayableYouTubeUrl("https://www.youtube.com/"), false);
  assert.equal(playlist.isPlayableYouTubeUrl("https://www.youtube.com/watch"), false);
  assert.equal(playlist.isPlayableYouTubeUrl("https://example.com/watch?v=abc123"), false);
});

test("normalizes tabs into a playlist without duplicates", () => {
  const tabs = [
    { id: 1, windowId: 2, index: 0, title: "One", url: "https://www.youtube.com/watch?v=one" },
    { id: 2, windowId: 2, index: 1, title: "Two", url: "https://www.youtube.com/shorts/two" },
    { id: 1, windowId: 2, index: 0, title: "One again", url: "https://www.youtube.com/watch?v=one" },
    { id: 3, windowId: 2, index: 2, title: "Home", url: "https://www.youtube.com/" }
  ];

  assert.deepEqual(
    playlist.normalizePlaylist(tabs).map((item) => item.tabId),
    [1, 2]
  );
});

test("moves playlist items", () => {
  const items = ["a", "b", "c", "d"];
  assert.deepEqual(playlist.moveItem(items, 2, 0), ["c", "a", "b", "d"]);
  assert.deepEqual(playlist.moveItem(items, 0, 99), ["b", "c", "d", "a"]);
  assert.deepEqual(playlist.moveItem(items, -1, 1), items);
});

test("removes playlist items", () => {
  assert.deepEqual(playlist.removeItem(["a", "b", "c"], 1), ["a", "c"]);
  assert.deepEqual(playlist.removeItem(["a", "b", "c"], 8), ["a", "b", "c"]);
});

test("computes the next playlist index", () => {
  assert.equal(playlist.nextIndex(-1, 3), 0);
  assert.equal(playlist.nextIndex(0, 3), 1);
  assert.equal(playlist.nextIndex(2, 3), -1);
  assert.equal(playlist.nextIndex(-1, 0), -1);
});

test("updates an item from a browser tab", () => {
  const item = {
    tabId: 1,
    windowId: 1,
    index: 0,
    title: "Old",
    url: "https://www.youtube.com/watch?v=old"
  };
  const tab = {
    id: 1,
    windowId: 3,
    index: 4,
    title: "New",
    url: "https://www.youtube.com/watch?v=new"
  };

  assert.deepEqual(playlist.updateItemFromTab(item, tab), {
    tabId: 1,
    windowId: 3,
    index: 4,
    title: "New",
    url: "https://www.youtube.com/watch?v=new"
  });
});

test("compares playable video URLs by video identity", () => {
  assert.equal(
    playlist.isSamePlayableVideo("https://www.youtube.com/watch?v=abc123&t=4", "https://m.youtube.com/watch?v=abc123&list=queue"),
    true
  );
  assert.equal(
    playlist.isSamePlayableVideo("https://www.youtube.com/shorts/abc123", "https://m.youtube.com/shorts/abc123?feature=share"),
    true
  );
  assert.equal(
    playlist.isSamePlayableVideo("https://www.youtube.com/watch?v=abc123", "https://www.youtube.com/watch?v=other"),
    false
  );
});

test("builds a playback URL for the current player host", () => {
  const playbackUrl = playlist.toPlaybackUrl(
    "https://m.youtube.com/watch?v=abc123&list=queue",
    "https://www.youtube.com/watch?v=player"
  );
  const parsed = new URL(playbackUrl);

  assert.equal(parsed.hostname, "www.youtube.com");
  assert.equal(parsed.searchParams.get("v"), "abc123");
  assert.equal(parsed.searchParams.get("autoplay"), "1");
  assert.equal(parsed.searchParams.has("list"), false);
});
