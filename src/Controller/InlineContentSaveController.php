<?php

declare(strict_types=1);

namespace ContaoLiveEdit\Controller;

use Contao\ContentModel;
use Contao\BackendUser;
use Contao\CoreBundle\Framework\ContaoFramework;
use Contao\CoreBundle\Security\Authentication\Token\TokenChecker;
use Contao\Dbafs;
use Contao\File;
use Contao\FilesModel;
use Contao\NewsModel;
use Contao\System;
use Contao\StringUtil;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Security\Csrf\CsrfToken;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Symfony\Contracts\Translation\TranslatorInterface;

final class InlineContentSaveController
{
    public function __construct(
        private CsrfTokenManagerInterface $csrfTokenManager,
        private ContaoFramework $framework,
        private TokenChecker $tokenChecker,
        private TranslatorInterface $translator,
    ) {
    }

    public function __invoke(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        try {
            $payload = $request->toArray();
        } catch (\Throwable) {
            return new JsonResponse(['error' => 'Invalid request body.'], 400);
        }

        $token = (string) ($payload['_token'] ?? '');

        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', $token))) {
            return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        }

        $id = filter_var($payload['id'] ?? null, FILTER_VALIDATE_INT);
        $field = (string) ($payload['field'] ?? '');
        $value = trim((string) ($payload['value'] ?? ''));

        if (!$id || !in_array($field, ['headline', 'text', 'subheadline', 'teaser'], true) || '' === $value || mb_strlen($value) > 4000) {
            return new JsonResponse(['error' => 'The text is empty or too long.'], 422);
        }
        if ('headline' === $field && mb_strlen($value) > 255) {
            return new JsonResponse(['error' => 'Headlines must be 255 characters or fewer.'], 422);
        }

        $element = ContentModel::findByPk($id);

        if ($element && (('headline' === $field && in_array($element->type, ['headline', 'text'], true)) || ('text' === $field && 'text' === $element->type))) {
            if ('headline' === $field) {
                $headline = StringUtil::deserialize($element->headline, true);
                $headline['value'] = htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                $element->headline = serialize($headline);
            } else {
                $element->text = $this->paragraphs($value);
            }

            $element->tstamp = time();
            $element->save();

            return new JsonResponse(['saved' => true, 'id' => (int) $element->id, 'field' => $field]);
        }

        $news = class_exists(NewsModel::class) ? NewsModel::findByPk($id) : null;

        if (!$news || !in_array($field, ['headline', 'subheadline', 'teaser'], true)) {
            return new JsonResponse(['error' => 'This content element cannot be edited inline.'], 404);
        }

        if (in_array($field, ['headline', 'subheadline'], true)) {
            $news->{$field} = htmlspecialchars(mb_substr($value, 0, 255), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        } else {
            $news->teaser = $this->paragraphs($value);
        }

        $news->tstamp = time();
        $news->save();

        return new JsonResponse(['saved' => true, 'id' => (int) $news->id, 'field' => $field]);
    }

    private function paragraphs(string $value): string
    {
        return implode('', array_map(
            static fn (string $line): string => '<p>'.htmlspecialchars($line, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'</p>',
            preg_split('/\R+/', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [],
        ));
    }

    public function saveLink(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        try {
            $payload = $request->toArray();
        } catch (\Throwable) {
            return new JsonResponse(['error' => 'Invalid request body.'], 400);
        }

        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) ($payload['_token'] ?? '')))) {
            return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        }

        $id = filter_var($payload['id'] ?? null, FILTER_VALIDATE_INT);
        $label = trim((string) ($payload['label'] ?? ''));
        $url = trim((string) ($payload['url'] ?? ''));
        $title = trim((string) ($payload['title'] ?? ''));
        $rel = trim((string) ($payload['rel'] ?? ''));
        $target = (bool) ($payload['target'] ?? false);

        if (!$id || '' === $label || mb_strlen($label) > 255 || '' === $url || mb_strlen($url) > 2048 || mb_strlen($title) > 255 || mb_strlen($rel) > 64) {
            return new JsonResponse(['error' => 'Add link text and a valid destination.'], 422);
        }

        $scheme = parse_url($url, PHP_URL_SCHEME);

        if (preg_match('/[\x00-\x20]/', $url) || ($scheme && !in_array(strtolower($scheme), ['http', 'https', 'mailto', 'tel'], true))) {
            return new JsonResponse(['error' => 'This link destination is not allowed.'], 422);
        }

        $element = ContentModel::findByPk($id);

        if (!$element || 'hyperlink' !== $element->type) {
            return new JsonResponse(['error' => 'This content element is not an editable link.'], 404);
        }

        $element->linkTitle = StringUtil::specialchars($label);
        $element->url = $url;
        $element->target = $target ? 1 : '';
        $element->titleText = $title;
        $element->rel = $rel;
        $element->tstamp = time();
        $element->save();

        return new JsonResponse(['saved' => true, 'id' => (int) $element->id]);
    }

    public function elementFields(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        $id = filter_var($request->attributes->get('id') ?? $request->query->get('id'), FILTER_VALIDATE_INT);
        $element = $id ? ContentModel::findByPk($id) : null;
        if (!$element || !$this->isRegisteredContentElement((string) $element->type)) {
            return new JsonResponse(['error' => 'This content element is not available.'], 404);
        }

        \Contao\Controller::loadDataContainer('tl_content');
        System::loadLanguageFile('tl_content');
        $connection = System::getContainer()->get('doctrine.dbal.default_connection');
        $columns = array_change_key_case($connection->createSchemaManager()->listTableColumns('tl_content'), CASE_LOWER);
        $fields = [];
        $quickEditHiddenFields = ['id', 'pid', 'ptable', 'sorting', 'tstamp', 'type', 'protected', 'groups', 'customTpl', 'invisible', 'title'];
        $subpaletteSelectors = [];
        foreach ($GLOBALS['TL_DCA']['tl_content']['subpalettes'] ?? [] as $selector => $subpalette) {
            if (!is_string($subpalette)) continue;
            $subpalette = preg_replace('/\{[^}]*\}/', '', $subpalette) ?? $subpalette;
            foreach (preg_split('/[,;]/', $subpalette) ?: [] as $subfield) {
                $subfield = trim($subfield, " \t\n\r\0\x0B[]");
                if ('' !== $subfield) $subpaletteSelectors[$subfield][] = (string) $selector;
            }
        }
        $selectorConditions = static function (string $selector, array $seen = []) use (&$selectorConditions, $subpaletteSelectors): array {
            if (isset($seen[$selector])) return [[]];
            $seen[$selector] = true;
            $selectorName = $selector;
            $selectorValue = true;
            if (str_contains($selector, '_')) [$selectorName, $selectorValue] = explode('_', $selector, 2);
            $paths = [[]];
            foreach ($subpaletteSelectors[$selectorName] ?? [] as $parent) {
                $parentPaths = $selectorConditions($parent, $seen);
                $paths = array_merge(...array_map(static fn ($path) => array_map(static fn ($parentPath) => [...$parentPath, ...$path], $parentPaths), $paths));
            }
            return array_map(static fn ($path) => [...$path, ['field' => $selectorName, 'value' => $selectorValue]], $paths);
        };
        foreach ($this->editablePaletteFields((string) $element->type) as $name => $config) {
            if (!isset($columns[strtolower((string) $name)]) || in_array($name, $quickEditHiddenFields, true)) continue;
            $dependencyGroups = [];
            foreach ($subpaletteSelectors[$name] ?? [] as $selector) $dependencyGroups = [...$dependencyGroups, ...$selectorConditions($selector)];
            $selectedFiles = [];
            $eval = $config['eval'] ?? [];
            $widget = $config['inputType'] ?? '';
            if (!in_array($widget, ['text', 'textarea', 'select', 'checkbox', 'radio', 'fileTree', 'pageTree', 'inputUnit', 'imageSize'], true) || !empty($eval['readonly']) || !empty($eval['doNotShow'])) continue;

            $label = $GLOBALS['TL_LANG']['tl_content'][$name][0] ?? ucwords(preg_replace('/([a-z])([A-Z])/', '$1 $2', $name));
            $description = $GLOBALS['TL_LANG']['tl_content'][$name][1] ?? '';
            $storedValue = $element->{$name};
            $value = StringUtil::deserialize($storedValue);
            if ('cssID' === $name) {
                $cssId = StringUtil::deserialize($storedValue, true);
                $value = ['id' => (string) ($cssId[0] ?? ''), 'class' => (string) ($cssId[1] ?? '')];
            }
            if ('fileTree' === $widget) {
                $selectedFiles = [];
                if (!empty($eval['multiple'])) {
                    $storedItems = $storedValue ? StringUtil::deserialize($storedValue, true) : [];
                    $value = array_map(static fn ($uuid): string => StringUtil::binToUuid($uuid), $storedItems);
                } else {
                    $value = $storedValue ? StringUtil::binToUuid($storedValue) : '';
                }
                foreach ((array) ($eval['multiple'] ? $value : ($value ? [$value] : [])) as $uuid) {
                    $fileModel = FilesModel::findByUuid((string) $uuid);
                    if (!$fileModel || 'file' !== $fileModel->type) continue;
                    $file = new File($fileModel->path);
                    $selectedFiles[] = [
                        'uuid' => StringUtil::binToUuid($fileModel->uuid),
                        'name' => $fileModel->name,
                        'type' => $file->isImage ? 'image' : 'file',
                        'url' => '/'.implode('/', array_map('rawurlencode', explode('/', $fileModel->path))),
                    ];
                }
            } elseif ('pageTree' === $widget && !empty($eval['multiple'])) {
                $value = StringUtil::deserialize($storedValue, true);
            }
            if ('imageSize' === $widget) {
                $parts = is_array($value) ? array_values($value) : ['', '', (string) $value];
                $value = ['width' => (string) ($parts[0] ?? ''), 'height' => (string) ($parts[1] ?? ''), 'mode' => (string) ($parts[2] ?? '')];
            }
            if ('checkbox' === $widget && !is_array($value)) $value = (bool) $value;
            elseif (is_array($value) && empty($eval['multiple']) && !in_array($widget, ['checkbox', 'fileTree', 'pageTree', 'inputUnit', 'listWizard', 'rowWizard', 'tableWizard', 'imageSize'], true) && 'cssID' !== $name) $value = (string) ($value['value'] ?? (array_is_list($value) ? ($value[0] ?? '') : ''));
            elseif (null === $value) $value = '';

            $options = [];
            $rawOptions = $eval['options'] ?? $config['options'] ?? $config['reference'] ?? [];
            if ('imageSize' === $widget) $rawOptions = System::getContainer()->get('contao.image.sizes')->getAllOptions();
            if ('pageTree' === $widget) {
                foreach ($connection->fetchAllAssociative('SELECT id,title FROM tl_page ORDER BY pid,sorting,title') as $page) $options[] = ['value' => (string) $page['id'], 'label' => (string) $page['title']];
            }
            if (is_array($rawOptions)) {
                foreach ($rawOptions as $key => $optionLabel) {
                    if ('imageSize' === $widget && is_array($optionLabel)) {
                        foreach ($optionLabel as $imageSizeValue => $imageSizeLabel) {
                            if (!is_scalar($imageSizeLabel)) continue;
                            $optionValue = array_is_list($optionLabel) ? (string) $imageSizeLabel : (string) $imageSizeValue;
                            $options[] = ['value' => $optionValue, 'label' => (string) $imageSizeLabel, 'group' => (string) $key];
                        }
                        continue;
                    }
                    if (!is_scalar($optionLabel)) continue;
                    $optionValue = array_is_list($rawOptions) ? (string) $optionLabel : (string) $key;
                    $languageLabel = $GLOBALS['TL_LANG']['tl_content'][$name][$optionValue] ?? null;
                    $options[] = ['value' => $optionValue, 'label' => is_string($languageLabel) ? $languageLabel : (string) $optionLabel, 'group' => 'imageSize' === $widget ? (string) $key : ''];
                }
            }

            $displayLabel = match ($name) {
                'start' => 'Show from',
                'stop' => 'Show until',
                'size' => 'Image size',
                default => is_array($label) ? (string) ($label[0] ?? $name) : (string) $label,
            };
            if (in_array($name, ['start', 'stop'], true)) $widget = 'datetime';
            $fields[] = ['name' => (string) $name, 'label' => $displayLabel,
                'description' => is_array($description) ? (string) ($description[0] ?? '') : (string) $description,
                'widget' => $widget, 'value' => $value, 'options' => $options, 'multiple' => !empty($eval['multiple']),
                'required' => !empty($eval['mandatory']), 'maxlength' => (int) ($eval['maxlength'] ?? 0),
                'richText' => !empty($eval['rte']),
                'dependencyGroups' => $dependencyGroups,
                'advanced' => in_array($name, ['cssID', 'customTpl', 'size', 'imageSize'], true),
                'selectedFiles' => $selectedFiles ?? []];
        }

        return new JsonResponse(['id' => (int) $element->id, 'type' => (string) $element->type, 'invisible' => (bool) $element->invisible, 'fields' => $fields]);
    }

    public function saveElementFields(Request $request): JsonResponse
    {
        $this->framework->initialize();
        if (!$this->isAuthorizedEditor($request)) return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);

        try { $payload = $request->toArray(); } catch (\Throwable) { return new JsonResponse(['error' => 'Invalid request body.'], 400); }
        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) ($payload['_token'] ?? '')))) return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);

        $id = filter_var($payload['id'] ?? null, FILTER_VALIDATE_INT);
        $element = $id ? ContentModel::findByPk($id) : null;
        $submitted = $payload['fields'] ?? null;
        if (!$element || !$this->isRegisteredContentElement((string) $element->type) || !is_array($submitted) || count($submitted) > 100) return new JsonResponse(['error' => 'This content element cannot be edited.'], 404);

        \Contao\Controller::loadDataContainer('tl_content');
        $connection = System::getContainer()->get('doctrine.dbal.default_connection');
        $columns = array_change_key_case($connection->createSchemaManager()->listTableColumns('tl_content'), CASE_LOWER);
        $allowed = ['id', 'pid', 'ptable', 'sorting', 'tstamp', 'type'];
        foreach ($this->editablePaletteFields((string) $element->type) as $name => $config) {
            if (isset($columns[strtolower((string) $name)]) && !empty($config['inputType']) && empty($config['eval']['readonly']) && empty($config['eval']['doNotShow'])) $allowed[] = $name;
        }
        if (isset($columns['invisible']) && !empty($GLOBALS['TL_DCA']['tl_content']['fields']['invisible']['inputType'])) $allowed[] = 'invisible';

        foreach ($submitted as $name => $value) {
            if (!is_string($name) || !in_array($name, $allowed, true) || in_array($name, ['id', 'pid', 'ptable', 'sorting', 'tstamp', 'type'], true)) return new JsonResponse(['error' => 'One of the submitted fields is not editable.'], 422);
            $config = $GLOBALS['TL_DCA']['tl_content']['fields'][$name] ?? [];
            $widget = $config['inputType'] ?? '';
            if ('cssID' === $name && is_array($value)) {
                $cssId = (string) ($value['id'] ?? $value[0] ?? '');
                $cssClass = (string) ($value['class'] ?? $value[1] ?? '');
                if (mb_strlen($cssId) > 255 || mb_strlen($cssClass) > 255) return new JsonResponse(['error' => 'The CSS ID or class is too long.'], 422);
                $value = serialize([$cssId, $cssClass]);
            } elseif ('imageSize' === $widget && is_array($value)) {
                $parts = [(string) ($value['width'] ?? $value[0] ?? ''), (string) ($value['height'] ?? $value[1] ?? ''), (string) ($value['mode'] ?? $value[2] ?? '')];
                if (strlen(serialize($parts)) > 20000) return new JsonResponse(['error' => 'The structured field is too large.'], 422);
                $allowedOptions = [];
                foreach (System::getContainer()->get('contao.image.sizes')->getAllOptions() as $group => $groupOptions) foreach ($groupOptions as $key => $option) $allowedOptions[] = in_array($group, ['custom', 'relative', 'exact'], true) ? (string) $option : (string) $key;
                if ('' !== $parts[2] && !in_array($parts[2], $allowedOptions, true)) return new JsonResponse(['error' => 'Choose a valid image size.'], 422);
                $value = serialize($parts);
            } elseif (in_array($widget, ['listWizard', 'rowWizard', 'tableWizard'], true) && is_array($value)) {
                if (count($value) > 100 || strlen(serialize($value)) > 20000) return new JsonResponse(['error' => 'The structured field is too large.'], 422);
                $value = serialize($value);
            } elseif ('inputUnit' === $widget && is_array($value) && is_scalar($value['value'] ?? null)) {
                $numericValue = (string) $value['value'];
                $unitValue = (string) ($value['unit'] ?? '');
                if (mb_strlen($numericValue) > 100) return new JsonResponse(['error' => 'A field value is too long.'], 422);
                $unitOptions = $config['eval']['options'] ?? $config['options'] ?? $config['reference'] ?? [];
                $validUnits = is_array($unitOptions) ? (array_is_list($unitOptions) ? array_map('strval', $unitOptions) : array_map('strval', array_keys($unitOptions))) : [];
                if ($validUnits && !in_array($unitValue, $validUnits, true)) return new JsonResponse(['error' => 'Choose a valid unit.'], 422);
                $value = serialize(['value' => $numericValue, 'unit' => $unitValue]);
            } elseif ('checkbox' === $widget && is_array($value)) {
                $rawOptions = $config['eval']['options'] ?? $config['options'] ?? $config['reference'] ?? [];
                $allowedOptions = is_array($rawOptions) ? (array_is_list($rawOptions) ? array_map('strval', $rawOptions) : array_map('strval', array_keys($rawOptions))) : [];
                foreach ($value as $option) if (!is_scalar($option) || ($allowedOptions && !in_array((string) $option, $allowedOptions, true))) return new JsonResponse(['error' => 'Choose a valid option.'], 422);
                $value = serialize(array_values($value));
            } elseif ('fileTree' === $widget) {
                $items = is_array($value) ? $value : ('' === (string) $value ? [] : [(string) $value]);
                $normalized = [];
                foreach ($items as $selected) {
                    if (!is_string($selected) || !\Contao\Validator::isUuid($selected)) return new JsonResponse(['error' => 'Choose a file from the Contao picker.'], 422);
                    $fileModel = FilesModel::findByUuid($selected);
                    if (!$fileModel || 'file' !== $fileModel->type) return new JsonResponse(['error' => 'Choose a file available in the Contao file library.'], 422);
                    $normalized[] = $fileModel->uuid;
                }
                $value = !empty($config['eval']['multiple']) ? serialize($normalized) : ($normalized[0] ?? '');
            } elseif ('pageTree' === $widget) {
                $items = is_array($value) ? $value : ('' === (string) $value ? [] : [(string) $value]);
                $normalized = [];
                foreach ($items as $selected) {
                    if (!filter_var($selected, FILTER_VALIDATE_INT) || !\Contao\PageModel::findByPk((int) $selected)) return new JsonResponse(['error' => 'Choose a page from the page list.'], 422);
                    $normalized[] = (int) $selected;
                }
                $value = !empty($config['eval']['multiple']) ? serialize($normalized) : ($normalized[0] ?? '');
            } elseif (is_array($value)) {
                if (count($value) > 100 || strlen(serialize($value)) > 20000) return new JsonResponse(['error' => 'The structured field is too large.'], 422);
                $value = serialize($value);
            } elseif ('checkbox' === $widget) {
                $value = $value ? 1 : '';
            } elseif (is_scalar($value) || null === $value) {
                $value = (string) ($value ?? '');
                $limit = (int) ($config['eval']['maxlength'] ?? 10000);
                if (mb_strlen($value) > min(max($limit, 1), 20000)) return new JsonResponse(['error' => 'A field value is too long.'], 422);
                if ('youtube' === $name && !preg_match('/^[\w-]{11}$/', $value)) return new JsonResponse(['error' => 'Enter a valid YouTube video URL.'], 422);
                if ('vimeo' === $name && !preg_match('/^\d{1,12}$/', $value)) return new JsonResponse(['error' => 'Enter a valid Vimeo video URL.'], 422);
                $options = $config['eval']['options'] ?? $config['options'] ?? $config['reference'] ?? [];
                if (in_array($widget, ['select', 'radio'], true) && is_array($options) && $options) {
                    $validOptions = array_is_list($options) ? array_map('strval', $options) : array_map('strval', array_keys($options));
                    if (!in_array($value, $validOptions, true)) return new JsonResponse(['error' => 'Choose a valid option.'], 422);
                }
                $previous = StringUtil::deserialize($element->{$name});
                if ('inputUnit' === $widget) $value = serialize(['value' => $value, 'unit' => (string) ($submitted[$name]['unit'] ?? '')]);
                elseif (is_array($previous) && !in_array($widget, ['checkbox', 'fileTree', 'pageTree'], true)) {
                    if (array_key_exists('value', $previous)) $previous['value'] = $value;
                    elseif (array_is_list($previous)) $previous[0] = $value;
                    $value = serialize($previous);
                }
            } else return new JsonResponse(['error' => 'Unsupported field value.'], 422);

            $element->{$name} = $value;
        }

        $element->tstamp = time();
        $element->save();
        return new JsonResponse(['saved' => true, 'id' => (int) $element->id]);
    }

    public function deleteElement(Request $request): JsonResponse
    {
        $this->framework->initialize();
        if (!$this->isAuthorizedEditor($request)) return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        try { $payload = $request->toArray(); } catch (\Throwable) { return new JsonResponse(['error' => 'Invalid request body.'], 400); }
        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) ($payload['_token'] ?? '')))) return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        $id = filter_var($payload['id'] ?? null, FILTER_VALIDATE_INT);
        $element = $id ? ContentModel::findByPk($id) : null;
        if (!$element || !$this->isRegisteredContentElement((string) $element->type)) return new JsonResponse(['error' => 'This content element cannot be removed.'], 404);

        $connection = System::getContainer()->get('doctrine.dbal.default_connection');
        $remove = static function (int $recordId) use (&$remove, $connection): void {
            $children = $connection->fetchFirstColumn("SELECT id FROM tl_content WHERE pid=? AND ptable='tl_content'", [$recordId]);
            foreach ($children as $childId) $remove((int) $childId);
            $connection->delete('tl_content', ['id' => $recordId]);
        };
        $remove((int) $element->id);
        return new JsonResponse(['saved' => true, 'id' => (int) $element->id]);
    }

    /** @return array<string, array<string, mixed>> */
    private function editablePaletteFields(string $type): array
    {
        $dca = $GLOBALS['TL_DCA']['tl_content'] ?? [];
        $fields = $dca['fields'] ?? [];
        $palette = $dca['palettes'][$type] ?? $dca['palettes']['default'] ?? '';
        $names = [];
        $readPalette = static function (mixed $value) use (&$names): void {
            if (!is_string($value)) return;
            $value = preg_replace('/\{[^}]*\}/', '', $value) ?? $value;
            foreach (preg_split('/[,;]/', $value) ?: [] as $name) {
                $name = trim($name, " \t\n\r\0\x0B[]");
                if ('' !== $name && preg_match('/^[A-Za-z][A-Za-z0-9_]*$/', $name)) $names[$name] = true;
            }
        };
        $readPalette($palette);
        foreach ($dca['subpalettes'] ?? [] as $selector => $subpalette) {
            if (isset($names[$selector])) $readPalette($subpalette);
        }
        if (!$names) $names = array_fill_keys(array_keys($fields), true);

        $editable = [];
        foreach (array_keys($names) as $name) {
            $config = $fields[$name] ?? null;
            if (!is_array($config) || in_array($name, ['id', 'pid', 'ptable', 'sorting', 'tstamp', 'type'], true)) continue;
            if (empty($config['inputType']) || !empty($config['eval']['readonly']) || !empty($config['eval']['doNotShow'])) continue;
            $editable[$name] = $config;
        }

        return $editable;
    }

    public function saveImage(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) $request->request->get('_token', '')))) {
            return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        }

        $id = filter_var($request->request->get('id'), FILTER_VALIDATE_INT);
        $alt = trim((string) $request->request->get('alt', ''));
        $title = trim((string) $request->request->get('title', ''));
        $caption = trim((string) $request->request->get('caption', ''));
        $upload = $request->files->get('file');
        $selectedUuid = trim((string) $request->request->get('fileUuid', ''));

        if (!$id || mb_strlen($alt) > 255 || mb_strlen($title) > 255 || mb_strlen($caption) > 500 || (null !== $upload && !$upload instanceof UploadedFile) || ('' !== $selectedUuid && !\Contao\Validator::isUuid($selectedUuid)) || ($upload instanceof UploadedFile && '' !== $selectedUuid)) {
            return new JsonResponse(['error' => 'Check the image details and try again.'], 422);
        }

        $element = ContentModel::findByPk($id);

        if (!$element || 'image' !== $element->type) {
            return new JsonResponse(['error' => 'This content element is not an editable image.'], 404);
        }

        $url = null;

        if ($upload instanceof UploadedFile) {
            if (!$upload->isValid() || $upload->getSize() > 15 * 1024 * 1024) {
                return new JsonResponse(['error' => 'Choose a valid image smaller than 15 MB.'], 422);
            }

            $mimeType = $upload->getMimeType();
            $extensions = [
                'image/jpeg' => 'jpg',
                'image/png' => 'png',
                'image/gif' => 'gif',
                'image/webp' => 'webp',
                'image/avif' => 'avif',
            ];

            if (!isset($extensions[$mimeType])) {
                return new JsonResponse(['error' => 'Upload a JPG, PNG, GIF, WebP, or AVIF image.'], 422);
            }

            $projectDir = System::getContainer()->getParameter('kernel.project_dir');
            $relativeDirectory = 'files/contao-live-edit/uploads';
            $absoluteDirectory = Path::join($projectDir, $relativeDirectory);
            (new Filesystem())->mkdir($absoluteDirectory, 0755);

            try {
                $originalName = StringUtil::sanitizeFileName(basename($upload->getClientOriginalName()));
            } catch (\InvalidArgumentException) {
                $originalName = 'image';
            }

            $filename = bin2hex(random_bytes(5)).'-'.pathinfo($originalName, PATHINFO_FILENAME).'.'.$extensions[$mimeType];
            $relativePath = $relativeDirectory.'/'.$filename;
            $upload->move($absoluteDirectory, $filename);
            $fileModel = Dbafs::addResource($relativePath);

            if (!$fileModel instanceof FilesModel) {
                return new JsonResponse(['error' => 'Contao could not add the uploaded image to the file library.'], 500);
            }

            $element->singleSRC = $fileModel->uuid;
            $url = '/'.$relativePath;
        } elseif ('' !== $selectedUuid) {
            $fileModel = FilesModel::findByUuid($selectedUuid);

            if (!$fileModel || 'file' !== $fileModel->type || !(new File($fileModel->path))->isImage) {
                return new JsonResponse(['error' => 'Choose an image available in your Contao file library.'], 422);
            }

            $element->singleSRC = $fileModel->uuid;
            $url = '/'.implode('/', array_map('rawurlencode', explode('/', $fileModel->path)));
        } elseif (!$element->singleSRC || !FilesModel::findByUuid($element->singleSRC)) {
            return new JsonResponse(['error' => 'Upload an image before saving these settings.'], 422);
        }

        $element->alt = StringUtil::specialchars($alt);
        $element->imageTitle = StringUtil::specialchars($title);
        $element->caption = StringUtil::specialchars($caption);
        $element->overwriteMeta = 1;
        $element->tstamp = time();
        $element->save();

        return new JsonResponse([
            'saved' => true,
            'id' => (int) $element->id,
            'url' => $url,
            'alt' => $alt,
            'title' => $title,
            'caption' => $caption,
        ]);
    }

    public function browseImages(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        $folderUuid = trim((string) $request->query->get('folder', ''));
        $allFiles = $request->query->getBoolean('all');
        if ('' !== $folderUuid) {
            if (!\Contao\Validator::isUuid($folderUuid)) {
                return new JsonResponse(['error' => 'Choose a valid folder.'], 422);
            }

            $folder = FilesModel::findByUuid($folderUuid);

            if (!$folder || 'folder' !== $folder->type) {
                return new JsonResponse(['error' => 'This folder is not available in your file library.'], 404);
            }

            $entries = FilesModel::findByPid($folder->uuid, ['order' => 'name']);
        } else {
            $folder = null;
            $entries = FilesModel::findAll(['order' => 'name']);
        }

        $items = [];

        if ($entries) {
            while ($entries->next()) {
                $entry = $entries->current();

                if (!$folder && !empty($entry->pid)) {
                    continue;
                }

                if ('folder' === $entry->type) {
                    $items[] = [
                        'type' => 'folder',
                        'uuid' => StringUtil::binToUuid($entry->uuid),
                        'name' => $entry->name,
                    ];

                    continue;
                }

                $file = new File($entry->path);

                if (!$file->isImage && !$allFiles) {
                    continue;
                }

                $items[] = [
                    'type' => $file->isImage ? 'image' : 'file',
                    'uuid' => StringUtil::binToUuid($entry->uuid),
                    'name' => $entry->name,
                    'path' => $entry->path,
                    'url' => '/'.implode('/', array_map('rawurlencode', explode('/', $entry->path))),
                ];
            }
        }

        return new JsonResponse([
            'folder' => $folder ? ['uuid' => StringUtil::binToUuid($folder->uuid), 'name' => $folder->name] : null,
            'items' => $items,
        ]);
    }

    public function reorderContent(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        try {
            $payload = $request->toArray();
        } catch (\Throwable) {
            return new JsonResponse(['error' => 'Invalid request body.'], 400);
        }

        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) ($payload['_token'] ?? '')))) {
            return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        }

        $id = filter_var($payload['id'] ?? null, FILTER_VALIDATE_INT);
        $anchorId = filter_var($payload['anchorId'] ?? null, FILTER_VALIDATE_INT);
        $placement = 'before' === ($payload['placement'] ?? '') ? 'before' : 'after';
        $element = $id ? ContentModel::findByPk($id) : null;
        $anchor = $anchorId ? ContentModel::findByPk($anchorId) : null;

        if (!$element || !$this->isRegisteredContentElement((string) $element->type)) {
            return new JsonResponse(['error' => 'This content element cannot be moved.'], 404);
        }

        if (!$anchor || (int) $anchor->id === (int) $element->id) {
            return new JsonResponse(['error' => 'Choose a different element as the drop target.'], 422);
        }

        $connection = System::getContainer()->get('doctrine.dbal.default_connection');
        $sourceRoot = $this->contentRoot((int) $element->id);
        $targetRoot = $this->contentRoot((int) $anchor->id);
        if (!$sourceRoot || $sourceRoot !== $targetRoot || 'tl_article' !== $sourceRoot[0]) {
            return new JsonResponse(['error' => 'Elements can only be moved within the same page.'], 422);
        }

        $sourceParentId = (int) $element->pid;
        $sourceParentTable = (string) $element->ptable;
        $targetParentId = (int) $anchor->pid;
        $targetParentTable = (string) $anchor->ptable;

        if ('element_group' === $element->type && 'tl_content' === $targetParentTable) {
            $ancestorId = $targetParentId;
            while ($ancestorId > 0) {
                if ($ancestorId === (int) $element->id) {
                    return new JsonResponse(['error' => 'A group cannot be moved inside itself.'], 422);
                }
                $ancestor = ContentModel::findByPk($ancestorId);
                if (!$ancestor || 'tl_content' !== $ancestor->ptable) break;
                $ancestorId = (int) $ancestor->pid;
            }
        }

        $connection->beginTransaction();

        try {
            $sourceSiblings = $connection->fetchFirstColumn(
                'SELECT id FROM tl_content WHERE pid=? AND ptable=? ORDER BY sorting, id',
                [$sourceParentId, $sourceParentTable],
            );
            $sourceSiblings = array_values(array_filter(array_map('intval', $sourceSiblings), static fn (int $siblingId): bool => $siblingId !== (int) $element->id));
            $targetSiblings = $sourceParentId === $targetParentId && $sourceParentTable === $targetParentTable
                ? $sourceSiblings
                : array_map('intval', $connection->fetchFirstColumn(
                    'SELECT id FROM tl_content WHERE pid=? AND ptable=? ORDER BY sorting, id',
                    [$targetParentId, $targetParentTable],
                ));
            $anchorPosition = array_search((int) $anchor->id, $targetSiblings, true);

            if (false === $anchorPosition) {
                throw new \RuntimeException('Could not find the target element.');
            }

            $position = 'before' === $placement ? $anchorPosition : $anchorPosition + 1;
            $connection->update('tl_content', ['pid' => $targetParentId, 'ptable' => $targetParentTable, 'tstamp' => time()], ['id' => (int) $element->id]);
            array_splice($targetSiblings, $position, 0, [(int) $element->id]);

            foreach ($sourceSiblings as $index => $siblingId) {
                $connection->update('tl_content', ['sorting' => ($index + 1) * 128, 'tstamp' => time()], ['id' => $siblingId]);
            }
            foreach ($targetSiblings as $index => $siblingId) {
                $connection->update('tl_content', ['sorting' => ($index + 1) * 128, 'tstamp' => time()], ['id' => $siblingId]);
            }

            $connection->commit();
        } catch (\Throwable $error) {
            $connection->rollBack();

            return new JsonResponse(['error' => $error->getMessage() ?: 'Could not move this element.'], 422);
        }

        return new JsonResponse(['saved' => true, 'id' => (int) $element->id]);
    }

    public function insertContent(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        try {
            $payload = $request->toArray();
        } catch (\Throwable) {
            return new JsonResponse(['error' => 'Invalid request body.'], 400);
        }

        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) ($payload['_token'] ?? '')))) {
            return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        }

        $anchorId = filter_var($payload['anchorId'] ?? null, FILTER_VALIDATE_INT);
        $placement = 'before' === ($payload['placement'] ?? '') ? 'before' : 'after';
        $type = (string) ($payload['type'] ?? '');
        $anchor = $anchorId ? ContentModel::findByPk($anchorId) : null;

        if (!$anchor || !$this->isRegisteredContentElement($type)) {
            return new JsonResponse(['error' => 'Choose a valid element and drop it on a content area.'], 422);
        }

        $parentId = (int) $anchor->pid;
        $parentTable = (string) $anchor->ptable;
        if ('element_group' === $anchor->type) {
            $parentId = (int) $anchor->pid;
            $parentTable = (string) $anchor->ptable;
        }

        $connection = System::getContainer()->get('doctrine.dbal.default_connection');
        $connection->beginTransaction();

        try {
            $siblingIds = array_map('intval', $connection->fetchFirstColumn(
                'SELECT id FROM tl_content WHERE pid=? AND ptable=? ORDER BY sorting, id',
                [$parentId, $parentTable],
            ));
            $anchorPosition = array_search((int) $anchor->id, $siblingIds, true);
            $position = false === $anchorPosition ? false : ('before' === $placement ? $anchorPosition : $anchorPosition + 1);

            if (false === $position || null === $position) {
                throw new \RuntimeException('Could not determine the insertion position.');
            }

            $newIds = $this->createContentElements($type, $parentId, $parentTable);
            array_splice($siblingIds, $position, 0, $newIds);

            foreach ($siblingIds as $index => $siblingId) {
                $connection->update('tl_content', ['sorting' => ($index + 1) * 128, 'tstamp' => time()], ['id' => $siblingId]);
            }

            $connection->commit();
        } catch (\Throwable $error) {
            $connection->rollBack();

            return new JsonResponse(['error' => $error->getMessage() ?: 'Could not add this element.'], 422);
        }

        return new JsonResponse(['saved' => true, 'id' => $newIds[0] ?? null]);
    }

    /** @return list<int> */
    private function createContentElements(string $type, int $pid, string $ptable): array
    {
        $connection = System::getContainer()->get('doctrine.dbal.default_connection');
        \Contao\Controller::loadDataContainer('tl_content');
        $sorting = 128;
        $create = static function (string $elementType, array $overrides = [], int|null $recordPid = null, string|null $recordTable = null) use ($pid, $ptable, &$sorting): ContentModel {
            $typeDca = $GLOBALS['TL_DCA']['tl_content']['fields'] ?? [];
            $defaults = [];
            foreach ($typeDca as $field => $config) {
                if (in_array($field, ['id', 'pid', 'ptable', 'sorting', 'tstamp', 'type'], true)) continue;
                $default = $config['default'] ?? $config['sql']['default'] ?? null;
                if (is_scalar($default) || null === $default) $defaults[$field] = $default;
            }

            $defaults = array_replace([
                'title' => '',
                'headline' => serialize(['value' => '', 'unit' => 'h2']),
                'text' => null,
                'cssID' => serialize(['', '']),
                'invisible' => 0,
                'start' => '',
                'stop' => '',
            ], $defaults, $overrides);
            $element = new ContentModel();
            $element->setRow(array_merge($defaults, [
                'pid' => $recordPid ?? $pid,
                'ptable' => $recordTable ?? $ptable,
                'sorting' => $sorting,
                'tstamp' => time(),
                'type' => $elementType,
            ]))->save();
            $sorting += 128;

            return $element;
        };

        {
            $overrides = match ($type) {
                'headline' => ['headline' => serialize(['value' => 'New headline', 'unit' => 'h2'])],
                'text' => ['text' => '<p>Write your text here.</p>'],
                'hyperlink' => ['url' => '#', 'linkTitle' => 'Add link text'],
                default => [],
            };

            return [(int) $create($type, $overrides)->id];
        }

    }

    public function listContentElements(Request $request): JsonResponse
    {
        $this->framework->initialize();

        if (!$this->isAuthorizedEditor($request)) {
            return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit this page.'], 403);
        }

        System::loadLanguageFile('default');
        \Contao\Controller::loadDataContainer('tl_content');
        $catalog = [];
        foreach ($GLOBALS['TL_CTE'] ?? [] as $category => $elements) {
            $items = [];
            foreach (array_keys($elements) as $type) {
                $items[] = [
                    'type' => (string) $type,
                    'label' => $this->contentElementLabel((string) $type, 0),
                    'description' => $this->contentElementLabel((string) $type, 1),
                ];
            }

            if ($items) {
                $catalog[] = [
                    'category' => (string) $category,
                    'label' => $this->contentElementLabel((string) $category),
                    'items' => $items,
                ];
            }
        }


        return new JsonResponse(['categories' => $catalog]);
    }

    private function isRegisteredContentElement(string $type): bool
    {
        foreach ($GLOBALS['TL_CTE'] ?? [] as $elements) {
            if (array_key_exists($type, $elements)) return true;
        }

        return false;
    }

    private function contentElementLabel(string $key, int|null $part = null): string
    {
        $translationKey = 'CTE.'.$key.(null !== $part ? '.'.$part : '');
        $translation = $this->translator->trans($translationKey, [], 'contao_default');
        if ($translation !== $translationKey) return $translation;

        $legacy = $GLOBALS['TL_LANG']['CTE'][$key] ?? null;
        if (null !== $part && is_array($legacy) && isset($legacy[$part])) return (string) $legacy[$part];
        if (null === $part && is_string($legacy)) return $legacy;

        return ucwords(str_replace(['_', '-'], ' ', $key));
    }

    private function isAuthorizedEditor(Request $request): bool
    {
        if (!$request->hasPreviousSession() || !$this->tokenChecker->hasBackendUser()) {
            return false;
        }

        return (bool) BackendUser::getInstance()?->isAdmin;
    }

    /** @return array{string, int}|null */
    private function contentRoot(int $id): array|null
    {
        $connection = System::getContainer()->get('doctrine.dbal.default_connection');
        $seen = [];

        while ($id > 0 && !isset($seen[$id])) {
            $seen[$id] = true;
            $row = $connection->fetchAssociative('SELECT pid, ptable FROM tl_content WHERE id=?', [$id]);
            if (!$row) return null;
            if ('tl_content' !== $row['ptable']) return [(string) $row['ptable'], (int) $row['pid']];
            $id = (int) $row['pid'];
        }

        return null;
    }
}
