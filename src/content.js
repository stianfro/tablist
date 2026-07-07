(function runContentScript() {
  "use strict";

  if (globalThis.__tablistContentScriptLoaded) {
    return;
  }
  globalThis.__tablistContentScriptLoaded = true;

  const api = browser;
  const PENDING_PLAY_KEY = "tablistPendingPlay";
  const state = {
    managed: false,
    video: null,
    endedHandler: null,
    observer: null,
    autoplayInterval: null
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendMessage(message) {
    try {
      const result = api.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") {
        return result.catch(() => null);
      }
      return Promise.resolve(result);
    } catch (_error) {
      return Promise.resolve(null);
    }
  }

  function getVideo() {
    return document.querySelector("video");
  }

  function describeVideo(video) {
    if (!video) {
      return {
        found: false,
        paused: true,
        ended: false,
        currentTime: 0,
        duration: 0
      };
    }

    return {
      found: true,
      paused: video.paused,
      ended: video.ended,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0
    };
  }

  function clickIfAutoplayIsOn(button) {
    if (!button) {
      return false;
    }

    const ariaChecked = button.getAttribute("aria-checked");
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const looksOn = ariaChecked === "true" || label.includes("autoplay is on") || label.includes("autoplay on");

    if (!looksOn) {
      return false;
    }

    button.click();
    return true;
  }

  function disableNativeAutoplay() {
    const candidates = [
      ".ytp-autonav-toggle-button",
      "button[data-tooltip-target-id='ytp-autonav-toggle-button']",
      "button[aria-label*='Autoplay']",
      "button[title*='Autoplay']"
    ];

    for (const selector of candidates) {
      for (const button of document.querySelectorAll(selector)) {
        if (clickIfAutoplayIsOn(button)) {
          return true;
        }
      }
    }

    return false;
  }

  function detachVideoHandler() {
    if (state.video && state.endedHandler) {
      state.video.removeEventListener("ended", state.endedHandler, true);
    }

    state.video = null;
    state.endedHandler = null;
  }

  async function handleManagedEnd(video) {
    if (!state.managed) {
      return;
    }

    disableNativeAutoplay();
    video.pause();

    const response = await sendMessage({
      type: "TABLIST_VIDEO_ENDED",
      url: location.href,
      title: document.title
    });

    const instruction = response && response.instruction;
    if (instruction && instruction.type === "TABLIST_LOAD_AND_PLAY" && instruction.url) {
      await loadAndPlay(instruction.url);
    }
  }

  function attachVideoHandler() {
    const video = getVideo();

    if (!video || video === state.video) {
      return video;
    }

    detachVideoHandler();

    state.video = video;
    state.endedHandler = () => {
      handleManagedEnd(video).catch((error) => {
        sendMessage({
          type: "TABLIST_PLAY_RESULT",
          ok: false,
          message: error && error.message ? error.message : "Could not move to the next playlist item."
        });
      });
    };

    video.addEventListener("ended", state.endedHandler, true);
    return video;
  }

  async function waitForVideo(timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const video = attachVideoHandler();

      if (video) {
        return video;
      }

      await sleep(100);
    }

    return null;
  }

  function startAutoplayGuard() {
    if (state.autoplayInterval) {
      return;
    }

    state.autoplayInterval = setInterval(() => {
      attachVideoHandler();

      if (state.managed) {
        disableNativeAutoplay();
      }
    }, 1000);
  }

  function startObserver() {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(() => {
      attachVideoHandler();
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function readPendingPlay() {
    try {
      const raw = sessionStorage.getItem(PENDING_PLAY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function writePendingPlay(url) {
    try {
      sessionStorage.setItem(PENDING_PLAY_KEY, JSON.stringify({
        url,
        createdAt: Date.now()
      }));
    } catch (_error) {
      // Session storage can be unavailable in rare private browsing states.
    }
  }

  function clearPendingPlay() {
    try {
      sessionStorage.removeItem(PENDING_PLAY_KEY);
    } catch (_error) {
      // Session storage can be unavailable in rare private browsing states.
    }
  }

  function videoKey(value) {
    let url;

    try {
      url = new URL(value, location.href);
    } catch (_error) {
      return null;
    }

    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id ? `watch:${id}` : null;
    }

    if (url.pathname.startsWith("/shorts/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length >= 2 ? `shorts:${parts[1]}` : null;
    }

    return null;
  }

  function isCurrentVideoUrl(url) {
    const currentKey = videoKey(location.href);
    return Boolean(currentKey && currentKey === videoKey(url));
  }

  function reportPlayResult(result) {
    return sendMessage({
      type: "TABLIST_PLAY_RESULT",
      ok: Boolean(result && result.ok),
      message: result && result.message ? result.message : null,
      video: result && result.video ? result.video : null
    });
  }

  async function playManaged() {
    state.managed = true;
    startAutoplayGuard();
    startObserver();
    disableNativeAutoplay();

    const video = await waitForVideo(10000);

    if (!video) {
      return {
        ok: false,
        message: "No video element was found in this YouTube tab."
      };
    }

    if (video.ended || (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.25)) {
      try {
        video.currentTime = 0;
      } catch (_error) {
        // Some media streams do not allow seeking.
      }
    }

    try {
      await video.play();
      return {
        ok: true,
        video: describeVideo(video)
      };
    } catch (error) {
      const playButton = document.querySelector(".ytp-play-button");

      if (playButton && video.paused) {
        playButton.click();
        await sleep(300);
      }

      if (!video.paused) {
        return {
          ok: true,
          video: describeVideo(video)
        };
      }

      return {
        ok: false,
        message: error && error.message ? error.message : "Playback did not start. Click play in this tab once."
      };
    }
  }

  async function loadAndPlay(url) {
    state.managed = true;
    startAutoplayGuard();
    startObserver();
    disableNativeAutoplay();

    if (!isCurrentVideoUrl(url)) {
      writePendingPlay(url);
      location.assign(url);
      return {
        ok: true,
        navigating: true
      };
    }

    clearPendingPlay();
    const result = await playManaged();
    await reportPlayResult(result);
    return result;
  }

  async function resumePendingPlay() {
    const pending = readPendingPlay();

    if (!pending || !pending.url) {
      return;
    }

    if (pending.createdAt && Date.now() - pending.createdAt > 120000) {
      clearPendingPlay();
      return;
    }

    if (!isCurrentVideoUrl(pending.url)) {
      return;
    }

    await sleep(500);
    await loadAndPlay(pending.url);
  }

  async function pauseManaged() {
    const video = attachVideoHandler();

    if (video) {
      video.pause();
    }

    return {
      ok: true,
      video: describeVideo(video)
    };
  }

  api.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") {
      return null;
    }

    switch (message.type) {
      case "TABLIST_PING":
        return Promise.resolve({
          ok: true,
          managed: state.managed,
          video: describeVideo(attachVideoHandler())
        });
      case "TABLIST_PLAY":
        return playManaged();
      case "TABLIST_LOAD_AND_PLAY":
        return loadAndPlay(message.url);
      case "TABLIST_PAUSE":
        return pauseManaged();
      default:
        return null;
    }
  });

  startAutoplayGuard();
  startObserver();
  attachVideoHandler();
  resumePendingPlay().catch((error) => {
    reportPlayResult({
      ok: false,
      message: error && error.message ? error.message : "Could not resume playlist playback after navigation."
    });
  });
})();
