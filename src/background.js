(function runBackground() {
  "use strict";

  const api = browser;
  const helpers = TablistPlaylist;
  const STORAGE_KEY = "tablistState";

  const defaultState = Object.freeze({
    items: [],
    currentIndex: -1,
    playerTabId: null,
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

  function cloneState(extra) {
    return JSON.parse(JSON.stringify({ ...state, ...(extra || {}) }));
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
    if (typeof state.playerTabId === "number") {
      await pauseTab(state.playerTabId);
      return;
    }

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

  async function getPlayerTab(fallbackItem) {
    if (typeof state.playerTabId === "number") {
      const tab = await getTab(state.playerTabId);
      if (tab) {
        return tab;
      }
    }

    if (fallbackItem && typeof fallbackItem.tabId === "number") {
      return getTab(fallbackItem.tabId);
    }

    return null;
  }

  function playbackUrlForItem(item, playerTab) {
    return helpers.toPlaybackUrl(item.url, playerTab ? playerTab.url : null);
  }

  async function askPlayerTabToPlay(tab, item) {
    await focusTab(tab);
    await ensureContentScript(tab.id);

    if (helpers.isSamePlayableVideo(tab.url, item.url)) {
      return api.tabs.sendMessage(tab.id, { type: "TABLIST_PLAY" });
    }

    return api.tabs.sendMessage(tab.id, {
      type: "TABLIST_LOAD_AND_PLAY",
      url: playbackUrlForItem(item, tab)
    });
  }

  function playbackBlockedMessage(result) {
    if (result && result.message) {
      return result.message;
    }

    return "Firefox blocked automatic playback. Click play in the focused YouTube tab once, then Tablist can keep using that tab.";
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

    const next = state.items[index];
    const previousPlayerTabId = state.playerTabId;
    const playerTab = await getPlayerTab(next);

    if (!playerTab) {
      state = {
        ...state,
        currentIndex: index,
        playerTabId: null,
        status: "waiting",
        lastError: "The player tab is no longer available. Start the playlist again from an open YouTube tab."
      };
      await saveState();
      return cloneState();
    }

    if (typeof previousPlayerTabId === "number" && previousPlayerTabId !== playerTab.id) {
      await pauseTab(previousPlayerTabId);
    }

    state = {
      ...state,
      currentIndex: index,
      playerTabId: playerTab.id,
      status: "playing",
      lastError: null
    };
    await saveState();

    try {
      const result = await askPlayerTabToPlay(playerTab, next);

      if (!result || (!result.ok && !result.navigating)) {
        state = {
          ...state,
          status: "waiting",
          lastError: playbackBlockedMessage(result)
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
      playerTabId: null,
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
      await stopCurrentTab();
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
      playerTabId: wasCurrent ? null : state.playerTabId,
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

    if (state.playerTabId !== tabId || state.status !== "playing") {
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

    const tab = await getTab(tabId);
    const item = state.items[next];
    state = {
      ...state,
      currentIndex: next,
      playerTabId: tabId,
      status: "playing",
      lastError: null
    };
    await saveState();

    return cloneState({
      instruction: {
        type: "TABLIST_LOAD_AND_PLAY",
        index: next,
        url: playbackUrlForItem(item, tab)
      }
    });
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
      status: refreshed.length > 0 ? state.status : "empty"
    };

    await saveState();
    return cloneState();
  }

  async function recordPlaybackResult(message, sender) {
    await ready;
    const tabId = sender && sender.tab ? sender.tab.id : null;

    if (tabId !== state.playerTabId) {
      return cloneState();
    }

    if (message.ok) {
      state = {
        ...state,
        status: "playing",
        lastError: null
      };
    } else {
      state = {
        ...state,
        status: "waiting",
        lastError: playbackBlockedMessage(message)
      };
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
      case "TABLIST_PLAY_RESULT":
        return recordPlaybackResult(message, sender);
      default:
        return null;
    }
  }

  api.runtime.onMessage.addListener((message, sender) => handleMessage(message, sender));

  api.tabs.onRemoved.addListener(async (tabId) => {
    await ready;

    if (tabId !== state.playerTabId) {
      return;
    }

    state = {
      ...state,
      playerTabId: null,
      status: state.items.length > 0 ? "waiting" : "empty",
      lastError: "The player tab was closed. Start the playlist again from an open YouTube tab."
    };
    await saveState();
  });

  api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await ready;

    if (!changeInfo.title && !changeInfo.url) {
      return;
    }

    state = {
      ...state,
      items: state.items.map((item) => {
        if (item.tabId !== tabId || !helpers.isSamePlayableVideo(tab.url, item.url)) {
          return item;
        }

        return helpers.updateItemFromTab(item, tab);
      })
    };
    await saveState();
  });
})();
