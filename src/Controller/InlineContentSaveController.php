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

                if (!$file->isImage) {
                    continue;
                }

                $items[] = [
                    'type' => 'image',
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
