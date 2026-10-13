<?php

declare(strict_types=1);

namespace ContaoLiveEdit\Hook;

use Contao\BackendUser;
use Contao\System;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;

final class InlineEditorMarkupHook
{
    public static function addRecordAttributes(object $row, string $content, object $element): string
    {
        if (!System::getContainer()->get('contao.security.token_checker')->hasBackendUser()) {
            return $content;
        }

        $user = BackendUser::getInstance();

        if (!$user || !$user->isAdmin || empty($row->id) || !self::isRegisteredElement((string) ($row->type ?? ''))) {
            return $content;
        }

        $recordId = htmlspecialchars((string) $row->id, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $recordType = htmlspecialchars((string) $row->type, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        if (!preg_match('/<[a-z][a-z0-9:-]*(\s[^<>]*?)?>/i', $content)) {
            return '<div class="contao-live-edit-empty-element" data-contao-live-edit-record="'.$recordId.'" data-contao-live-edit-type="'.$recordType.'" aria-label="Empty '.$recordType.' element"><span class="contao-live-edit-empty-element-label">'.$recordType.'</span></div>';
        }
        if (preg_match('/<\s*(iframe|video|audio|embed|object)\b/i', $content)) {
            return '<div class="contao-live-edit-media-element" data-contao-live-edit-record="'.$recordId.'" data-contao-live-edit-type="'.$recordType.'">'.$content.'</div>';
        }
        $inserted = false;

        return preg_replace_callback(
            '/<([a-z][a-z0-9:-]*)(\s[^<>]*?)?>/i',
            static function (array $match) use (&$inserted, $recordId, $recordType): string {
                if ($inserted || in_array(strtolower($match[1]), ['script', 'style'], true)) {
                    return $match[0];
                }

                $inserted = true;

                if (str_contains($match[0], 'data-contao-live-edit-record=')) {
                    return $match[0];
                }

                $attributes = $match[2] ?? '';

                return '<'.$match[1].$attributes.' data-contao-live-edit-record="'.$recordId.'" data-contao-live-edit-type="'.$recordType.'">';
            },
            $content,
        ) ?? $content;
    }

    private static function isRegisteredElement(string $type): bool
    {
        foreach ($GLOBALS['TL_CTE'] ?? [] as $elements) {
            if (is_array($elements) && array_key_exists($type, $elements)) return true;
        }

        return false;
    }

    public static function addFrontendTools(string $buffer, string $templateName = ''): string
    {
        $container = System::getContainer();
        if (!$container->get('contao.security.token_checker')->hasBackendUser() || !BackendUser::getInstance()?->isAdmin) {
            return $buffer;
        }

        $token = $container->get(CsrfTokenManagerInterface::class)->getToken('contao_live_edit')->getValue();
        $theme = ('light' === ($GLOBALS['TL_CONFIG']['contaoLiveEditTheme'] ?? 'dark')) ? 'light' : 'dark';
        $buffer = preg_replace_callback('/<html\b[^>]*>/i', static function (array $match) use ($theme): string {
            $tag = preg_replace('/\sdata-contao-live-edit-theme=("|\')[^"\']*\1/i', '', $match[0]) ?? $match[0];
            return substr($tag, 0, -1).' data-contao-live-edit-theme="'.$theme.'">';
        }, $buffer, 1) ?? $buffer;
        $head = '<meta name="contao-live-edit-inline-token" content="'.htmlspecialchars($token, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'"><link rel="stylesheet" href="/bundles/contaoliveedit/css/inline-edit.css?v=6">';
        if (str_contains($buffer, '</head>')) {
            $buffer = preg_replace('~</head>~i', $head.'</head>', $buffer, 1) ?? $buffer;
        } else {
            $buffer = $head.$buffer;
        }

        $script = '<script src="/assets/hugerte/js/hugerte.min.js" defer></script><script src="/bundles/contaoliveedit/js/inline-edit.js?v=7" defer></script>';
        if (str_contains($buffer, '</body>')) {
            return preg_replace('~</body>~i', $script.'</body>', $buffer, 1) ?? $buffer;
        }

        return $buffer.$script;
    }

}
