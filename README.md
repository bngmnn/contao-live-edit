# Contao Live Edit

A lightweight visual editing bundle for Contao. It adds a live editor at `/contao-live-edit` (also available at `/editor`) and an in-page toolbar for logged-in Contao administrators. Text and headlines can be edited in place; images can be replaced by upload or selected from the Contao file library; links can be edited from a contextual form; and content elements can be added or rearranged with drag and drop or keyboard-accessible controls.

The element picker reads Contao's registered `TL_CTE` catalog at runtime. This includes built-in content elements and elements registered by installed extensions. New records receive the defaults available in `tl_content`'s DCA. In the frontend, each rendered element gets a move handle and a settings control; settings are generated from that element type's active DCA palette, including palette fields added by extensions. Quick edit keeps common fields up front, uses date-time pickers for scheduling, an eye control for visibility, and image previews for file selections. Less common fields are grouped under Advanced settings; element protection and type selection stay out of the quick-edit flow. Standard selectors, checkboxes, file and page pickers, structured rows, and custom scalar fields use the same editor surface. Headlines, text, links, images, and video embeds have focused editing flows.

Text fields configured with Contao's `rte` option use Contao's bundled HugeRTE editor in the quick-edit panel. The `cssID` DCA value is presented as separate CSS ID and CSS class controls and saved back in Contao's native format.

The in-page toolbar also includes a template editor for custom templates in the project `templates/` directory. It lists Twig (`.html.twig`) and legacy Contao (`.html5`/`.xhtml`) templates, opens the selected source in a large code editor, validates syntax before saving, and keeps a previous version that can be restored from the editor. Saving invalidates Contao's frontend Twig template cache so the updated markup is picked up on the next page load.

## Install from GitHub

Until the package is available through Packagist, add this repository as a Composer VCS source. To install the stable `0.2.0` release:

```sh
composer config repositories.contao-live-edit vcs https://github.com/bngmnn/contao-live-edit
composer require bngmnn/contao-live-edit:0.2.0
vendor/bin/contao-setup
vendor/bin/contao-console assets:install public --symlink
```

For the previous `0.1.x` line, use `composer require bngmnn/contao-live-edit:^0.1`.

Then sign in as a Contao administrator and visit `/contao-live-edit`. The frontend toolbar is injected automatically on pages rendered while that administrator session is active. RockSolid Frontend Helper is not required. The `contao/news-bundle` is optional; when installed, the inline editor also handles news headline, subheadline, and teaser fields.

## Requirements

- PHP 8.2 or later
- Contao Core Bundle 5.3 or 6.x
- Contao Manager Plugin 2.13 or later
- Contao's HugeRTE component (installed as a direct package dependency)

## Notes

- Edit and upload endpoints require an authenticated Contao administrator and a CSRF token.
- Template source editing is limited to existing template files under the project `templates/` directory; paths cannot escape that directory.
- Adding an element lets you choose a visible content element and insert before or after it; drag and drop remains available for pointer users. Settings include keyboard-accessible Move up and Move down actions. Activate editing, double-click text, or focus a text field and press Enter/F2; double-click images and links for their focused editors.
- Unsaved text, link, image, and element-setting changes stay protected when switching editors or clicking outside a form. Use Cancel or Escape to discard them deliberately.
- Template source is syntax-checked before it replaces the saved file. The editor keeps one previous version beside each edited template as `.contao-live-edit.bak`; use Restore previous version to swap between the current and previous source.
- The editor and its API/assets support Contao installations mounted beneath a URL prefix.
- Extension widgets that Contao exposes through a DCA palette are included in the generated settings editor. Highly specialized widgets use a structured fallback editor, and extension-specific callbacks that only run in the back end may still need their native Contao form.
- Composer VCS installation is supported. Once the package is listed on Packagist, the extra VCS repository entry is no longer needed.

## License

LGPL-3.0-or-later. See [LICENSE](LICENSE).
