<?php

declare(strict_types=1);

namespace ContaoLiveEdit\Controller;

use Contao\BackendUser;
use Contao\CoreBundle\Framework\ContaoFramework;
use Contao\CoreBundle\Security\Authentication\Token\TokenChecker;
use Contao\System;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Security\Csrf\CsrfToken;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;

final class TemplateEditController
{
    public function __construct(private CsrfTokenManagerInterface $csrfTokenManager, private ContaoFramework $framework, private TokenChecker $tokenChecker) {}

    public function list(Request $request): JsonResponse
    {
        $this->framework->initialize();
        if (!$this->authorized($request)) return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit templates.'], 403);
        $root = $this->templateRoot();
        if (!$root) return new JsonResponse(['templates' => []]);
        $templates = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->isLink()) continue;
            $relative = substr($file->getPathname(), strlen($root) + 1);
            if (!preg_match('/\.(?:html\.twig|html5|xhtml)$/', $relative)) continue;
            $templates[] = ['path' => str_replace(DIRECTORY_SEPARATOR, '/', $relative), 'label' => str_replace(DIRECTORY_SEPARATOR, '/', $relative), 'bytes' => $file->getSize()];
        }
        usort($templates, static fn (array $a, array $b): int => strnatcasecmp($a['path'], $b['path']));
        return new JsonResponse(['templates' => $templates]);
    }

    public function read(Request $request): JsonResponse
    {
        $this->framework->initialize();
        if (!$this->authorized($request)) return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit templates.'], 403);
        $path = (string) $request->query->get('path', '');
        $file = $this->resolveTemplate($path);
        if (!$file || filesize($file) > 1_000_000) return new JsonResponse(['error' => 'That template cannot be opened.'], 404);
        return new JsonResponse(['path' => $path, 'content' => file_get_contents($file), 'hasBackup' => is_file($file.'.contao-live-edit.bak')]);
    }

    public function save(Request $request): JsonResponse
    {
        $this->framework->initialize();
        if (!$this->authorized($request)) return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit templates.'], 403);
        try { $payload = $request->toArray(); } catch (\Throwable) { return new JsonResponse(['error' => 'Invalid request body.'], 400); }
        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) ($payload['_token'] ?? '')))) return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        $path = (string) ($payload['path'] ?? '');
        $content = $payload['content'] ?? null;
        $file = $this->resolveTemplate($path);
        if (!$file) return new JsonResponse(['error' => 'That template cannot be saved.'], 404);
        if (!is_string($content) || strlen($content) > 1_000_000) return new JsonResponse(['error' => 'Template source must be smaller than 1 MB.'], 422);
        $validationError = $this->validateSource($path, $content);
        if ($validationError) return new JsonResponse(['error' => $validationError], 422);

        $backup = $file.'.contao-live-edit.bak';
        if (!copy($file, $backup)) return new JsonResponse(['error' => 'Could not back up the current template. Check file permissions.'], 500);
        $temporary = tempnam(dirname($file), '.contao-live-edit-');
        if (false === $temporary) return new JsonResponse(['error' => 'Could not prepare the template save.'], 500);
        $written = file_put_contents($temporary, $content, LOCK_EX);
        if (false === $written) {
            @unlink($temporary);
            return new JsonResponse(['error' => 'Could not write the template. Check file permissions.'], 500);
        }
        @chmod($temporary, fileperms($file) & 0777);
        if (!rename($temporary, $file)) {
            @unlink($temporary);
            return new JsonResponse(['error' => 'Could not replace the template. The original file is still available.'], 500);
        }
        $this->invalidateTwigCache();
        return new JsonResponse(['saved' => true, 'path' => $path, 'hasBackup' => true]);
    }

    public function restore(Request $request): JsonResponse
    {
        $this->framework->initialize();
        if (!$this->authorized($request)) return new JsonResponse(['error' => 'Sign in to Contao as an administrator to edit templates.'], 403);
        try { $payload = $request->toArray(); } catch (\Throwable) { return new JsonResponse(['error' => 'Invalid request body.'], 400); }
        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('contao_live_edit', (string) ($payload['_token'] ?? '')))) return new JsonResponse(['error' => 'The edit session expired. Reload the page and try again.'], 419);
        $path = (string) ($payload['path'] ?? '');
        $file = $this->resolveTemplate($path);
        if (!$file) return new JsonResponse(['error' => 'That template cannot be restored.'], 404);
        $backup = $file.'.contao-live-edit.bak';
        if (!is_file($backup) || filesize($backup) > 1_000_000) return new JsonResponse(['error' => 'No previous template version is available.'], 404);
        $previous = file_get_contents($backup);
        $current = file_get_contents($file);
        if (!is_string($previous) || !is_string($current)) return new JsonResponse(['error' => 'Could not read the template version.'], 500);
        $validationError = $this->validateSource($path, $previous);
        if ($validationError) return new JsonResponse(['error' => 'The saved backup is invalid and cannot be restored: '.$validationError], 422);

        $temporary = tempnam(dirname($file), '.contao-live-edit-restore-');
        if (false === $temporary || false === file_put_contents($temporary, $previous, LOCK_EX)) {
            if (is_string($temporary)) @unlink($temporary);
            return new JsonResponse(['error' => 'Could not prepare the template restore.'], 500);
        }
        @chmod($temporary, fileperms($file) & 0777);
        if (!rename($temporary, $file)) {
            @unlink($temporary);
            return new JsonResponse(['error' => 'Could not restore the template.'], 500);
        }
        if (false === file_put_contents($backup, $current, LOCK_EX)) return new JsonResponse(['error' => 'The template was restored, but the current version could not be saved as the new backup.'], 500);
        $this->invalidateTwigCache();

        return new JsonResponse(['saved' => true, 'path' => $path, 'content' => $previous, 'hasBackup' => true]);
    }

    private function authorized(Request $request): bool
    {
        return $request->hasPreviousSession() && $this->tokenChecker->hasBackendUser() && (bool) BackendUser::getInstance()?->isAdmin;
    }

    private function validateSource(string $path, string $content): string|null
    {
        try {
            if (str_ends_with($path, '.html.twig')) {
                $twig = System::getContainer()->get('twig');
                $twig->compileSource(new \Twig\Source($content, $path));
            } else {
                \PhpToken::tokenize($content, TOKEN_PARSE);
            }
        } catch (\Throwable $error) {
            $line = $error->getLine() > 0 ? ' on line '.$error->getLine() : '';
            return 'Template syntax error'.$line.'. Fix the source before saving.';
        }

        return null;
    }

    private function templateRoot(): string|null
    {
        $project = (string) System::getContainer()->getParameter('kernel.project_dir');
        $root = realpath($project.'/templates');
        return $root && is_dir($root) ? $root : null;
    }

    private function resolveTemplate(string $path): string|null
    {
        $root = $this->templateRoot();
        if (!$root || '' === $path || str_contains($path, "\0") || str_contains($path, '\\') || str_starts_with($path, '/') || preg_match('#(^|/)\.\.?(/|$)#', $path) || !preg_match('/\.(?:html\.twig|html5|xhtml)$/', $path)) return null;
        $candidate = realpath($root.'/'.$path);
        return $candidate && str_starts_with($candidate, $root.DIRECTORY_SEPARATOR) && is_file($candidate) ? $candidate : null;
    }

    private function invalidateTwigCache(): void
    {
        $container = System::getContainer();
        if (!$container->has('twig') || !$container->has('contao.twig.filesystem_loader')) return;
        $twig = $container->get('twig');
        $loader = $container->get('contao.twig.filesystem_loader');
        if (!method_exists($loader, 'getInheritanceChains') || !method_exists($twig, 'removeCache')) return;
        foreach ($loader->getInheritanceChains() as $chain) {
            foreach (array_values($chain) as $logicalName) {
                if (!is_string($logicalName) || str_contains($logicalName, '/backend/')) continue;
                try { $twig->removeCache($logicalName); } catch (\Throwable) { /* Keep the source save successful if this Twig cache backend cannot remove entries. */ }
            }
        }
    }
}
