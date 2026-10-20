<?php

declare(strict_types=1);

namespace ContaoLiveEdit\Hook;

use Contao\BackendUser;
use Contao\ModuleModel;
use Contao\StringUtil;
use Contao\System;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;

final class InlineEditorMarkupHook
{
    public static function markArticle(object $article): void
    {
        if (!System::getContainer()->get('contao.security.token_checker')->hasBackendUser() || !BackendUser::getInstance()?->isAdmin || empty($article->id)) {
            return;
        }

        $cssId = StringUtil::deserialize($article->cssID ?? '', true);
        $classes = preg_split('/\\s+/', trim((string) ($cssId[1] ?? '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $classes[] = 'contao-live-edit-article';
        $classes[] = 'contao-live-edit-article-'.(int) $article->id;
        $cssId[1] = implode(' ', array_unique($classes));
        $article->cssID = serialize($cssId);
    }

    public static function markNewsArticle(object $template, array $row, object $module): void
    {
        if (!System::getContainer()->get('contao.security.token_checker')->hasBackendUser() || !BackendUser::getInstance()?->isAdmin) {
            return;
        }

        $id = filter_var($row['id'] ?? null, FILTER_VALIDATE_INT);

        if (!$id) {
            return;
        }

        $classes = preg_split('/\\s+/', trim((string) ($template->class ?? '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $classes[] = 'contao-live-edit-news';
        $classes[] = 'contao-live-edit-news-'.$id;
        $template->class = implode(' ', array_unique($classes));
    }

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
        $parentId = htmlspecialchars((string) ($row->pid ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $parentTable = htmlspecialchars((string) ($row->ptable ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $sorting = htmlspecialchars((string) ($row->sorting ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $invisible = !empty($row->invisible) ? 'true' : 'false';
        if ('module' === (string) ($row->type ?? '') && !empty($row->module)) {
            $module = ModuleModel::findByPk((int) $row->module);
            $template = trim((string) ($module?->customTpl ?? ''));
            if ('' === $template && $module && trim((string) $module->type)) {
                $template = 'mod_'.trim((string) $module->type);
            }
        } else {
            $template = '';
        }
        $template = $template ?: trim((string) ($row->customTpl ?? '')) ?: 'ce_'.$recordType;
        $template = htmlspecialchars($template, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $recordAttributes = 'data-contao-live-edit-record="'.$recordId.'" data-contao-live-edit-type="'.$recordType.'" data-contao-live-edit-parent-id="'.$parentId.'" data-contao-live-edit-parent-table="'.$parentTable.'" data-contao-live-edit-sorting="'.$sorting.'" data-contao-live-edit-invisible="'.$invisible.'" data-contao-live-edit-template="'.$template.'"';
        if (!preg_match('/<[a-z][a-z0-9:-]*(\s[^<>]*?)?>/i', $content)) {
            return '<div class="contao-live-edit-empty-element" '.$recordAttributes.' aria-label="Empty '.$recordType.' element"><span class="contao-live-edit-empty-element-label">'.$recordType.'</span></div>';
        }
        if (preg_match('/<\s*(iframe|video|audio|embed|object)\b/i', $content)) {
            return '<div class="contao-live-edit-media-element" '.$recordAttributes.'>'.$content.'</div>';
        }
        $inserted = false;

        return preg_replace_callback(
            '/<([a-z][a-z0-9:-]*)(\s[^<>]*?)?>/i',
            static function (array $match) use (&$inserted, $recordAttributes): string {
                if ($inserted || in_array(strtolower($match[1]), ['script', 'style'], true)) {
                    return $match[0];
                }

                $inserted = true;

                if (str_contains($match[0], 'data-contao-live-edit-record=')) {
                    return $match[0];
                }

                $attributes = $match[2] ?? '';

                return '<'.$match[1].$attributes.' '.$recordAttributes.'>';
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
        // The response listener is a safety net for frontend routes that do not
        // pass through Contao's outputFrontendTemplate hook. Avoid adding the UI twice.
        if (str_contains($buffer, 'name="contao-live-edit-inline-token"')) {
            return $buffer;
        }

        $container = System::getContainer();
        if (!$container->get('contao.security.token_checker')->hasBackendUser() || !BackendUser::getInstance()?->isAdmin) {
            return $buffer;
        }

        $token = $container->get(CsrfTokenManagerInterface::class)->getToken('contao_live_edit')->getValue();
        $theme = ('light' === ($GLOBALS['TL_CONFIG']['contaoLiveEditTheme'] ?? 'dark')) ? 'light' : 'dark';
        $basePath = rtrim($container->get('request_stack')->getCurrentRequest()?->getBasePath() ?? '', '/');
        $escapedBasePath = htmlspecialchars($basePath, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $pageTemplate = htmlspecialchars(trim($templateName), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $currentPage = $container->get('contao.routing.page_finder')->getCurrentPage();
        $pageId = (int) ($currentPage?->id ?? 0);
        $pageName = htmlspecialchars(trim((string) ($currentPage?->title ?? '')), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $router = $container->get('router');
        $pageSettingsUrl = $pageId > 0 ? $router->generate('contao_backend', ['do' => 'page', 'table' => 'tl_page', 'act' => 'edit', 'id' => $pageId]) : '';
        $moduleSettingsUrl = $router->generate('contao_backend', ['do' => 'themes', 'table' => 'tl_module']);
        $imageSizesUrl = $router->generate('contao_backend', ['do' => 'themes', 'table' => 'tl_image_size']);
        $layoutsUrl = $router->generate('contao_backend', ['do' => 'themes', 'table' => 'tl_layout']);
        $buffer = preg_replace_callback('/<html\b[^>]*>/i', static function (array $match) use ($theme, $pageTemplate): string {
            $tag = preg_replace('/\sdata-contao-live-edit-theme=("|\')[^"\']*\1/i', '', $match[0]) ?? $match[0];
            return substr($tag, 0, -1).' data-contao-live-edit-theme="'.$theme.'" data-contao-live-edit-page-template="'.$pageTemplate.'">';
        }, $buffer, 1) ?? $buffer;
        $buffer = preg_replace_callback('/<[a-z][a-z0-9:-]*\\b[^>]*>/i', static function (array $match) use ($container): string {
            $articleId = null;
            if (preg_match('/\\bclass=("|\')(.*?)\\1/i', $match[0], $classMatch)
                && preg_match('/(?:^|\\s)contao-live-edit-article-(\\d+)(?:\\s|$)/', $classMatch[2], $idMatch)) {
                $articleId = (int) $idMatch[1];
            } elseif (preg_match('/\\bdata-contao-live-edit-parent-table=("|\')tl_article\\1/i', $match[0])
                && preg_match('/\\bdata-contao-live-edit-parent-id=("|\')(\\d+)\\1/i', $match[0], $idMatch)) {
                $articleId = (int) $idMatch[2];
            }

            if (!$articleId) {
                return $match[0];
            }

            $url = $container->get('router')->generate('contao_backend', ['do' => 'article', 'table' => 'tl_article', 'id' => $articleId]);
            $tag = preg_replace('/\\sdata-contao-live-edit-article-url=("|\').*?\\1/i', '', $match[0]) ?? $match[0];

            return substr($tag, 0, -1).' data-contao-live-edit-article-url="'.htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'">';
        }, $buffer) ?? $buffer;
        $head = '<meta name="contao-live-edit-inline-token" content="'.htmlspecialchars($token, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'">'
            .'<meta name="contao-live-edit-base-path" content="'.$escapedBasePath.'">'
            .'<meta name="contao-live-edit-page-id" content="'.$pageId.'">'
            .'<meta name="contao-live-edit-page-name" content="'.$pageName.'">'
            .'<meta name="contao-live-edit-page-settings-url" content="'.htmlspecialchars($pageSettingsUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'">'
            .'<meta name="contao-live-edit-modules-url" content="'.htmlspecialchars($moduleSettingsUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'">'
            .'<meta name="contao-live-edit-image-sizes-url" content="'.htmlspecialchars($imageSizesUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'">'
            .'<meta name="contao-live-edit-layouts-url" content="'.htmlspecialchars($layoutsUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'">'
            .'<link rel="stylesheet" href="'.$escapedBasePath.'/bundles/contaoliveedit/css/inline-edit.css?v=55">';
        if (str_contains($buffer, '</head>')) {
            $buffer = preg_replace('~</head>~i', $head.'</head>', $buffer, 1) ?? $buffer;
        } else {
            $buffer = $head.$buffer;
        }

        $script = '<script src="'.$escapedBasePath.'/assets/hugerte/js/hugerte.min.js" defer></script>'
            .'<script src="'.$escapedBasePath.'/bundles/contaoliveedit/js/inline-edit.js?v=60" defer></script>';
        if (str_contains($buffer, '</body>')) {
            return preg_replace('~</body>~i', $script.'</body>', $buffer, 1) ?? $buffer;
        }

        return $buffer.$script;
    }

}
