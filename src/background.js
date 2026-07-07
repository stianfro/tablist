(function runBackground() {
  "use strict";

  const api = browser;
  const helpers = TablistPlaylist;
  const STORAGE_KEY = "tablistState";

  const defaultState = Object.freeze({
    items: [],
    currentIndex: -1,
    status: "idle",
    lastError: null,
    updatedAt: null
  });

  let state = { ...defaultState };
  const ready = loadState();

  async function loadState() {
    try {
      const stored = await api.storage.local.get(STORAGE_KEY);
      const restored = stored && stored[STORAGE_KEY];

      if (restored && Array.isArray(restored.items)) {
        state = {
          ...defaultState,
          ...restored,
          items: restored.items.filter((item) => item && typeof item.tabId === "number")
        };
        delete state.playerTabId;
      }
    } catch (error) {
      state = {
        ...defaultState,
        lastError: `Could not load saved playlist: ${error.message}`
      };
    }
  }

  async function saveState() {
    state = {
      ...state,
      updatedAt: new Date().toISOString()
    };
    await api.storage.local.set({ [STORAGE_KEY]: state });
    return state;
  }

  function cloneState() {
    return JSON.parse(JSON.stringify(state));
  }

  async function queryYouTubeTabs() {
    const tabs = await api.tabs.query({});
    return tabs
      .filter((tab) => helpers.isPlayableYouTubeUrl(tab.url))
      .sort((left, right) => {
        if (left.windowId !== right.windowId) {
          return left.windowId - right.windowId;
        }

        return left.index - right.index;
      })
      .map((tab) => helpers.tabToPlaylistItem(tab));
  }

  async function getTab(tabId) {
    try {
      return await api.tabs.get(tabId);
    } catch (_error) {
      return null;
    }
  }

  async function collectTabsById(tabIds) {
    const tabs = [];

    for (const tabId of tabIds || []) {
      if (typeof tabId !== "number") {
        continue;
      }

      const tab = await getTab(tabId);
      if (tab) {
        tabs.push(tab);
      }
    }

    return tabs;
  }

  async function ensureContentScript(tabId) {
    try {
      await api.tabs.sendMessage(tabId, { type: "TABLIST_PING" });
      return;
    } catch (_error) {
      // The tab may have been open before the extension loaded.
    }

    await api.tabs.executeScript(tabId, { file: "src/content.js" });
    await api.tabs.sendMessage(tabId, { type: "TABLIST_PING" });
  }

  async function pauseTab(tabId) {
    if (typeof tabId !== "number") {
      return;
    }

    try {
      await ensureContentScript(tabId);
      await api.tabs.sendMessage(tabId, { type: "TABLIST_PAUSE" });
    } catch (_error) {
      // Closed or restricted tabs can be ignored when pausing.
    }
  }

  async function stopCurrentTab() {
    const current = state.items[state.currentIndex];

    if (current) {
      await pauseTab(current.tabId);
    }
  }

  async function focusTab(tab) {
    if (typeof tab.windowId === "number") {
      try {
        await api.windows.update(tab.windowId, { focused: true });
      } catch (_error) {
        // Some browser windows cannot be focused. Continue with tab activation.
      }
    }

    await api.tabs.update(tab.id, { active: true });
  }

  function blockedPlaybackMessage(result) {
    if (result && result.message) {
      return result.message;
    }

    return "Firefox blocked playback in the next tab. Click play once in that tab, or allow audio and video autoplay for YouTube in Firefox site permissions.";
  }

  async function playIndex(index) {
    await ready;

    if (!Number.isInteger(index) || index < 0 || index >= state.items.length) {
      state = {
        ...state,
        status: state.items.length > 0 ? "idle" : "empty",
        currentIndex: -1,
        lastError: "Playlist index is out of range."
      };
      await saveState();
      return cloneState();
    }

    const previous = state.items[state.currentIndex];
    const next = state.items[index];

    if (previous && previous.tabId !== next.tabId) {
      await pauseTab(previous.tabId);
    }

    const tab = await getTab(next.tabId);

    if (!tab || !helpers.isPlayableYouTubeUrl(tab.url)) {
      state = {
        ...state,
        currentIndex: index,
        status: "waiting",
        items: helpers.removeItem(state.items, index),
        lastError: "That YouTube tab is no longer available."
      };
      if (state.currentIndex >= state.items.length) {
        state.currentIndex = state.items.length - 1;
      }
      await saveState();
      return cloneState();
    }

    state = {
      ...state,
      currentIndex: index,
      status: "playing",
      lastError: null,
      items: state.items.map((item) => (item.tabId === tab.id ? helpers.updateItemFromTab(item, tab) : item))
    };
    await saveState();

    try {
      await focusTab(tab);
      await ensureContentScript(tab.id);
      const result = await api.tabs.sendMessage(tab.id, { type: "TABLIST_PLAY" });

      if (!result || !result.ok) {
        state = {
          ...state,
          status: "waiting",
          lastError: blockedPlaybackMessage(result)
        };
        await saveState();
      }
    } catch (error) {
      state = {
        ...state,
        status: "waiting",
        lastError: `Could not start playback: ${error.message}`
      };
      await saveState();
    }

    return cloneState();
  }

  async function createPlaylist(tabIds) {
    await ready;
    const tabs = await collectTabsById(tabIds);
    const items = helpers.normalizePlaylist(tabs);

    await stopCurrentTab();

    state = {
      ...defaultState,
      items,
      status: items.length > 0 ? "idle" : "empty"
    };
    await saveState();
    return cloneState();
  }

  async function startSelected(tabIds) {
    await createPlaylist(tabIds);
    if (state.items.length === 0) {
      return cloneState();
    }

    return playIndex(0);
  }

  async function stopPlaylist() {
    await ready;
    await stopCurrentTab();
    state = {
      ...state,
      currentIndex: -1,
      status: state.items.length > 0 ? "idle" : "empty",
      lastError: null
    };
    await saveState();
    return cloneState();
  }

  async function removePlaylistItem(index) {
    await ready;
    const removed = state.items[index];
    const wasCurrent = index === state.currentIndex;

    if (removed && wasCurrent) {
      await pauseTab(removed.tabId);
    }

    const items = helpers.removeItem(state.items, index);
    let currentIndex = state.currentIndex;

    if (index < state.currentIndex) {
      currentIndex -= 1;
    } else if (wasCurrent) {
      currentIndex = -1;
    }

    state = {
      ...state,
      items,
      currentIndex,
      status: items.length > 0 ? (currentIndex >= 0 ? state.status : "idle") : "empty",
      lastError: null
    };
    await saveState();
    return cloneState();
  }

  async function movePlaylistItem(fromIndex, toIndex) {
    await ready;
    const moved = state.items[fromIndex];
    const items = helpers.moveItem(state.items, fromIndex, toIndex);
    const current = state.items[state.currentIndex];
    let currentIndex = -1;

    if (current) {
      currentIndex = items.findIndex((item) => item.tabId === current.tabId && item.url === current.url);
    }

    state = {
      ...state,
      items,
      currentIndex,
      lastError: moved ? null : "No playlist item was moved."
    };
    await saveState();
    return cloneState();
  }

  async function advanceFromTab(tabId) {
    await ready;
    const current = state.items[state.currentIndex];

    if (!current || current.tabId !== tabId || state.status !== "playing") {
      return cloneState();
    }

    const next = helpers.nextIndex(state.currentIndex, state.items.length);

    if (next === -1) {
      state = {
        ...state,
        status: "finished",
        lastError: null
      };
      await saveState();
      return cloneState();
    }

    return playIndex(next);
  }

  async function refreshPlaylistItems() {
    await ready;
    const refreshed = [];

    for (const item of state.items) {
      const tab = await getTab(item.tabId);
      if (tab && helpers.isSamePlayableVideo(tab.url, item.url)) {
        refreshed.push(helpers.updateItemFromTab(item, tab));
      } else {
        refreshed.push(item);
      }
    }

    state = {
      ...state,
      items: refreshed,
      currentIndex: refreshed.findIndex((item) => state.items[state.currentIndex] && item.tabId === state.items[state.currentIndex].tabId),
      status: refreshed.length > 0 ? state.status : "empty"
    };

    if (state.currentIndex < 0 && state.status === "playing") {
      state.status = "idle";
    }

    await saveState();
    return cloneState();
  }

  async function getOverview() {
    await ready;
    return {
      tabs: await queryYouTubeTabs(),
      state: cloneState()
    };
  }

  async function handleMessage(message, sender) {
    if (!message || typeof message.type !== "string") {
      return null;
    }

    switch (message.type) {
      case "TABLIST_GET_OVERVIEW":
        return getOverview();
      case "TABLIST_CREATE_PLAYLIST":
        return createPlaylist(message.tabIds);
      case "TABLIST_START_SELECTED":
        return startSelected(message.tabIds);
      case "TABLIST_PLAY_INDEX":
        return playIndex(message.index);
      case "TABLIST_STOP":
        return stopPlaylist();
      case "TABLIST_REMOVE_ITEM":
        return removePlaylistItem(message.index);
      case "TABLIST_MOVE_ITEM":
        return movePlaylistItem(message.fromIndex, message.toIndex);
      case "TABLIST_REFRESH_PLAYLIST":
        return refreshPlaylistItems();
      case "TABLIST_VIDEO_ENDED":
        return advanceFromTab(sender && sender.tab ? sender.tab.id : null);
      default:
        return null;
    }
  }

  api.runtime.onMessage.addListener((message, sender) => handleMessage(message, sender));

  api.tabs.onRemoved.addListener(async (tabId) => {
    await ready;
    const index = state.items.findIndex((item) => item.tabId === tabId);

    if (index !== -1) {
      await removePlaylistItem(index);
    }
  });

  api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await ready;

    if (!changeInfo.title && !changeInfo.url) {
      return;
    }

    const index = state.items.findIndex((item) => item.tabId === tabId);

    if (index === -1 || !helpers.isSamePlayableVideo(tab.url, state.items[index].url)) {
      return;
    }

    state = {
      ...state,
      items: state.items.map((item) => (item.tabId === tabId ? helpers.updateItemFromTab(item, tab) : item))
    };
    await saveState();
  });
})();
