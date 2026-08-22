<?php

declare(strict_types=1);

namespace App\Web;

use JsonException;
use RuntimeException;

final readonly class AssetManifest
{
    public function __construct(
        private string $manifestPath,
        private ?string $developmentOrigin = null,
        private string $publicBase = '/build',
    ) {
    }

    /**
     * @param list<string> $entries
     */
    public function tags(array $entries): string
    {
        if ($this->developmentOrigin !== null) {
            $origin = $this->safeDevelopmentOrigin($this->developmentOrigin);
            $tags = [sprintf('<script type="module" src="%s/@vite/client"></script>', $origin)];

            foreach ($entries as $entry) {
                $tags[] = sprintf(
                    '<script type="module" src="%s/%s"></script>',
                    $origin,
                    $this->escapePath($entry),
                );
            }

            return implode("\n", $tags);
        }

        if (!is_file($this->manifestPath)) {
            return '';
        }

        try {
            $manifest = json_decode(
                (string) file_get_contents($this->manifestPath),
                true,
                flags: JSON_THROW_ON_ERROR,
            );
        } catch (JsonException $exception) {
            throw new RuntimeException('The Vite manifest is invalid.', previous: $exception);
        }
        if (!is_array($manifest)) {
            throw new RuntimeException('The Vite manifest must be an object.');
        }

        $styles = [];
        $scripts = [];
        foreach ($entries as $entry) {
            $asset = $manifest[$entry] ?? null;
            if (!is_array($asset)) {
                throw new RuntimeException(sprintf('Missing Vite manifest entry: %s', $entry));
            }
            $css = $asset['css'] ?? [];
            if (!is_array($css)) {
                throw new RuntimeException(sprintf('Invalid Vite CSS entry: %s', $entry));
            }
            foreach ($css as $stylesheet) {
                if (!is_string($stylesheet)) {
                    throw new RuntimeException(sprintf('Invalid Vite CSS path: %s', $entry));
                }
                $styles[$stylesheet] = true;
            }
            $file = $asset['file'] ?? null;
            if (is_string($file)) {
                if (str_ends_with($file, '.css')) {
                    $styles[$file] = true;
                } elseif (str_ends_with($file, '.js')) {
                    $scripts[$file] = true;
                }
            }
        }

        $tags = [];
        foreach (array_keys($styles) as $stylesheet) {
            $tags[] = sprintf('<link rel="stylesheet" href="%s">', $this->publicAssetUrl($stylesheet));
        }
        foreach (array_keys($scripts) as $script) {
            $tags[] = sprintf('<script type="module" src="%s"></script>', $this->publicAssetUrl($script));
        }

        return implode("\n", $tags);
    }

    private function safeDevelopmentOrigin(string $origin): string
    {
        $parts = parse_url($origin);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $safeScheme = in_array($parts['scheme'] ?? null, ['http', 'https'], true);
        $safeHost = in_array($host, ['127.0.0.1', 'localhost'], true);
        if (!$safeScheme || !$safeHost) {
            throw new RuntimeException('VITE_DEV_SERVER must use localhost or 127.0.0.1.');
        }

        return rtrim(htmlspecialchars($origin, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8'), '/');
    }

    private function escapePath(string $path): string
    {
        if (str_contains($path, '..') || str_starts_with($path, '/') || str_contains($path, "\0")) {
            throw new RuntimeException('Unsafe asset path.');
        }

        return htmlspecialchars($path, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }

    private function publicAssetUrl(string $path): string
    {
        if (str_contains($this->publicBase, '..') || str_contains($this->publicBase, "\0")) {
            throw new RuntimeException('Unsafe public asset base.');
        }

        $base = '/' . trim($this->publicBase, '/');

        return $base . '/' . $this->escapePath($path);
    }
}
