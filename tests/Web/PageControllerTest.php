<?php

declare(strict_types=1);

namespace Tests\Web;

use App\Web\AssetManifest;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

final class PageControllerTest extends TestCase
{
    public function testHomePageRendersTheCanonicalSectionStructure(): void
    {
        /** @var \Closure(Request): Response $handle */
        $handle = require dirname(__DIR__, 2) . '/bootstrap/app.php';
        $response = $handle(Request::create('/'));

        self::assertSame(200, $response->getStatusCode());
        self::assertStringContainsString('<section class="section section--hero"', (string) $response->getContent());
        self::assertStringContainsString('<div class="container">', (string) $response->getContent());
        self::assertStringContainsString('<div class="section-contents">', (string) $response->getContent());
    }

    public function testUnknownPageReturnsNotFound(): void
    {
        /** @var \Closure(Request): Response $handle */
        $handle = require dirname(__DIR__, 2) . '/bootstrap/app.php';
        $response = $handle(Request::create('/missing'));

        self::assertSame(404, $response->getStatusCode());
    }

    public function testProductionAssetsUseThePublicBuildBase(): void
    {
        $manifestPath = tempnam(sys_get_temp_dir(), 'foundation-manifest-');
        self::assertIsString($manifestPath);

        try {
            file_put_contents($manifestPath, json_encode([
                'resource/ts/main.ts' => [
                    'file' => 'assets/main.js',
                    'css' => [],
                ],
                'resource/scss/main.scss' => [
                    'file' => 'assets/main.css',
                ],
            ], JSON_THROW_ON_ERROR));

            $tags = (new AssetManifest($manifestPath))->tags([
                'resource/ts/main.ts',
                'resource/scss/main.scss',
            ]);

            self::assertStringContainsString('href="/build/assets/main.css"', $tags);
            self::assertStringContainsString('src="/build/assets/main.js"', $tags);
        } finally {
            if (is_file($manifestPath)) {
                unlink($manifestPath);
            }
        }
    }
}
