(() => {
  "use strict";

  const marker = "zen-unpinned-folder";
  const preference = "zen.mods.unpinned-folders.group-ids";
  let stopped = false;
  let original;
  let wrapped;
  let browser;

  function readIds() {
    const ids = JSON.parse(Services.prefs.getStringPref(preference, "[]"));
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) {
      throw new Error("Invalid saved group IDs; existing groups were not changed.");
    }
    return new Set(ids);
  }

  function eligible(group) {
    return group?.localName === "tab-group" &&
      group.isConnected && group.id && !group.isZenFolder &&
      !group.pinned && !group.essential &&
      !group.hasAttribute("split-view-group") &&
      !group.hasAttribute("drag-image") &&
      !group.closest("zen-folder") &&
      !group.tabs.some(tab => tab.pinned || tab.hasAttribute("zen-essential"));
  }

  function mark(group) {
    if (!eligible(group)) {
      return;
    }
    group.setAttribute(marker, "true");
  }

  function restoreKnownGroups() {
    if (stopped) {
      return;
    }
    try {
      const ids = readIds();
      for (const group of document.querySelectorAll("tab-group")) {
        if (ids.has(group.id)) {
          mark(group);
        }
      }
    } catch (error) {
      console.error("[Zen Unpinned Folders]", error);
    }
  }

  function onGroupCreated(event) {
    const group = event.target;
    // TabGroupCreate fires before addTabGroup has assigned tabs/pinned state.
    queueMicrotask(() => {
      if (stopped) {
        return;
      }
      try {
        if (readIds().has(group.id)) {
          mark(group);
        }
      } catch (error) {
        console.error("[Zen Unpinned Folders]", error);
      }
    });
  }

  function start() {
    if (stopped || browser) {
      return;
    }
    try {
      readIds();
      browser = window.gBrowser;
      if (typeof browser?.addTabGroup !== "function") {
        throw new Error("Unsupported Zen version: addTabGroup is unavailable.");
      }
      original = browser.addTabGroup;
      wrapped = function (...args) {
        const group = Reflect.apply(original, this, args);
        const options = args[1] ?? {};
        // Zen supplies IDs when restoring/adopting groups. Never enroll those.
        try {
          if (!stopped && !options.id && !options.isAdoptingGroup &&
              !options.forSplitView && eligible(group)) {
            const ids = readIds();
            ids.add(group.id);
            Services.prefs.setStringPref(preference, JSON.stringify([...ids]));
            mark(group);
          }
        } catch (error) {
          console.error("[Zen Unpinned Folders]", error);
        }
        return group;
      };
      browser.addTabGroup = wrapped;
      window.addEventListener("TabGroupCreate", onGroupCreated);
      window.addEventListener("SSWindowStateReady", restoreKnownGroups);
      restoreKnownGroups();
    } catch (error) {
      console.error("[Zen Unpinned Folders]", error);
    }
  }

  function onStartup(subject) {
    if (subject === window) {
      Services.obs.removeObserver(onStartup, "browser-delayed-startup-finished");
      waitingForStartup = false;
      start();
    }
  }

  function stop() {
    stopped = true;
    if (waitingForStartup) {
      Services.obs.removeObserver(onStartup, "browser-delayed-startup-finished");
      waitingForStartup = false;
    }
    window.removeEventListener("TabGroupCreate", onGroupCreated);
    window.removeEventListener("SSWindowStateReady", restoreKnownGroups);
    window.removeEventListener("unload", stop);
    if (browser && browser.addTabGroup === wrapped) {
      browser.addTabGroup = original;
    }
    for (const group of document.querySelectorAll(`tab-group[${marker}]`)) {
      group.removeAttribute(marker);
    }
  }

  let waitingForStartup = !window.gBrowserInit?.delayedStartupFinished;
  window.addUnloadListener?.(stop);
  window.addEventListener("unload", stop, { once: true });
  if (waitingForStartup) {
    Services.obs.addObserver(onStartup, "browser-delayed-startup-finished");
  } else {
    start();
  }
})();
