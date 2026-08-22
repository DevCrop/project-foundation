<?php

declare(strict_types=1);

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

require dirname(__DIR__) . '/vendor/autoload.php';

/** @var Closure(Request): Response $handle */
$handle = require dirname(__DIR__) . '/bootstrap/app.php';
$handle(Request::createFromGlobals())->send();
