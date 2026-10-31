const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../unpinned-folders.uc.js"), "utf8");
const preference = "zen.mods.unpinned-folders.group-ids";
const marker = "zen-unpinned-folder";

function group(id, overrides = {}) {
  const attributes = new Map();
  return {
    id,
    localName: "tab-group",
    isConnected: true,
    pinned: false,
    tabs: [{ pinned: false, hasAttribute: () => false }],
    hasAttribute: name => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    closest: () => null,
    ...overrides,
  };
}

function harness({ groups = [], preferences = new Map(), ready = true } = {}) {
  const events = new Map();
  const observers = new Map();
  const microtasks = [];
  const errors = [];
  const editCalls = [];
  let mutationCallback;
  let disconnected = false;
  let cleanup;
  let next = group("new");
  let call;
  function original(...args) {
    call = { receiver: this, args };
    if (next instanceof Error) throw next;
    if (next) groups.push(next);
    return next;
  }
  const window = {
    gBrowser: {
      addTabGroup: original,
      isTab: item => item.localName === "tab",
      isSplitViewWrapper: item => item.localName === "tab-split-view-wrapper",
      tabGroupMenu: {
        openEditModal(item) { editCalls.push({ menu: this, group: item }); },
      },
    },
    gBrowserInit: { delayedStartupFinished: ready },
    addUnloadListener: callback => { cleanup = callback; },
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(callback);
    },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
  };
  const context = {
    window,
    document: {
      getElementById: () => ({}),
      querySelectorAll: selector => selector.startsWith("tab[")
        ? groups.flatMap(g => g.querySelectorAll?.("tab") ?? g.tabs)
            .filter(t => t.hasAttribute("zen-unpinned-folder-open"))
        : selector.includes("[") ? groups.filter(g => g.hasAttribute(marker)) : groups,
    },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    Services: {
      prefs: {
        getStringPref: (key, fallback) => preferences.get(key) ?? fallback,
        setStringPref: (key, value) => preferences.set(key, value),
      },
      obs: {
        addObserver: (callback, name) => observers.set(name, callback),
        removeObserver: (_, name) => observers.delete(name),
      },
    },
    queueMicrotask: callback => microtasks.push(callback),
    console: { error: (...args) => errors.push(args) },
  };
  vm.runInNewContext(source, context);
  return {
    window, original, preferences, groups, errors, observers, editCalls,
    setNext: value => { next = value; },
    getCall: () => call,
    stop: () => cleanup(),
    emit: (name, target) => {
      for (const callback of events.get(name) ?? []) callback({ target });
    },
    dispatch: (name, event) => {
      for (const callback of events.get(name) ?? []) callback(event);
    },
    flush: () => { while (microtasks.length) microtasks.shift()(); },
    mutate: records => { if (!disconnected) mutationCallback?.(records); },
  };
}

test("loading enrolls existing regular groups without changing their tabs", () => {
  const existing = group("old");
  const h = harness({ groups: [existing] });
  assert.equal(existing.hasAttribute(marker), true);
  assert.deepEqual(JSON.parse(h.preferences.get(preference)), ["old"]);
  assert.equal(existing.tabs.length, 1);
});

const openMarker = "zen-unpinned-folder-open";
function retainedFixture() {
  const tabs = ["one", "two", "three"].map(id => {
    const attrs = new Map();
    return {
      id, localName: "tab", pinned: false, isConnected: true,
      selected: false, multiselected: false,
      hasAttribute: name => attrs.has(name),
      getAttribute: name => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: name => attrs.delete(name),
      closest() { return this.group; },
    };
  });
  const item = group("retained", {
    tabs, collapsed: true, querySelectorAll: () => tabs,
    isTabVisibleInGroup(tab) {
      return !this.isBeingDragged && (!this.collapsed || tab.selected || tab.multiselected);
    },
  });
  tabs.forEach(tab => { tab.group = item; });
  const h = harness();
  const originalVisible = item.isTabVisibleInGroup;
  h.setNext(item);
  h.window.gBrowser.addTabGroup([]);
  return { h, item, tabs, originalVisible };
}

test("collapsed group retains both selected tabs after multiselection clears", () => {
  const { h, item, tabs: [one, two, three] } = retainedFixture();
  one.multiselected = two.multiselected = true;
  h.emit("TabMultiSelect");
  one.multiselected = two.multiselected = false;
  two.selected = true;
  h.dispatch("TabSelect", { target: two, detail: { previousTab: one } });
  h.flush();
  assert.equal(one.hasAttribute(openMarker), true);
  assert.equal(two.hasAttribute(openMarker), true);
  assert.equal(three.hasAttribute(openMarker), false);
  assert.equal(item.isTabVisibleInGroup(one), true);
  assert.equal(nativeTabVisible(one), true);
  assert.equal(item.isTabVisibleInGroup(three), false);
});

test("switching outside retains previous tab and removes stale aria-hidden", () => {
  const { h, item, tabs: [one] } = retainedFixture();
  h.dispatch("TabSelect", { target: {}, detail: { previousTab: one } });
  one.setAttribute("aria-hidden", "true");
  h.flush();
  assert.equal(one.hasAttribute(openMarker), true);
  assert.equal(one.hasAttribute("aria-hidden"), false);
  assert.equal(item.isTabVisibleInGroup(one), true);
  item.isBeingDragged = true;
  assert.equal(item.isTabVisibleInGroup(one), false);
});

test("removed multiselection attributes are captured before they are lost", () => {
  const { h, tabs: [one, two] } = retainedFixture();
  h.mutate([one, two].map(target => ({ type: "attributes", target,
    attributeName: "multiselected", oldValue: "true" })));
  assert.equal(one.hasAttribute(openMarker), true);
  assert.equal(two.hasAttribute(openMarker), true);
});

test("expand clears retained history; collapse starts from current selection", () => {
  const { h, item, tabs: [one, two] } = retainedFixture();
  h.dispatch("TabSelect", { target: one });
  item.collapsed = false;
  h.emit("TabGroupExpand", item);
  assert.equal(one.hasAttribute(openMarker), false);
  two.selected = true;
  item.collapsed = true;
  h.emit("TabGroupCollapse", item);
  assert.equal(one.hasAttribute(openMarker), false);
  assert.equal(two.hasAttribute(openMarker), true);
});

test("unload, close and leaving a group remove remembered visibility", () => {
  for (const flag of ["pending", "closing", "pinned", "moved"]) {
    const { h, tabs: [one] } = retainedFixture();
    h.dispatch("TabSelect", { target: one });
    assert.equal(one.hasAttribute(openMarker), true);
    if (flag === "moved") one.group = null;
    else one.setAttribute(flag, "true");
    h.mutate([{ type: "attributes", target: one, attributeName: flag }]);
    assert.equal(one.hasAttribute(openMarker), false, flag);
  }
});

test("disable restores visibility method, native aria and clears retained markers", () => {
  const { h, item, tabs: [one], originalVisible } = retainedFixture();
  h.dispatch("TabSelect", { target: one });
  h.flush();
  h.stop();
  assert.equal(one.hasAttribute(openMarker), false);
  assert.equal(one.getAttribute("aria-hidden"), "true");
  assert.equal(item.isTabVisibleInGroup, originalVisible);
  assert.equal(Object.hasOwn(item, "activeTabs"), false);
  assert.equal(nativeTabVisible(one), false);
  h.dispatch("TabSelect", { target: one });
  h.flush();
  assert.equal(one.hasAttribute(openMarker), false);
});

test("split-view descendants retain their shared row after switching outside", () => {
  const { h, item, tabs: [one, two, third] } = retainedFixture();
  const splitAttributes = new Map([["aria-hidden", "true"]]);
  const split = {
    tabs: [one, two],
    setAttribute: (name, value) => splitAttributes.set(name, value),
    removeAttribute: name => splitAttributes.delete(name),
  };
  one.splitview = two.splitview = split;
  one.group = two.group = { collapsed: false };
  one.group.group = item;
  one.closest = two.closest = () => item;
  // Zen's group.tabs getter can omit wrapper descendants; DOM scan must not.
  item.tabs = [third];
  one.selected = true;
  h.emit("TabMultiSelect");
  one.selected = false;
  h.dispatch("TabSelect", { target: {}, detail: { previousTab: one } });
  h.flush();
  assert.equal(one.hasAttribute(openMarker), true);
  assert.equal(splitAttributes.has("aria-hidden"), false);
  assert.equal(item.isTabVisibleInGroup(one), true);
  assert.equal(item.isTabVisibleInGroup(two), true);
  assert.equal(nativeTabVisible(one), true);
  assert.equal(nativeTabVisible(two), true);
});

// Installed Zen 1.24b tab.visible's group traversal (after open/hidden guards).
function nativeTabVisible(tab) {
  if (tab.selected || tab.multiselected) return true;
  for (let parent = tab.group; parent; parent = parent.group) {
    if (parent.collapsed && !parent.activeTabs?.includes(tab)) return false;
  }
  return true;
}

test("startup/session restore exclude pinned folders and Essentials", () => {
  const pinned = group("pinned", { pinned: true });
  const folder = group("folder", { localName: "zen-folder", isZenFolder: true });
  const essential = group("essential", { essential: true });
  const regular = group("regular");
  const h = harness({ groups: [pinned, folder, essential, regular] });
  h.emit("SSWindowStateReady");
  for (const excluded of [pinned, folder, essential]) assert.equal(excluded.hasAttribute(marker), false);
  assert.equal(regular.hasAttribute(marker), true);
});

test("Zen native split-group panes remain visible together without splitview wrappers", () => {
  const { h, item, tabs: [one, two] } = retainedFixture();
  const split = {
    group: item, collapsed: false, tabs: [one, two],
    hasAttribute: name => name === "split-view-group",
  };
  one.group = two.group = split;
  one.closest = two.closest = () => item;
  one.splitview = two.splitview = null;
  h.dispatch("TabSelect", { target: one });
  h.dispatch("TabSelect", { target: {}, detail: { previousTab: one } });
  h.flush();
  assert.equal(one.hasAttribute(openMarker), true);
  assert.equal(two.hasAttribute(openMarker), true);
  assert.equal(nativeTabVisible(one), true);
  assert.equal(nativeTabVisible(two), true);
});

test("disable preserves later visibility wrappers without leaving retained behavior", () => {
  const { h, item, tabs: [one] } = retainedFixture();
  h.dispatch("TabSelect", { target: one });
  const wrapped = item.isTabVisibleInGroup;
  const other = function (tab) { return wrapped.call(this, tab); };
  item.isTabVisibleInGroup = other;
  h.stop();
  assert.equal(item.isTabVisibleInGroup, other);
  assert.equal(item.isTabVisibleInGroup(one), false);
});

function headerEvent(item) {
  const header = { parentElement: item };
  return {
    target: { closest: selector => selector === ".tab-group-label-container" ? header : null },
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

test("right-clicking an enrolled header opens native rename/color editor once", () => {
  const h = harness();
  const created = h.window.gBrowser.addTabGroup([]);
  const event = headerEvent(created);
  h.dispatch("contextmenu", event);
  assert.equal(h.editCalls.length, 1);
  assert.equal(h.editCalls[0].group, created);
  assert.equal(h.editCalls[0].menu, h.window.gBrowser.tabGroupMenu);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("unmarked headers, pinned folders and child-tab menus are untouched", () => {
  const h = harness();
  const pinned = group("pinned", { pinned: true });
  pinned.setAttribute(marker, "true");
  const events = [headerEvent(group("old")), headerEvent(pinned), {
    target: { closest: () => null },
    preventDefault() { throw new Error("Child tab menu intercepted"); },
  }];
  for (const event of events) h.dispatch("contextmenu", event);
  assert.equal(h.editCalls.length, 0);
  assert.equal(events[0].defaultPrevented, false);
  assert.equal(events[1].defaultPrevented, false);
});

test("missing or failed native editor leaves default menu available", () => {
  for (const fail of [false, true]) {
    const h = harness();
    const created = h.window.gBrowser.addTabGroup([]);
    h.window.gBrowser.tabGroupMenu.openEditModal = fail
      ? () => { throw new Error("Editor unavailable"); }
      : undefined;
    const event = headerEvent(created);
    h.dispatch("contextmenu", event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
  }
});

test("left-click, cancelled context events and unload do not open editor", () => {
  const h = harness();
  const created = h.window.gBrowser.addTabGroup([]);
  h.dispatch("click", headerEvent(created));
  const cancelled = headerEvent(created);
  cancelled.defaultPrevented = true;
  h.dispatch("contextmenu", cancelled);
  assert.equal(h.editCalls.length, 0);
  h.stop();
  h.dispatch("contextmenu", headerEvent(created));
  assert.equal(h.editCalls.length, 0);
});

test("native item lookup sees nested tabs in order and restores its descriptor on unload", () => {
  const h = harness();
  const first = { localName: "tab", pinned: false, hasAttribute: () => false };
  const second = { ...first };
  const split = { localName: "tab-split-view-wrapper" };
  const created = group("nested", {
    tabs: [first, second],
    groupContainer: { children: [{ localName: "div" }, first, split, second] },
  });
  const originalGet = () => [];
  Object.defineProperty(created, "tabsAndSplitViews", { configurable: true, get: originalGet });
  h.setNext(created);
  h.window.gBrowser.addTabGroup([]);
  assert.deepEqual(Array.from(created.tabsAndSplitViews), [first, split, second]);
  created.groupContainer.children.splice(1, 1);
  assert.deepEqual(Array.from(created.tabsAndSplitViews), [split, second]);
  h.stop();
  assert.equal(Object.getOwnPropertyDescriptor(created, "tabsAndSplitViews").get, originalGet);
});

test("working native lookup and unregistered group lookup remain untouched", () => {
  const existing = group("old", { groupContainer: { children: [] } });
  const h = harness({ groups: [existing] });
  const nativeItems = [{}];
  const created = group("working", { groupContainer: { children: [] } });
  const originalGet = () => nativeItems;
  Object.defineProperty(created, "tabsAndSplitViews", { configurable: true, get: originalGet });
  h.setNext(created);
  h.window.gBrowser.addTabGroup([]);
  assert.equal(Object.getOwnPropertyDescriptor(created, "tabsAndSplitViews").get, originalGet);
  assert.equal(Object.hasOwn(existing, "tabsAndSplitViews"), false);
});

test("a regular group containing only a split wrapper gets the native lookup repair", () => {
  const h = harness();
  const split = { localName: "tab-split-view-wrapper" };
  const created = group("split-only", {
    tabs: [], groupContainer: { children: [split] },
  });
  h.setNext(created);
  h.window.gBrowser.addTabGroup([]);
  assert.equal(created.hasAttribute(marker), true);
  assert.deepEqual(Array.from(created.tabsAndSplitViews), [split]);
});

test("native ungroup iteration can remove nested tabs without closing or reordering them", () => {
  const h = harness();
  const tabs = ["one", "two"].map(id => ({
    id, localName: "tab", pinned: false, hasAttribute: () => false,
  }));
  const created = group("ungroup", { tabs, groupContainer: { children: [...tabs] } });
  const nativePrototype = { get tabsAndSplitViews() { return []; } };
  Object.setPrototypeOf(created, nativePrototype);
  h.setNext(created);
  h.window.gBrowser.addTabGroup([]);
  const outside = [];
  // Native ungroupTabs iterates the getter backwards and inserts after the group.
  for (let i = created.tabsAndSplitViews.length - 1; i >= 0; i--) {
    const tab = created.tabsAndSplitViews[i];
    outside.unshift(tab);
    created.groupContainer.children.splice(created.groupContainer.children.indexOf(tab), 1);
  }
  assert.deepEqual(outside, tabs);
  assert.equal(created.groupContainer.children.length, 0);
  h.stop();
  assert.equal(Object.hasOwn(created, "tabsAndSplitViews"), false);
});

test("new regular groups are enrolled without changing native arguments or return", () => {
  const h = harness();
  const tabs = [{}];
  const options = { label: "Test" };
  const result = h.window.gBrowser.addTabGroup(tabs, options);
  assert.equal(result.hasAttribute(marker), true);
  assert.equal(h.getCall().receiver, h.window.gBrowser);
  assert.equal(h.getCall().args[0], tabs);
  assert.equal(h.getCall().args[1], options);
  assert.deepEqual(options, { label: "Test" });
  assert.deepEqual(JSON.parse(h.preferences.get(preference)), ["new"]);
});

test("creation wrapper defers restored/adopted groups to events and excludes split creation", () => {
  for (const options of [{ id: "old" }, { isAdoptingGroup: true }, { forSplitView: true }]) {
    const h = harness();
    const result = h.window.gBrowser.addTabGroup([], options);
    assert.equal(result.hasAttribute(marker), false);
    assert.equal(h.preferences.size, 0);
  }
});

test("pinned folders, Essentials, split groups and pinned children are excluded", () => {
  for (const overrides of [
    { localName: "zen-folder", isZenFolder: true },
    { pinned: true },
    { essential: true },
    { closest: () => ({ localName: "zen-folder" }) },
    { tabs: [{ pinned: true, hasAttribute: () => false }] },
    { tabs: [{ pinned: false, hasAttribute: name => name === "zen-essential" }] },
  ]) {
    const h = harness();
    const item = group("excluded", overrides);
    h.setNext(item);
    h.window.gBrowser.addTabGroup([]);
    assert.equal(item.hasAttribute(marker), false);
  }
  const h = harness();
  const split = group("split");
  split.setAttribute("split-view-group", "true");
  h.setNext(split);
  h.window.gBrowser.addTabGroup([]);
  assert.equal(split.hasAttribute(marker), false);
});

test("restart enrolls existing regular groups as well as previously enrolled IDs", () => {
  const preferences = new Map([[preference, '["owned"]']]);
  const owned = group("owned");
  const existing = group("old");
  harness({ preferences, groups: [owned, existing] });
  assert.equal(owned.hasAttribute(marker), true);
  assert.equal(existing.hasAttribute(marker), true);
});

test("late session restore enrolls existing regular groups after creation finishes", () => {
  const h = harness({ preferences: new Map([[preference, '["owned"]']]) });
  const owned = group("owned");
  const old = group("old");
  h.groups.push(owned, old);
  h.emit("TabGroupCreate", owned);
  h.emit("TabGroupCreate", old);
  assert.equal(owned.hasAttribute(marker), false);
  h.flush();
  assert.equal(owned.hasAttribute(marker), true);
  assert.equal(old.hasAttribute(marker), true);
});

test("multiple windows merge enrollment without overwriting other IDs", () => {
  const preferences = new Map();
  const first = harness({ preferences });
  const second = harness({ preferences });
  first.setNext(group("one"));
  second.setNext(group("two"));
  first.window.gBrowser.addTabGroup([]);
  second.window.gBrowser.addTabGroup([]);
  assert.deepEqual(JSON.parse(preferences.get(preference)), ["one", "two"]);
});

test("unload restores hook and removes markers without changing tabs", () => {
  const h = harness();
  const created = h.window.gBrowser.addTabGroup([]);
  const tabs = created.tabs;
  h.stop();
  assert.equal(h.window.gBrowser.addTabGroup, h.original);
  assert.equal(created.hasAttribute(marker), false);
  assert.equal(created.tabs, tabs);
  h.emit("SSWindowStateReady");
  h.flush();
  assert.equal(created.hasAttribute(marker), false);
});

test("unload preserves a later mod's wrapper and disables retained hook", () => {
  const h = harness();
  const wrapped = h.window.gBrowser.addTabGroup;
  const other = function (...args) { return wrapped.apply(this, args); };
  h.window.gBrowser.addTabGroup = other;
  h.stop();
  assert.equal(h.window.gBrowser.addTabGroup, other);
  const result = h.window.gBrowser.addTabGroup([]);
  assert.equal(result.hasAttribute(marker), false);
});

test("native errors and null return are preserved", () => {
  const h = harness();
  const error = new Error("Native failure");
  h.setNext(error);
  assert.throws(() => h.window.gBrowser.addTabGroup([]), value => value === error);
  h.setNext(null);
  assert.equal(h.window.gBrowser.addTabGroup([]), null);
});

test("post-native enrollment failure never changes the native return", () => {
  const h = harness();
  const created = group("broken-accessor");
  Object.defineProperty(created, "tabs", {
    get() { throw new Error("Group accessor failure"); },
  });
  h.setNext(created);
  assert.equal(h.window.gBrowser.addTabGroup([]), created);
  assert.equal(h.errors.length, 1);
  assert.equal(created.hasAttribute(marker), false);
});

test("removed groups can be restored without losing enrollment", () => {
  const h = harness();
  const created = h.window.gBrowser.addTabGroup([]);
  created.isConnected = false;
  h.groups.splice(h.groups.indexOf(created), 1);
  const restored = group(created.id);
  h.groups.push(restored);
  h.emit("TabGroupCreate", restored);
  h.flush();
  assert.equal(restored.hasAttribute(marker), true);
  h.stop();
  assert.equal(restored.hasAttribute(marker), false);
});

test("malformed stored IDs fail closed without hooking native methods", () => {
  for (const value of ["broken", "{}", "[1]"]) {
    const h = harness({ preferences: new Map([[preference, value]]) });
    assert.equal(h.window.gBrowser.addTabGroup, h.original);
    assert.equal(h.errors.length, 1);
  }
});

test("waiting for browser startup can be cancelled safely", () => {
  const h = harness({ ready: false });
  assert.equal(h.window.gBrowser.addTabGroup, h.original);
  assert.equal(h.observers.size, 1);
  h.stop();
  assert.equal(h.observers.size, 0);
});

test("startup waits for this window, then installs exactly once", () => {
  const h = harness({ ready: false });
  const callback = h.observers.get("browser-delayed-startup-finished");
  callback({});
  assert.equal(h.window.gBrowser.addTabGroup, h.original);
  callback(h.window);
  assert.notEqual(h.window.gBrowser.addTabGroup, h.original);
  assert.equal(h.observers.size, 0);
});
