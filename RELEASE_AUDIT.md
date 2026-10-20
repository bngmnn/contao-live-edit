# Contao Live Edit — stable 0.3.2 release update

Date: 2026-10-20

## Release summary

The `v0.3.2` patch release fixes inline editing for headings rendered inside a text element's rich-text body. Those headings now edit the saved text body instead of loading the separate headline field, which could be empty and make the clicked text disappear. It also removes the duplicate edit start previously triggered by both pointer and click events and advances the frontend script cache key.

The release does not claim authenticated installation acceptance across Contao 5.3 and 6.

# Contao Live Edit — stable 0.3.1 release update

Date: 2026-10-20

## Release summary

The `v0.3.1` patch release adds article-level editing controls and metadata, exposes hidden Contao elements in the editor, and improves inline source editing and save/reload behavior. It also refines the live-edit bar and context menu and advances editor asset cache keys. Package metadata now declares the project homepage.

The release does not claim authenticated installation acceptance across Contao 5.3 and 6.

# Contao Live Edit — stable 0.2.1 release update

Date: 2026-10-15

## Release summary

The `v0.2.1` patch release fixes inline editing of Contao text elements. Editing a text body now targets the rendered `.rte` body rather than the enclosing element, so the separately rendered headline is not copied into the saved rich text. The save path also handles the rich text element itself as the edit root.

The frontend script cache key was advanced so installations load the corrected editor after updating the bundle. A Contao Manager upload ZIP is provided with the required `version` property in its embedded `composer.json`.

The real authenticated install acceptance gates documented in the 0.2.0 audit remain outstanding; this release does not claim those checks were completed.

# Contao Live Edit — stable 0.2.0 release audit update

Date: 2026-10-15

## Stable release summary

The stable `v0.2.0` release includes the earlier RC work plus the Apple Design audit follow-ups below. The live authenticated install acceptance gates listed in the original RC audit remain outstanding; the release artifacts and source checks do not claim those checks were completed.

- Modal editors now keep keyboard focus within the dialog, return focus to the opener when closed, and close on Escape (including the template editor).
- Editor styles honor `prefers-reduced-motion` and `prefers-reduced-transparency`.
- Reordering already has touch-accessible Move up/Move down actions in the settings panel; drag and drop remains an additional pointer path.
- Editor asset cache keys were advanced for the changed assets. README install instructions now point to stable `0.2.0`.

**Release limitation:** install and authenticated editing acceptance on Contao 5.3 and 6, and manual device checks, remain unverified as described below.

# Contao Live Edit — first release QA audit

Date: 2026-10-15

## Verdict

**The `v0.2.0-rc1` candidate is published; hold a stable release.** The RC contains fixes for the main data-loss, News, Contao 5.3 editor dependency, keyboard insertion/reordering, and URL-prefix findings. A real install against Contao with an authenticated admin session is still needed before calling the bundle stable.

Commit `7ed0172` is tagged `v0.2.0-rc1` and published as a GitHub prerelease with a ZIP and SHA-256 file. The existing `v0.1.0` tag and ZIP remain unchanged.

## Scope and evidence

I reviewed the bundle at tag `v0.1.0` (commit `4300695`), the RC source, Composer metadata, routes, frontend assets, and both ZIPs in `dist/`. The old ZIP still matches the old tag; the RC ZIP was built from `v0.2.0-rc1` and validated. The parent Contao application has Contao Core 6 installed but does not have this bundle installed, so it cannot exercise the bundle's real services, routing, backend session, or database writes.

I used a temporary browser fixture served below `/cms/`. Its preview contained Contao-like content and News markup, and its mock API logged requests without writing to a Contao database. This verifies browser behavior and URL construction, but it is not a package-install acceptance test. I also checked the installed News bundle's `parseArticles` hook invocation and default Twig templates directly.

The bundle has no automated test suite. PHP, JavaScript, Composer, source-validation, sanitization, and browser checks are listed below.

## Findings addressed in the source working tree

### P1 — Rich text was flattened on save

The tagged v0.1.0 frontend sent plain text and its controller stored that as paragraphs, removing links, emphasis, lists, and other formatting. The current source submits rich HTML for text and teaser fields, sanitizes it server-side, and returns the sanitized result to the editor. Headline and caption values remain text.

**Verified:** the browser fixture sent `<p>Keyboard edited paragraph</p>` for a content text field and sent `<p>Fixture <strong>news teaser</strong>.</p>` for a News teaser. A direct sanitizer check retained a relative link and `<strong>` formatting while removing a `<script>` element.

**Release status:** fixed in `v0.2.0-rc1`; still broken in `v0.1.0`.

### P1 — News fields were not connected to rendered News records

The source now registers the News `parseArticles` hook, marks rendered article templates with their `tl_news` ID, exposes headline/subheadline/teaser fields, and sends `recordType: news`. The save controller branches on the record type before looking up a content element, avoiding collisions between independent table IDs.

**Verified:** Contao News calls the hook with the template, article row, and module. The browser fixture edited and saved a News headline and rich teaser with `id: 31` and `recordType: news`. The installed default `news_latest`, `news_short`, and `news_full` templates match the selectors used by the field marker.

**Limit:** the controller save was not exercised against an authenticated Contao database.

### P1 — Contao 5.3 did not provide the HugeRTE asset

`contao-components/hugerte` is now a direct package dependency. Composer dry runs resolve HugeRTE 1.0.14 with Contao Core 5.3.52 and 6.0.4.

**Limit:** the component was not installed into a running Contao site and its asset URL was not tested through Contao's asset installation command.

### P1 — Core authoring flows depended on drag and double-click

The element picker now has a click path that lets users choose an element and select an existing content element plus before/after placement. Inline text fields can be focused and started with Enter or F2. Element settings include keyboard Move up/Move down actions; drag and drop remains available. The picker copy now describes both ways to add an element, and the inline toolbar explains how to discover settings and move controls.

**Verified:** in the browser fixture, selecting Text exposed the placement controls and added the element. Pressing Enter started inline editing. Move up posted the expected reorder payload. Settings and move buttons appeared in the accessibility tree.

**Limit:** no physical touch device or mobile viewport was available in the browser-control session. The stylesheet exposes controls under `hover: none`, but touch acceptance remains outstanding.

### P2 — Unsaved inline text could be silently discarded

The source confirms before discarding dirty text when switching fields, opening another editor, or turning editing off; Escape and Cancel explicitly discard. A `beforeunload` guard now covers a dirty inline field and an open dirty template editor. After a successful save, the field closes immediately and its saved markup becomes the new baseline, avoiding a false discard prompt during the old 700 ms cleanup window.

**Verified:** after saving one field, the browser fixture could immediately start keyboard editing in another. The discard confirmation path is present in the source.

**Limit:** a reload attempt with a dirty mock field stalled in the browser automation; its dialog API did not expose the native confirmation, so the before-unload prompt needs a manual check in a regular browser.

### P2 — Quick-edit forms silently closed on outside click

Link, image, and element-settings forms now track input, file-selection, and visibility changes. Clicking outside a dirty form or switching to another editor asks before discarding. Cancel and Escape remain explicit discard actions, and in-flight saves cannot be closed accidentally. Dirty form state also participates in the page-unload warning.

**Verified:** in the browser fixture, I changed a settings field and clicked outside. The form and changed value remained open; Cancel then closed it deliberately. With a delayed mock save, all settings controls stayed disabled until the request returned. Invalid structured JSON showed an error and left the form editable. Keyboard reordering still closed the form and posted the expected request.

### P2 — Template editing needed validation and recovery

Template saves now compile Twig source or parse legacy PHP template source before replacing the file. Saves keep a sidecar previous version; a restore endpoint swaps the current and previous versions and invalidates the frontend Twig cache.

**Verified:** direct controller validation checks accepted valid Twig and legacy PHP and rejected malformed Twig/PHP. The existing template path resolver restricts access to files under the project `templates/` folder.

**Limit:** authenticated save/restore requests and on-disk recovery were not exercised in a running Contao application.

### P2 — Root-absolute URLs failed under a path prefix

Editor assets, preview URLs, frontend assets, API calls, image URLs, and HugeRTE paths now include the request base path. Cache-busting query values were advanced for the changed editor assets.

**Verified:** the browser fixture ran under `/cms/`, and the mock API logged the request as `/cms/contao-live-edit/insert-content`.

## Remaining release gates

1. **Run package-install acceptance on Contao 5.3 and 6.** Sign in as an administrator and exercise content save, News save with colliding content/News IDs, HugeRTE editing, element insertion/reordering, template save/restore, and a site mounted under a path prefix.
2. **Finish real-device interaction checks.** Verify touch controls and narrow-screen layout, then verify the dirty-page reload warning manually.

## Checks run

- `php -l` passed for all 11 PHP files under `src/` and `Resources/contao/`.
- `node --check` passed for `inline-edit.js` and `editor.js`.
- `composer validate --no-check-publish` passed.
- Composer dry runs resolved Contao Core 5.3.52 and 6.0.4 with HugeRTE 1.0.14.
- The published `0.2.0-rc1@RC` constraint resolves from GitHub with Contao Core 6.0.4; a local VCS resolution also succeeds for Contao 5.x.
- The RC ZIP passed `unzip -t` and Composer metadata validation. Its SHA-256 is `a93fbc9ca2a8e75c5b09a0da633775ad4d9baef0147ca5a7a9a60f56e9078b1e`.
- Direct Twig/PHP source validation accepted valid sources and rejected invalid sources.
- Rich-text sanitizer check retained safe markup and removed a script element.
- Browser fixture checked click-to-add, keyboard text editing, News headline/teaser request payloads, keyboard reordering, post-save field switching, outside-click protection for a changed settings form, control locking during a delayed save, malformed structured-field recovery, and `/cms` request-prefix handling.
