# Contao Live Edit

A lightweight visual editing bundle for Contao. It adds a live editor at `/contao-live-edit` (also available at `/editor`) and an in-page toolbar for logged-in Contao administrators. Text and headlines can be edited in place; images can be replaced by upload or selected from the Contao file library; links can be edited from a contextual form; and content elements can be rearranged or added by drag and drop.

The element picker reads Contao's registered `TL_CTE` catalog at runtime. This includes built-in content elements and elements registered by installed extensions. New records receive the defaults available in `tl_content`'s DCA. In the frontend, each rendered element gets a move handle and a settings control; settings are generated from that element type's active DCA palette, including palette fields added by extensions. Quick edit keeps common fields up front, uses date-time pickers for scheduling, an eye control for visibility, and image previews for file selections. Less common fields are grouped under Advanced settings; element protection and type selection stay out of the quick-edit flow. Standard selectors, checkboxes, file and page pickers, structured rows, and custom scalar fields use the same editor surface. Headlines, text, links, images, and video embeds have focused editing flows.

Text fields configured with Contao's `rte` option use Contao's bundled HugeRTE editor in the quick-edit panel. The `cssID` DCA value is presented as separate CSS ID and CSS class controls and saved back in Contao's native format.

## Install from GitHub

Add this repository as a Composer VCS source, then require the development branch:

```sh
composer config repositories.contao-live-edit vcs https://github.com/bngmnn/contao-live-edit
composer require bngmnn/contao-live-edit:dev-main
vendor/bin/contao-setup
vendor/bin/contao-console assets:install public --symlink
```

Then sign in as a Contao administrator and visit `/contao-live-edit`. The frontend toolbar is injected automatically on pages rendered while that administrator session is active. RockSolid Frontend Helper is not required. The `contao/news-bundle` is optional; when installed, the inline editor also handles news headline, subheadline, and teaser fields.

## Requirements

- PHP 8.2 or later
- Contao Core Bundle 5.3 or 6.x
- Contao Manager Plugin 2.13 or later

## Notes

- Edit and upload endpoints require an authenticated Contao administrator and a CSRF token.
- Dragging a new element creates its Contao record with DCA defaults. Double-click text to edit it directly; use the element settings control for the full palette, advanced options, and removal.
- Extension widgets that Contao exposes through a DCA palette are included in the generated settings editor. Highly specialized widgets use a structured fallback editor, and extension-specific callbacks that only run in the back end may still need their native Contao form.
- The bundle has not yet been submitted to the Contao Manager catalog. Composer VCS installation is supported.

## License

LGPL-3.0-or-later. See [LICENSE](LICENSE).
