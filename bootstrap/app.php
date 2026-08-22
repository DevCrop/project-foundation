<?php

declare(strict_types=1);

use App\Web\AssetManifest;
use App\Web\PageController;
use App\Web\ViewRenderer;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Exception\MethodNotAllowedException;
use Symfony\Component\Routing\Exception\ResourceNotFoundException;
use Symfony\Component\Routing\Matcher\UrlMatcher;
use Symfony\Component\Routing\RequestContext;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

$projectRoot = dirname(__DIR__);
/** @var array<string, array{path: string, view: string, title: string, description: string, assets: list<string>}> $pages */
$pages = require $projectRoot . '/config/pages.php';
$routes = new RouteCollection();

foreach ($pages as $pageId => $page) {
    $routes->add(
        $pageId,
        new Route(
            path: $page['path'],
            defaults: ['_page' => $pageId],
            methods: ['GET', 'HEAD'],
        ),
    );
}

$renderer = new ViewRenderer(
    viewRoot: $projectRoot . '/resource/views',
    assets: new AssetManifest(
        manifestPath: $projectRoot . '/public/build/.vite/manifest.json',
        developmentOrigin: getenv('VITE_DEV_SERVER') ?: null,
        publicBase: '/build',
    ),
);
$controller = new PageController($renderer, $pages);

return static function (Request $request) use ($routes, $controller): Response {
    $context = (new RequestContext())->fromRequest($request);
    $matcher = new UrlMatcher($routes, $context);

    try {
        $parameters = $matcher->match($request->getPathInfo());
        $pageId = $parameters['_page'] ?? null;
        if (!is_string($pageId)) {
            return new Response('Not Found', Response::HTTP_NOT_FOUND);
        }

        return $controller($request, $pageId);
    } catch (ResourceNotFoundException) {
        return new Response(
            'Not Found',
            Response::HTTP_NOT_FOUND,
            ['content-type' => 'text/plain; charset=UTF-8'],
        );
    } catch (MethodNotAllowedException) {
        return new Response(
            'Method Not Allowed',
            Response::HTTP_METHOD_NOT_ALLOWED,
            ['content-type' => 'text/plain; charset=UTF-8'],
        );
    }
};
