<?php

declare(strict_types=1);

namespace App\Web;

use RuntimeException;
use Stringable;

final readonly class ViewRenderer
{
    public function __construct(
        private string $viewRoot,
        private AssetManifest $assets,
    ) {
    }

    /**
     * @param array<string, mixed> $data
     */
    public function render(string $view, array $data, string $layout = 'layouts/default'): string
    {
        $content = $this->include($view, $data);
        $layoutData = $data + [
            'content' => $content,
            'assetTags' => $this->assets->tags($this->assetEntries($data['assets'] ?? [])),
        ];

        return $this->include($layout, $layoutData);
    }

    /**
     * @param array<string, mixed> $data
     */
    private function include(string $view, array $data): string
    {
        if (!preg_match('#^[a-z0-9/_-]+$#', $view)) {
            throw new RuntimeException('Unsafe view name.');
        }

        $file = $this->viewRoot . '/' . $view . '.php';
        if (!is_file($file)) {
            throw new RuntimeException(sprintf('View not found: %s', $view));
        }

        $e = static fn (string|int|float|Stringable|null $value): string => htmlspecialchars(
            (string) $value,
            ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5,
            'UTF-8',
        );

        ob_start();
        try {
            extract($data, EXTR_SKIP);
            require $file;

            return (string) ob_get_clean();
        } catch (\Throwable $throwable) {
            ob_end_clean();
            throw $throwable;
        }
    }

    /**
     * @return list<string>
     */
    private function assetEntries(mixed $entries): array
    {
        if (!is_array($entries)) {
            throw new RuntimeException('Page assets must be a string list.');
        }
        $validated = [];
        foreach ($entries as $entry) {
            if (!is_string($entry)) {
                throw new RuntimeException('Page assets must be a string list.');
            }
            $validated[] = $entry;
        }

        return $validated;
    }
}
