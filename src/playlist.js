(function attachPlaylistHelpers(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.TablistPlaylist = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlaylistHelpers() {
  "use strict";

  function safeUrl(value) {
    if (typeof value !== "string" || value.trim() === "") {
      return null;
    }

    try {
      return new URL(value);
    } catch (_error) {
      return null;
    }
  }

  function isYouTubeHost(hostname) {
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  }

  function isPlayableYouTubeUrl(value) {
    const url = safeUrl(value);

    if (!url) {
      return false;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    if (!isYouTubeHost(url.hostname)) {
      return false;
    }

    if (url.pathname === "/watch") {
      return Boolean(url.searchParams.get("v"));
    }

    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/").filter(Boolean).length >= 2;
    }

    return false;
  }

  function tabToPlaylistItem(tab) {
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      index: typeof tab.index === "number" ? tab.index : 0,
      title: tab.title || tab.url || "YouTube tab",
      url: tab.url
    };
  }

  function normalizePlaylist(tabs) {
    const seen = new Set();
    const items = [];

    for (const tab of tabs || []) {
      if (!tab || typeof tab.id !== "number" || seen.has(tab.id)) {
        continue;
      }

      if (!isPlayableYouTubeUrl(tab.url)) {
        continue;
      }

      seen.add(tab.id);
      items.push(tabToPlaylistItem(tab));
    }

    return items;
  }

  function removeItem(items, index) {
    if (!Array.isArray(items) || index < 0 || index >= items.length) {
      return Array.isArray(items) ? items.slice() : [];
    }

    return items.slice(0, index).concat(items.slice(index + 1));
  }

  function moveItem(items, fromIndex, toIndex) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (fromIndex < 0 || fromIndex >= items.length) {
      return items.slice();
    }

    const clampedTarget = Math.max(0, Math.min(items.length - 1, toIndex));

    if (fromIndex === clampedTarget) {
      return items.slice();
    }

    const copy = items.slice();
    const item = copy.splice(fromIndex, 1)[0];
    copy.splice(clampedTarget, 0, item);
    return copy;
  }

  function nextIndex(currentIndex, length) {
    if (!Number.isInteger(currentIndex) || currentIndex < 0) {
      return length > 0 ? 0 : -1;
    }

    const next = currentIndex + 1;
    return next < length ? next : -1;
  }

  function updateItemFromTab(item, tab) {
    if (!item || !tab) {
      return item;
    }

    return {
      tabId: item.tabId,
      windowId: typeof tab.windowId === "number" ? tab.windowId : item.windowId,
      index: typeof tab.index === "number" ? tab.index : item.index,
      title: tab.title || item.title,
      url: tab.url || item.url
    };
  }

  return {
    isPlayableYouTubeUrl,
    moveItem,
    nextIndex,
    normalizePlaylist,
    removeItem,
    tabToPlaylistItem,
    updateItemFromTab
  };
});
