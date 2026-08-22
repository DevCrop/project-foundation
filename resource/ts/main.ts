type Initializer = (root: ParentNode) => void;

const initializers: readonly Initializer[] = [];

function bootstrap(root: ParentNode = document): void {
  for (const initialize of initializers) {
    initialize(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => bootstrap(), { once: true });
} else {
  bootstrap();
}

export { bootstrap };
