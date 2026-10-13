<?php

declare(strict_types=1);

namespace ContaoLiveEdit;

use Symfony\Component\HttpKernel\Bundle\Bundle;

final class ContaoLiveEditBundle extends Bundle
{
    public function getPath(): string
    {
        return dirname(__DIR__);
    }
}
