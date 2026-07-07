(function runPopup() {
  "use strict";

  const api = browser;
  const selected = new Set();
  let tabs = [];
  let playlistState = {
    items: [],
    currentIndex: -1,
    status: "idle",
    lastError: null
  };
  let firstRender = true;

  const elements = {
    refreshButton: document.getElementById("refreshButton"),
    selectAllButton: document.getElementById("selectAllButton"),
    startButton: document.getElementById("startButton"),
    stopButton: document.getElementById("stopButton"),
    statusText: document.getElementById("statusText"),
    tabsList: document.getElementById("tabsList"),
    playlistList: document.getElementById("playlistList")
  };

  function send(type, payload) {
    return api.runtime.sendMessage({ type, ...(payload || {}) });
  }

  function setStatus(text, isError) {
    elements.statusText.textContent = text;
    elements.statusText.classList.toggle("error", Boolean(isError));
  }

  function shortUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname === "/watch") {
        return `${parsed.hostname}/watch?v=${parsed.searchParams.get("v")}`;
      }
      return `${parsed.hostname}${parsed.pathname}`;
    } catch (_error) {
      return url || "";
    }
  }

  function createText(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    return element;
  }

  function selectedTabIdsInOrder() {
    return tabs.filter((tab) => selected.has(tab.tabId)).map((tab) => tab.tabId);
  }

  function renderAvailableTabs() {
    elements.tabsList.textContent = "";

    if (tabs.length === 0) {
      const empty = createText("li", "item", "No YouTube watch or Shorts tabs are open.");
      elements.tabsList.append(empty);
    }

    for (const tab of tabs) {
      const item = document.createElement("li");
      item.className = "item";

      const label = document.createElement("label");
      label.className = "check-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(tab.tabId);
      checkbox.dataset.tabId = String(tab.tabId);

      const copy = document.createElement("span");
      copy.append(createText("span", "title", tab.title || "YouTube tab"));
      copy.append(createText("span", "meta", shortUrl(tab.url)));

      label.append(checkbox, copy);
      item.append(label);
      elements.tabsList.append(item);
    }

    elements.startButton.disabled = selectedTabIdsInOrder().length === 0;
    elements.selectAllButton.disabled = tabs.length === 0;
  }

  function makeActionButton(label, action, index, disabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.dataset.action = action;
    button.dataset.index = String(index);
    button.disabled = Boolean(disabled);
    button.textContent = label;
    return button;
  }

  function renderPlaylist() {
    elements.playlistList.textContent = "";

    if (!playlistState.items || playlistState.items.length === 0) {
      const empty = createText("li", "item", "No playlist has been created yet.");
      elements.playlistList.append(empty);
      elements.stopButton.disabled = true;
      return;
    }

    elements.stopButton.disabled = playlistState.status === "empty" || playlistState.status === "idle" || playlistState.status === "finished";

    playlistState.items.forEach((item, index) => {
      const row = document.createElement("li");
      row.className = `item${index === playlistState.currentIndex ? " current" : ""}`;

      const content = document.createElement("div");
      content.className = "playlist-row";

      const marker = createText("span", "meta", index === playlistState.currentIndex ? "Now" : String(index + 1));
      const copy = document.createElement("span");
      copy.append(createText("span", "title", item.title || "YouTube tab"));
      copy.append(createText("span", "meta", shortUrl(item.url)));

      const actions = document.createElement("span");
      actions.className = "row-actions";
      actions.append(
        makeActionButton("Play", "play", index, false),
        makeActionButton("Up", "up", index, index === 0),
        makeActionButton("Down", "down", index, index === playlistState.items.length - 1),
        makeActionButton("Remove", "remove", index, false)
      );

      content.append(marker, copy, actions);
      row.append(content);
      elements.playlistList.append(row);
    });
  }

  function renderStatus() {
    const status = playlistState.status || "idle";
    const count = playlistState.items ? playlistState.items.length : 0;

    if (playlistState.lastError) {
      setStatus(playlistState.lastError, true);
      return;
    }

    if (status === "playing") {
      setStatus(`Playing item ${playlistState.currentIndex + 1} of ${count}.`, false);
      return;
    }

    if (status === "waiting") {
      setStatus("Waiting for playback. Click play in the focused YouTube tab if Firefox blocked it.", false);
      return;
    }

    if (status === "finished") {
      setStatus("Playlist finished.", false);
      return;
    }

    if (tabs.length === 0) {
      setStatus("Open YouTube watch or Shorts tabs, then refresh.", false);
      return;
    }

    setStatus(`${tabs.length} playable YouTube tab${tabs.length === 1 ? "" : "s"} found.`, false);
  }

  function render() {
    renderAvailableTabs();
    renderPlaylist();
    renderStatus();
  }

  async function refresh() {
    try {
      const overview = await send("TABLIST_GET_OVERVIEW");
      tabs = overview.tabs || [];
      playlistState = overview.state || playlistState;

      if (firstRender) {
        const playlistIds = new Set((playlistState.items || []).map((item) => item.tabId));
        const initialIds = playlistIds.size > 0 ? playlistIds : new Set(tabs.map((tab) => tab.tabId));
        selected.clear();
        for (const id of initialIds) {
          selected.add(id);
        }
        firstRender = false;
      } else {
        const availableIds = new Set(tabs.map((tab) => tab.tabId));
        for (const id of Array.from(selected)) {
          if (!availableIds.has(id)) {
            selected.delete(id);
          }
        }
      }

      render();
    } catch (error) {
      setStatus(`Could not read tabs: ${error.message}`, true);
    }
  }

  async function startSelected() {
    const tabIds = selectedTabIdsInOrder();

    if (tabIds.length === 0) {
      setStatus("Select at least one YouTube tab first.", true);
      return;
    }

    elements.startButton.disabled = true;
    try {
      playlistState = await send("TABLIST_START_SELECTED", { tabIds });
      render();
    } catch (error) {
      setStatus(`Could not start playlist: ${error.message}`, true);
    } finally {
      elements.startButton.disabled = selectedTabIdsInOrder().length === 0;
    }
  }

  async function stopPlaylist() {
    try {
      playlistState = await send("TABLIST_STOP");
      render();
    } catch (error) {
      setStatus(`Could not stop playlist: ${error.message}`, true);
    }
  }

  async function handlePlaylistAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const index = Number(button.dataset.index);
    const action = button.dataset.action;

    try {
      if (action === "play") {
        playlistState = await send("TABLIST_PLAY_INDEX", { index });
      } else if (action === "remove") {
        playlistState = await send("TABLIST_REMOVE_ITEM", { index });
      } else if (action === "up") {
        playlistState = await send("TABLIST_MOVE_ITEM", { fromIndex: index, toIndex: index - 1 });
      } else if (action === "down") {
        playlistState = await send("TABLIST_MOVE_ITEM", { fromIndex: index, toIndex: index + 1 });
      }
      render();
    } catch (error) {
      setStatus(`Playlist action failed: ${error.message}`, true);
    }
  }

  elements.tabsList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[type='checkbox'][data-tab-id]");
    if (!checkbox) {
      return;
    }

    const tabId = Number(checkbox.dataset.tabId);
    if (checkbox.checked) {
      selected.add(tabId);
    } else {
      selected.delete(tabId);
    }
    render();
  });

  elements.refreshButton.addEventListener("click", refresh);
  elements.startButton.addEventListener("click", startSelected);
  elements.stopButton.addEventListener("click", stopPlaylist);
  elements.playlistList.addEventListener("click", handlePlaylistAction);
  elements.selectAllButton.addEventListener("click", () => {
    const allSelected = tabs.length > 0 && tabs.every((tab) => selected.has(tab.tabId));
    selected.clear();

    if (!allSelected) {
      for (const tab of tabs) {
        selected.add(tab.tabId);
      }
    }

    render();
  });

  refresh();
})();
