(function runContentScript() {
  "use strict";

  if (globalThis.__tablistContentScriptLoaded) {
    return;
  }
  globalThis.__tablistContentScriptLoaded = true;

  const api = browser;
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
        result.catch(() => {});
      }
      return result;
    } catch (_error) {
      return null;
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

  function attachVideoHandler() {
    const video = getVideo();

    if (!video || video === state.video) {
      return video;
    }

    detachVideoHandler();

    state.video = video;
    state.endedHandler = () => {
      if (!state.managed) {
        return;
      }

      disableNativeAutoplay();
      video.pause();
      sendMessage({
        type: "TABLIST_VIDEO_ENDED",
        url: location.href,
        title: document.title
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

  async function waitForVisibleTab(timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (document.visibilityState === "visible") {
        return true;
      }

      await sleep(100);
    }

    return document.visibilityState === "visible";
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

  function resetEndedVideo(video) {
    if (!video) {
      return;
    }

    if (!video.ended && (!Number.isFinite(video.duration) || video.duration <= 0 || video.currentTime < video.duration - 0.25)) {
      return;
    }

    try {
      video.currentTime = 0;
    } catch (_error) {
      // Some media streams do not allow seeking.
    }
  }

  async function tryYouTubePlayButton(video) {
    const playButton = document.querySelector(".ytp-play-button");

    if (playButton && video.paused) {
      playButton.click();
      await sleep(300);
    }

    return !video.paused;
  }

  async function playManaged() {
    state.managed = true;
    startAutoplayGuard();
    startObserver();
    disableNativeAutoplay();
    await waitForVisibleTab(3000);

    const video = await waitForVideo(10000);

    if (!video) {
      return {
        ok: false,
        message: "No video element was found in this YouTube tab."
      };
    }

    resetEndedVideo(video);

    if (await tryYouTubePlayButton(video)) {
      return {
        ok: true,
        video: describeVideo(video)
      };
    }

    try {
      await video.play();
      return {
        ok: true,
        video: describeVideo(video)
      };
    } catch (error) {
      if (await tryYouTubePlayButton(video)) {
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
      case "TABLIST_PAUSE":
        return pauseManaged();
      default:
        return null;
    }
  });

  startAutoplayGuard();
  startObserver();
  attachVideoHandler();
})();
