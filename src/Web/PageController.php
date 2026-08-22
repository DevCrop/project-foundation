<?php

declare(strict_types=1);

namespace App\Web;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

final readonly class PageController
{
    /**
     * @param array<
     *     string,
     *     array{path: string, view: string, title: string, description: string, assets: list<string>}
     * > $pages
     */
    public function __construct(
        private ViewRenderer $renderer,
        private array $pages,
    ) {
    }

    public function __invoke(Request $request, string $pageId): Response
    {
        $page = $this->pages[$pageId] ?? null;
        if (!is_array($page)) {
            return new Response('Not Found', Response::HTTP_NOT_FOUND, ['content-type' => 'text/plain; charset=UTF-8']);
        }

        $html = $this->renderer->render(
            (string) $page['view'],
            $page + ['request' => $request],
        );

        return new Response($html, Response::HTTP_OK, ['content-type' => 'text/html; charset=UTF-8']);
    }
}
