<?php

declare(strict_types=1);

// Add the appearance option to Contao's System > Settings page.
$GLOBALS['TL_DCA']['tl_settings']['palettes']['default'] = ($GLOBALS['TL_DCA']['tl_settings']['palettes']['default'] ?? '')
    . ';{contao_live_edit_legend:hide},contaoLiveEditTheme';

$GLOBALS['TL_DCA']['tl_settings']['fields']['contaoLiveEditTheme'] = [
    'inputType' => 'select',
    'options' => ['light', 'dark'],
    'reference' => &$GLOBALS['TL_LANG']['tl_settings']['contaoLiveEditThemeOptions'],
    'default' => 'dark',
    'eval' => ['tl_class' => 'w50', 'includeBlankOption' => false],
    'save_callback' => [static function ($value) {
        return in_array($value, ['light', 'dark'], true) ? $value : 'light';
    }],
];
