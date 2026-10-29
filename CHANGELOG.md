# Changelog

## 0.2.0 — 2026-10-29

- Right-click any enrolled group header to open Zen's native editor for names, colors and group actions.
- Keep existing-group menus, child-tab menus and left-click collapse behavior unchanged.
- Remove the context-menu listener on unload and retain the default menu when the native editor is unavailable.
- Correct the empty native group-item lookup for enrolled groups in Zen 1.23.4b, so editor commands can find their nested tabs.
- Add menu-routing and group-item regression tests (23 tests total).

Browser visual acceptance remains pending.

## 0.1.0 — 2026-10-29

- Add scoped Arc collapse overrides for newly created unpinned groups.
- Keep selected and multiselected tabs visible without removing their group membership.
- Preserve eligibility across restarts using a preference containing group IDs only.
- Exclude existing groups, restored unregistered groups, pinned folders, Essentials and standalone split views.
- Restore the native method hook and remove markers on unload.
- Add 15 automated tests and installation, removal and manual testing instructions.

Browser visual acceptance remains pending; this is an initial testing release.
