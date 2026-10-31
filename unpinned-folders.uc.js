(() => {
  "use strict";

  const marker = "zen-unpinned-folder";
  const preference = "zen.mods.unpinned-folders.group-ids";
  const groupAccessors = new WeakMap();
  const openMarker = "zen-unpinned-folder-open";
  const openOwners = new WeakMap();
  const visibilityMethods = new WeakMap();
  const visibilityEvents = ["TabGroupCollapse", "TabGroupExpand", "TabMultiSelect"];
  let tabObserver;
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
    repairGroupItems(group);
    extendVisibility(group);
    refreshVisibility();
  }

  function ownerOf(tab) {
    return tab?.closest?.(`tab-group[${marker}]:not([split-view-group])`);
  }

  function canRemember(tab, group) {
    return group?.hasAttribute(marker) && eligible(group) && group.collapsed &&
      tab.isConnected && !tab.pinned &&
      !["pending", "closing", "pinned", "zen-essential"].some(name => tab.hasAttribute(name));
  }

  function remember(tab) {
    const split = tab?.splitview ??
      (tab?.group?.hasAttribute?.("split-view-group") ? tab.group : null);
    for (const child of split?.tabs ?? [tab]) {
      const group = ownerOf(child);
      if (canRemember(child, group)) {
        const changed = !child.hasAttribute(openMarker);
        openOwners.set(child, group);
        child.setAttribute(openMarker, "true");
        if (changed) browser.tabContainer?._invalidateCachedTabs();
      }
    }
  }

  function restoreAria(tab) {
    const item = tab.splitview ?? tab;
    const selected = tab.splitview
      ? tab.splitview.tabs.some(child => child.selected)
      : tab.selected;
    if (tab.group?.collapsed && !selected) {
      item.setAttribute("aria-hidden", "true");
    } else {
      item.removeAttribute("aria-hidden");
    }
  }

  function forget(tab) {
    const sameGroup = ownerOf(tab) === openOwners.get(tab);
    tab.removeAttribute(openMarker);
    openOwners.delete(tab);
    browser.tabContainer?._invalidateCachedTabs();
    if (sameGroup) restoreAria(tab);
  }

  function refreshVisibility() {
    if (stopped) return;
    for (const tab of document.querySelectorAll(`tab[${openMarker}]`)) {
      const group = ownerOf(tab);
      if (openOwners.get(tab) !== group || !canRemember(tab, group)) {
        forget(tab);
      }
    }
    for (const group of document.querySelectorAll(`tab-group[${marker}]`)) {
      if (!eligible(group)) continue;
      for (const tab of group.querySelectorAll?.("tab") ?? group.tabs) {
        if (tab.selected || tab.multiselected) remember(tab);
        if (tab.hasAttribute(openMarker)) {
          (tab.splitview ?? tab).removeAttribute("aria-hidden");
        }
      }
    }
  }

  function extendVisibility(group) {
    if (visibilityMethods.has(group) || typeof group.isTabVisibleInGroup !== "function") return;
    const previous = Object.getOwnPropertyDescriptor(group, "isTabVisibleInGroup");
    if (previous && !previous.configurable) return;
    const originalVisible = group.isTabVisibleInGroup;
    const replacement = function (tab) {
      return Reflect.apply(originalVisible, this, [tab]) ||
        (!stopped && !this.isBeingDragged && ownerOf(tab) === this &&
          openOwners.get(tab) === this && tab.hasAttribute(openMarker) &&
          canRemember(tab, this));
    };
    Object.defineProperty(group, "isTabVisibleInGroup", {
      configurable: true, writable: true, value: replacement,
    });
    // Zen 1.24b's tab.visible reads activeTabs on collapsed ancestors.
    let activeTabsGetter;
    if (!("activeTabs" in group)) {
      activeTabsGetter = function () {
        if (stopped) return [];
        return Array.from(this.querySelectorAll("tab")).filter(tab =>
          openOwners.get(tab) === this && tab.hasAttribute(openMarker) &&
          ownerOf(tab) === this && canRemember(tab, this)
        );
      };
      Object.defineProperty(group, "activeTabs", { configurable: true, get: activeTabsGetter });
    }
    visibilityMethods.set(group, { previous, replacement, activeTabsGetter });
  }

  function onTabSelect(event) {
    if (stopped) return;
    remember(event.detail?.previousTab);
    remember(event.target);
    // Native TabSelect listeners can update aria-hidden later in this event.
    queueMicrotask(refreshVisibility);
  }

  function onTabMutations(records) {
    if (stopped) return;
    for (const record of records) {
      if (["selected", "multiselected"].includes(record.attributeName) &&
          record.oldValue === "true") {
        remember(record.target);
      }
    }
    refreshVisibility();
  }

  function repairGroupItems(group) {
    if (groupAccessors.has(group) || !group.groupContainer ||
        group.tabsAndSplitViews?.length) {
      return;
    }
    const previous = Object.getOwnPropertyDescriptor(group, "tabsAndSplitViews");
    if (previous && !previous.configurable) {
      return;
    }
    // Zen 1.23.4b nests items in groupContainer; its inherited getter reads
    // direct group children instead, leaving native Ungroup/Move with no items.
    const get = function () {
      return Array.from(this.groupContainer.children).filter(item =>
        browser.isTab(item) || browser.isSplitViewWrapper(item)
      );
    };
    if (!get.call(group).length) {
      return;
    }
    Object.defineProperty(group, "tabsAndSplitViews", { configurable: true, get });
    groupAccessors.set(group, { previous, get });
  }

  function enrollCurrentGroups() {
    if (stopped) {
      return;
    }
    try {
      const ids = readIds();
      for (const group of document.querySelectorAll("tab-group")) {
        if (eligible(group)) {
          ids.add(group.id);
          mark(group);
        }
      }
      if (ids.size) Services.prefs.setStringPref(preference, JSON.stringify([...ids]));
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
        if (eligible(group)) {
          const ids = readIds();
          ids.add(group.id);
          Services.prefs.setStringPref(preference, JSON.stringify([...ids]));
          mark(group);
        }
      } catch (error) {
        console.error("[Zen Unpinned Folders]", error);
      }
    });
  }

  function onHeaderContextMenu(event) {
    if (stopped || event.defaultPrevented) {
      return;
    }
    const header = event.target?.closest?.(".tab-group-label-container");
    const group = header?.parentElement;
    if (!group?.hasAttribute(marker)) {
      return;
    }
    try {
      const menu = browser.tabGroupMenu;
      if (!eligible(group) || typeof menu?.openEditModal !== "function") {
        return;
      }
      repairGroupItems(group);
      // Reuse native editing and persistence for names, colors and group actions.
      menu.openEditModal(group);
      event.preventDefault();
      event.stopPropagation();
    } catch (error) {
      console.error("[Zen Unpinned Folders]", error);
    }
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
        // Restore/adoption calls are handled after creation or session restore.
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
      window.addEventListener("SSWindowStateReady", enrollCurrentGroups);
      window.addEventListener("contextmenu", onHeaderContextMenu, true);
      window.addEventListener("TabSelect", onTabSelect, true);
      for (const event of visibilityEvents) window.addEventListener(event, refreshVisibility);
      const tabRoot = document.getElementById("tabbrowser-tabs");
      if (tabRoot) {
        tabObserver = new MutationObserver(onTabMutations);
        tabObserver.observe(tabRoot, {
          subtree: true, childList: true, attributes: true, attributeOldValue: true,
          attributeFilter: ["selected", "multiselected", "pending", "closing", "pinned", "collapsed"],
        });
      }
      enrollCurrentGroups();
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
    window.removeEventListener("SSWindowStateReady", enrollCurrentGroups);
    window.removeEventListener("contextmenu", onHeaderContextMenu, true);
    window.removeEventListener("TabSelect", onTabSelect, true);
    for (const event of visibilityEvents) window.removeEventListener(event, refreshVisibility);
    tabObserver?.disconnect();
    window.removeEventListener("unload", stop);
    if (browser && browser.addTabGroup === wrapped) {
      browser.addTabGroup = original;
    }
    for (const tab of document.querySelectorAll(`tab[${openMarker}]`)) forget(tab);
    for (const group of document.querySelectorAll(`tab-group[${marker}]`)) {
      const visibility = visibilityMethods.get(group);
      if (visibility?.activeTabsGetter &&
          Object.getOwnPropertyDescriptor(group, "activeTabs")?.get === visibility.activeTabsGetter) {
        delete group.activeTabs;
      }
      if (visibility && group.isTabVisibleInGroup === visibility.replacement) {
        if (visibility.previous) {
          Object.defineProperty(group, "isTabVisibleInGroup", visibility.previous);
        } else {
          delete group.isTabVisibleInGroup;
        }
      }
      visibilityMethods.delete(group);
      const patched = groupAccessors.get(group);
      if (patched && Object.getOwnPropertyDescriptor(group, "tabsAndSplitViews")?.get === patched.get) {
        if (patched.previous) {
          Object.defineProperty(group, "tabsAndSplitViews", patched.previous);
        } else {
          delete group.tabsAndSplitViews;
        }
      }
      groupAccessors.delete(group);
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
