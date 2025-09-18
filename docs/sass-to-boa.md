# Migrating from Sass/SCSS to Boa

Boa borrows the indentation-driven ergonomics of the original Sass syntax, but targets modern CSS directly. The compiler itself is a single zero-dependency Bun script. This guide highlights the differences between Sass/SCSS and Boa, and offers migration tips so you can adapt existing codebases quickly.

## 1. Syntax Overview

| Concept | Sass/SCSS | Boa |
| --- | --- | --- |
| File extension | `.sass` / `.scss` | `.boa` |
| Structure | Indentation (`.sass`) or braces (`.scss`) | Indentation only |
| Comments | `//`, `/* */` | `//`, `/* */` (emitted unless minified) |
| Variables | `$name: value` | `$name: value` → CSS custom property |
| Constants | `!default`, `$const` mixins | `$name: value !const` |
| Nesting | `parent
  child` | Same, emits native CSS nesting |
| Mixins / functions | `@mixin`, `@include` | (Not yet) |
| Imports | `@use`, `@import` | (Not yet) |
| Control flow | `@if`, `@for` | (Not yet) |

Boa intentionally focuses on the subset of Sass features that map cleanly to native CSS capabilities, offering a lighter layer over the platform.

## 2. Variables → CSS Custom Properties

### Sass

```sass
$primary: #0d9488

.button
  background: $primary
```

### Boa

```boa
$primary: #0d9488

.button
  background: $primary
```

**Output**

```css
:root {
  --primary: #0d9488;
}

.button {
  background: var(--primary);
}
```

Boa always emits variables as CSS custom properties (unless marked `!const`). Global declarations land in `:root`; scoped declarations produce rule-level custom properties.

## 3. Compile-Time Constants

Sass uses mixins and `!default` for configuration tokens. Boa offers explicit constants:

```boa
$bp-desktop: 60rem !const

.container
  max-width: $bp-desktop
  @media (min-width: $bp-desktop)
    padding-inline: 4rem
```

Constants are resolved at compile time and never emit custom properties.

## 4. Nesting & Selector Differences

Boa targets the CSS Nesting Module syntax. Some nesting behaviours differ from SCSS:

- Nested selectors are emitted using the `&` interpolation automatically.
- Custom alias `:hocus` expands to `:is(:hover, :focus-within)` for accessible hover/focus states.
- `.parent .child` written on separate lines becomes `& .child` in the output.

Example:

```boa
.card
  .title
    font-weight: 600

  &:hocus
    transform: translateY(-4px)
```

Outputs:

```css
.card {
  & .title {
    font-weight: 600;
  }
  @media (hover: hover) {
    &:is(:hover, :focus-within) {
      transform: translateY(-4px);
    }
  }
}
```

## 5. Hover Guard vs. `a:focus`

Sass often includes manual fixes for iOS double-tap issues. Boa wraps any selector containing `:hover` (including `:hocus`) inside `@media (hover: hover)` by default. Disable this with `--no-hover-guard` if you need raw output.

## 6. At-Rules and Modern CSS Features

Boa supports nested `@media`, `@supports`, `@container`, and custom at-rules. Parameter expressions can use variables or constants. Future work will layer sugar for `@layer`, `@scope`, and `@property` (see `docs/boa.md`).

## 7. Missing (for now) Sass Features

| Sass Feature | Boa Status |
| --- | --- |
| Mixins / `@include` | Planned. Use constants + nesting for now. |
| Functions (`@function`) | Not yet supported. Consider JS post-processing. |
| Control directives (`@if`, `@for`, `@each`) | Not supported. Use modern CSS where possible (`:has`, `@container`, etc.). |
| Module system (`@use`, `@forward`) | Not yet. Structure projects with multiple `.boa` files and run the CLI per entry. |

## 8. CLI Migration Tips

Replace your Sass compiler commands with Boa’s zero-dependency Bun CLI:

```sh
# Sass
sass src/styles/app.sass dist/app.css --watch

# Boa
bun run src/cli.js -w src/styles/app.boa dist/app.css
```

Flags:

- `-m/--minify` → Similar to Sass’s `--style=compressed`.
- `--no-hover-guard` → Opt out of the automatic hover media query.
- `-w/--watch` → Recompile on file changes (single-file watch).

## 9. Migration Workflow

1. **Rename files**: change `.sass`/`.scss` to `.boa`. Convert SCSS braces to indentation if necessary (you can use `sass-convert` to `.sass` first).
2. **Review variables**: decide which should become constants (`!const`) versus CSS custom properties.
3. **Remove mixins / functions**: inline or replace with native CSS features. Add TODOs for future Boa enhancements if needed.
4. **Check hover/focus states**: replace manual `:hover, :focus` combos with `:hocus` for clarity.
5. **Run the CLI**: `bun run src/cli.js <file>`. Use `-m` to verify minified output.
6. **Audit output**: Boa emits native nested CSS. Ensure your pipeline (PostCSS, bundler) can handle the output or transpile further for legacy browsers.

## 10. Helpful Resources

- [docs/boa.md](./boa.md) – Complete language spec & CLI reference.
- `examples/` – Real `.boa` inputs with generated CSS.
- `tests/compiler.test.js` – Behavioural tests you can replicate when extending the language.

Boa aims to complement modern CSS, not replace it. Keep an eye on the project roadmap (see `README.md`) for upcoming features like `@layer` sugar or mixins, and share feedback via issues/prs.
