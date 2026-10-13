<?php

declare(strict_types=1);

$GLOBALS['TL_HOOKS']['getContentElement'][] = [ContaoLiveEdit\Hook\InlineEditorMarkupHook::class, 'addRecordAttributes'];
$GLOBALS['TL_HOOKS']['outputFrontendTemplate'][] = [ContaoLiveEdit\Hook\InlineEditorMarkupHook::class, 'addFrontendTools'];
