<?php

declare(strict_types=1);

namespace ContaoLiveEdit\Controller;

use Contao\BackendUser;
use Contao\CoreBundle\Security\Authentication\Token\TokenChecker;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

final class EditorController extends AbstractController
{
    public function __construct(private TokenChecker $tokenChecker)
    {
    }

    public function __invoke(Request $request): Response
    {
        if (!$request->hasPreviousSession() || !$this->tokenChecker->hasBackendUser() || !BackendUser::getInstance()?->isAdmin) {
            throw $this->createAccessDeniedException('Sign in to Contao as an administrator to use the visual editor.');
        }

        return $this->render('@ContaoLiveEdit/editor.html.twig');
    }
}
