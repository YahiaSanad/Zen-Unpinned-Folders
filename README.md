# Zen Unpinned Folders

A separate Sine companion mod for Arc 2.0. Newly created **regular, unpinned tab groups** keep their selected tabs visible beneath the header when collapsed. Tabs remain members of their group.

**Status: testing release (0.2.1).** JavaScript syntax checks and 23 automated tests pass. Visual acceptance testing in Zen is pending.

Repository: [YahiaSanad/Zen-Unpinned-Folders](https://github.com/YahiaSanad/Zen-Unpinned-Folders).

## Scope

- Existing groups are not enrolled or converted.
- Create a new regular tab group after enabling the mod to try it.
- Group creation, naming, dragging, selection, collapse state and session storage remain native Zen behavior.
- Selected and multiselected tabs stay visible when collapsed. Other tabs hide; expanding shows them again. Selecting elsewhere follows native regular-group visibility.
- Pinned folders, Essentials and standalone split-view groups are not enrolled.
- This does not add nested folders, custom folder icons, unload-all, or the pinned-folder active-tab history feature.

## Why this approach

Installed Zen 1.23.4b already implements selected-tab visibility in `MozTabbrowserTabGroup.isTabVisibleInGroup()`. Its pinned-folder `createFolder()` pins every supplied tab, so copying that method would keep the restriction this mod avoids.

Arc 3.4's `modules/chrome/tab-folders.css` hides every collapsed group's child using zero height, opacity and a transform. Scoped CSS restores selected-tab visibility only on groups marked by this mod.

The script forwards `gBrowser.addTabGroup()` unchanged, then enrolls eligible newly created groups. Calls supplying an existing ID, adoption calls and split-view creation are excluded. A private preference, `zen.mods.unpinned-folders.group-ids`, stores only enrolled group IDs, so those groups retain the behavior after restart. Other groups remain unmarked. Disabling the mod removes its markers and restores its method hook without changing any tabs.

## Rename, color and other group actions

Right-click the **header of a group enrolled by this mod**, including its folder icon or name, to open Zen's native group editor. This works with the group expanded or collapsed.

- Change the name in the text field.
- Choose one of the nine native color swatches. Arc's folder icon and vertical stem use the same native group-color variable. Changing the group color updates both automatically.
- Use native actions such as adding a tab, moving the group to a new window, saving/closing, ungrouping or deleting it. Availability follows Zen's own conditions.
- Click outside the editor to dismiss it. Zen handles name/color changes and session persistence.

Left-click still expands/collapses the group. Right-clicking a tab inside it still opens that tab's menu. Groups created before the mod was enabled and pinned folders retain their existing menus. Groups enrolled by version 0.1.0 also gain this editor shortcut after updating.

For enrolled groups, a compatibility correction handles Zen 1.23.4b's empty `tabsAndSplitViews` lookup: it reads tabs from `.tab-group-container` so native editor commands can find them. A working native lookup is left alone; the correction is removed on unload.

## Install from GitHub with Sine

1. Open Zen Settings, then **Sine Mods**.
2. In the GitHub repository installation field, enter `YahiaSanad/Zen-Unpinned-Folders` and choose **Install**.
3. Ensure Sine permits JavaScript for custom repository mods (`sine.allow-unsafe-js`). CSS alone cannot distinguish newly created groups from existing ones.
4. Keep Arc 2.0 enabled and load this mod after it. Restart Zen.
5. Create a **new regular tab group** and follow the test checklist below. Existing groups intentionally retain their previous behavior.

This is a custom GitHub mod, not a Sine marketplace listing. Sine is required; this is not a WebExtension installed through `about:addons`.

## Manual installation

1. Put this folder in your active profile's `chrome/sine-mods/Zen-Unpinned-Folders` directory.
2. Register `theme.json` as `Zen-Unpinned-Folders` in Sine's `mods.json`, with `origin: "local"`, `enabled: true`, and `no-updates: true`.
3. Load `userChrome.css` after Arc 2.0 in Sine's `chrome.css`.
4. Local scripts require Sine's `sine.allow-unsafe-js` setting. This mod does not change that setting.
5. Restart Zen yourself, then create a **new regular tab group**, not a pinned folder.

Disable through Sine to restore Arc's behavior. If your Sine version does not reload scripts immediately, restart Zen. No existing tabs are moved, pinned, closed or ungrouped by this mod.

## Your browser test

1. Check an existing regular group: it should behave exactly as before.
2. Create a new group with two test tabs. Select one, then collapse the group.
3. Confirm the selected tab remains visible and usable beneath its header; the other tab hides.
4. Expand: both tabs should reappear in their original order.
5. Select a tab outside the collapsed group. Confirm native regular-group visibility applies.
6. Restart: the new group's behavior should persist while older groups remain unchanged.
7. Disable the mod: newly enrolled groups should return to Arc's collapse behavior.
8. Re-enable, right-click an enrolled group header, change its name/color and dismiss the editor. Check the result while expanded and collapsed, then after restart.
9. With Arc's folder background/stem option enabled, choose several group colors. Confirm the vertical stem follows the folder color while existing unrelated groups keep their previous styling.

Automated checks cover enrollment, restoration exclusions, forwarding, persistence and unload cleanup. They do not prove visual rendering in Zen; browser acceptance testing is pending.

## Source references

Inspected installed Zen **1.23.4b**, source revision `541ee55196395ee8082862b83c84c90ab41d9f6d`, plus installed Arc **3.4** and Sine's script loader.

- [Zen folder implementation](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/folders/ZenFolder.mjs)
- [Zen folder manager](https://github.com/zen-browser/desktop/blob/541ee55196395ee8082862b83c84c90ab41d9f6d/src/zen/folders/ZenFolders.mjs)
- [Arc 2.0](https://github.com/YashjitPal/Arc-2.0)
- [Sine](https://github.com/CosmoCreeper/Sine)

Native group source was inspected directly from the installed browser archives: `chrome/browser/content/browser/tabbrowser/tabgroup.mjs` and `moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs`. No Zen source files are copied into this mod.

## Development

Run `npm run check` and `npm test`. No external dependencies.

## Reporting issues

Include Zen, Arc and Sine versions, whether the group was created after enabling this mod, and what happened when collapsing it. A screenshot helps, but remove private tab titles and page content before posting publicly.

## License

[MIT](LICENSE). Zen Browser, Arc 2.0 and Sine remain separate projects under their respective licenses.
