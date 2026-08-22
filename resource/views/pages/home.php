<?php

declare(strict_types=1);

/** @var Closure(string|int|float|Stringable|null): string $e */
?>
<section class="section section--hero" aria-labelledby="home-title">
    <div class="container">
        <div class="inner">
            <header class="section-header">
                <p class="eyebrow">PHP site starter</p>
                <h1 id="home-title" class="section-title"><?= $e($title ?? '') ?></h1>
                <div class="section-body">
                    <p><?= $e($description ?? '') ?></p>
                </div>
            </header>
            <div class="section-contents">
                <article class="card">
                    <h2 class="card__title">Small by default</h2>
                    <p class="card__body">Add pages and capabilities only when the project proves they are needed.</p>
                </article>
            </div>
        </div>
    </div>
</section>
