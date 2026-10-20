<?php

declare(strict_types=1);

namespace ContaoLiveEdit\EventListener;

use ContaoLiveEdit\Hook\InlineEditorMarkupHook;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/** Ensures the editor is available on frontend pages regardless of their layout template. */
final class FrontendResponseListener implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::RESPONSE => ['onKernelResponse', -10]];
    }

    public function onKernelResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }

        $request = $event->getRequest();
        if ('frontend' !== $request->attributes->get('_scope')) {
            return;
        }

        $response = $event->getResponse();
        if (!str_contains(strtolower($response->headers->get('Content-Type', '')), 'text/html') || !$response->isSuccessful()) {
            return;
        }

        $content = $response->getContent();
        if (!is_string($content) || !str_contains($content, '<html')) {
            return;
        }

        $response->setContent(InlineEditorMarkupHook::addFrontendTools($content));
    }
}
