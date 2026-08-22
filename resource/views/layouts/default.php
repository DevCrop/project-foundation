<?php

declare(strict_types=1);

/** @var Closure(string|int|float|Stringable|null): string $e */
/** @var string $content */
/** @var string $assetTags */
?>
<!doctype html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="<?= $e($description ?? '') ?>">
    <title><?= $e($title ?? '') ?></title>
    <?= $assetTags ?>
</head>
<body>
    <a class="skip-link" href="#main">본문으로 건너뛰기</a>
    <main id="main">
        <?= $content ?>
    </main>
</body>
</html>
