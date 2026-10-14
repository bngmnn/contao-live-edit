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
        return new JsonResponse(['path' => $path, 'content' => file_get_contents($file)]);
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
        if (false === file_put_contents($file, $content, LOCK_EX)) return new JsonResponse(['error' => 'Could not write the template. Check file permissions.'], 500);
        $this->invalidateTwigCache();
        return new JsonResponse(['saved' => true, 'path' => $path]);
    }

    private function authorized(Request $request): bool
    {
        return $request->hasPreviousSession() && $this->tokenChecker->hasBackendUser() && (bool) BackendUser::getInstance()?->isAdmin;
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
