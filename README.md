# Contao Live Edit

A lightweight visual editing bundle for Contao. It adds a live editor at `/contao-live-edit` and an in-page toolbar for logged-in Contao administrators. Text and headlines can be edited in place; images can be replaced by upload or selected from the Contao file library; links can be edited from a contextual form; and content elements can be rearranged or added by drag and drop.

The element picker reads Contao's registered `TL_CTE` catalog at runtime. This includes built-in content elements and elements registered by installed extensions. New records receive the defaults available in `tl_content`'s DCA; extension-specific required settings can then be completed in the Contao back end.

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
- Dragging a new element creates its Contao record with DCA defaults. Custom elements with additional mandatory extension settings may need completion in the back end before they render correctly.
- The bundle has not yet been submitted to the Contao Manager catalog. Composer VCS installation is supported.

## License

LGPL-3.0-or-later. See [LICENSE](LICENSE).
