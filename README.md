# Zen Unpinned Folders

A separate Sine companion mod for Arc 2.0. Existing and new **regular, unpinned tab groups** keep selected and remembered tabs visible beneath the header when collapsed. Tabs remain members of their group.

**Status: testing release (0.3.0).** JavaScript syntax checks and 33 automated tests pass. Visual acceptance testing in Zen is pending.

Repository: [YahiaSanad/Zen-Unpinned-Folders](https://github.com/YahiaSanad/Zen-Unpinned-Folders).

## Scope

- Existing regular groups are enrolled on startup and session restore; no tabs are moved or converted.
- Existing groups gain the new behavior after restarting Zen with this update.
- Group creation, naming, dragging, selection, collapse state and session storage remain native Zen behavior.
- While a group is collapsed, selected and multiselected tabs are remembered. Clicking one of two selected tabs keeps both visible; switching outside the group keeps the previously opened tab visible. Other tabs stay collapsed.
- Pinned folders, Essentials and standalone split-view groups are not enrolled.
- Expanding a group resets its remembered tabs. Unloading, closing, pinning or moving a remembered tab out of its group clears its retained visibility. This history lasts for the current browser session; it is not saved across restarts.
- This does not add nested folders, custom folder icons or a folder unload-all button.

## Why this approach

Installed Zen 1.23.4b already implements selected-tab visibility in `MozTabbrowserTabGroup.isTabVisibleInGroup()`. Its pinned-folder `createFolder()` pins every supplied tab, so copying that method would keep the restriction this mod avoids.

Arc 3.4's `modules/chrome/tab-folders.css` hides every collapsed group's child using zero height, opacity and a transform. Scoped CSS restores selected and remembered tab visibility only on groups marked by this mod. Per-group visibility integration exposes remembered tabs through Zen 1.24b's `activeTabs` lookup and the older group visibility method. Native visibility caches are invalidated when retention changes, and visible rows have their accessibility state corrected.

The script forwards `gBrowser.addTabGroup()` unchanged, then enrolls eligible newly created groups. Startup and session-restore scans also enroll existing regular groups, as requested for version 0.3.0. The creation event waits until tabs and pinned state are assigned. A private preference, `zen.mods.unpinned-folders.group-ids`, stores enrolled group IDs only. Disabling the mod clears its transient markers, disconnects its observer, and restores its method overrides without moving or closing tabs.

## Rename, color and other group actions

Right-click the **header of a group enrolled by this mod**, including its folder icon or name, to open Zen's native group editor. This works with the group expanded or collapsed.

- Change the name in the text field.
- Choose one of the nine native color swatches. Arc's folder icon and vertical stem use the same native group-color variable. Changing the group color updates both automatically.
- Use native actions such as adding a tab, moving the group to a new window, saving/closing, ungrouping or deleting it. Availability follows Zen's own conditions.
- Click outside the editor to dismiss it. Zen handles name/color changes and session persistence.

Left-click still expands/collapses the group. Right-clicking a tab inside it still opens that tab's menu. Existing regular groups also gain this editor; pinned folders retain their existing menus. Groups enrolled by version 0.1.0 also gain this editor shortcut after updating.

For enrolled groups, a compatibility correction handles Zen 1.23.4b's empty `tabsAndSplitViews` lookup: it reads tabs from `.tab-group-container` so native editor commands can find them. A working native lookup is left alone; the correction is removed on unload.

## Install from GitHub with Sine

1. Open Zen Settings, then **Sine Mods**.
2. In the GitHub repository installation field, enter `YahiaSanad/Zen-Unpinned-Folders` and choose **Install**.
3. Ensure Sine permits JavaScript for custom repository mods (`sine.allow-unsafe-js`). CSS alone cannot distinguish newly created groups from existing ones.
4. Keep Arc 2.0 enabled and load this mod after it. Restart Zen.
5. Use an existing or new regular tab group and follow the test checklist below.

This is a custom GitHub mod, not a Sine marketplace listing. Sine is required; this is not a WebExtension installed through `about:addons`.

## Manual installation

1. Put this folder in your active profile's `chrome/sine-mods/Zen-Unpinned-Folders` directory.
2. Register `theme.json` as `Zen-Unpinned-Folders` in Sine's `mods.json`, with `origin: "local"`, `enabled: true`, and `no-updates: true`.
3. Load `userChrome.css` after Arc 2.0 in Sine's `chrome.css`.
4. Local scripts require Sine's `sine.allow-unsafe-js` setting. This mod does not change that setting.
5. Restart Zen yourself, then use an existing or new **regular tab group**, not a pinned folder.

Disable through Sine to restore Arc's behavior. If your Sine version does not reload scripts immediately, restart Zen. No existing tabs are moved, pinned, closed or ungrouped by this mod.

## Your browser test

1. Use an existing regular group with three disposable tabs; confirm its name, color, membership and order stay unchanged.
2. Select two tabs together, then collapse the group. Click one of them: both should remain visible and the third should stay hidden.
3. Switch to a tab outside the collapsed group. Both remembered tabs should remain visible and clickable.
4. Expand the group to reset history. Select one tab, collapse again, then switch outside: that tab should remain visible.
5. Unload or close a remembered tab. It should disappear from the collapsed rows. Moving it out or pinning it should remove the retained state.
6. Repeat with a split view inside a regular group; its visible panes should stay together.
7. Check pinned folders, Essentials, workspace buttons, and another mod: no intentional changes.
8. Right-click a regular group header and check rename/color editing, including the matching stem color.
9. Disable the mod: its visibility overrides should be removed. Re-enable/restart to restore the feature. Remembered-tab history is session-only.

Automated checks cover enrollment, selection history, native visibility queries, cleanup, forwarding, editing and restoration. They do not prove rendering or real event delivery in Zen; live browser acceptance remains pending user testing.

## Source references

The original implementation inspected Zen **1.23.4b**, source revision `541ee55196395ee8082862b83c84c90ab41d9f6d`, plus installed Arc **3.4** and Sine's script loader.

- [Zen folder implementation](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/folders/ZenFolder.mjs)
- [Zen folder manager](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/folders/ZenFolders.mjs)
- [Arc 2.0](https://github.com/YashjitPal/Arc-2.0)
- [Sine](https://github.com/CosmoCreeper/Sine)

Version 0.3.0 also inspects installed Zen **1.24b**, revision `f75390aa2b797ddc3524ff9ed52ceb32a839f9fa`: `ZenFolder.activeTabs` retains `folder-active` state, while ordinary groups only expose selected/multiselected tabs. This mod uses its own transient attribute rather than altering pinned-folder state.

Native group source was inspected directly from the installed browser archives: `chrome/browser/content/browser/tabbrowser/tabgroup.mjs` and `moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs`. No Zen source files are copied into this mod.

## Development

Run `npm run check` and `npm test`. No external dependencies.

## Reporting issues

Include Zen, Arc and Sine versions, whether the group was created after enabling this mod, and what happened when collapsing it. A screenshot helps, but remove private tab titles and page content before posting publicly.

## License

[MIT](LICENSE). Zen Browser, Arc 2.0 and Sine remain separate projects under their respective licenses.
