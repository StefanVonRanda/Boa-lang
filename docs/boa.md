# Boa Language Guide

Boa is an indentation-based stylesheet language inspired by the original Sass syntax, designed to compile down to modern nested CSS with first-class support for CSS variables, native nesting, and contemporary features like container queries. The compiler ships as a zero-dependency Bun CLI. This guide covers the language features, compiler behaviour, and CLI usage.

## Quick Start

```sh
# Compile a Boa file to CSS
bun run boa input.boa output.css

# Pipe from stdin to stdout
bun run boa < input.boa

# Produce minified output (comments removed, whitespace collapsed)
bun run boa -m input.boa output.min.css

# Watch a file and rebuild on change
bun run boa -w input.boa output.css

# Disable the default hover guard if you need raw :hover selectors
bun run boa --no-hover-guard input.boa output.css
```

Example input (`examples/button.boa`):

```boa
$primary: #0d9488
$primary-hover: #0f766e

.button
  display: inline-flex
  gap: 0.5rem
  background: $primary
  color: white

  &:hocus
    background: $primary-hover
```

Output (`examples/button.css`):

```css
:root {
  --primary: #0d9488;
  --primary-hover: #0f766e;
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--primary);
  color: white;
  @media (hover: hover) {
    &:is(:hover, :focus-within) {
      background: var(--primary-hover);
    }
  }
}
```

## Syntax Basics

### Indentation Rules

- Files must use indentation for structure (`.boa` uses spaces by default). Tabs are supported but the entire file must choose one style; mixing spaces and tabs results in a compilation error.
- Indentation increases by a single step per nesting level. Skipping levels or partial indentation raises an error.
- Blank lines are ignored; comments may appear on their own line or inline.

### Comments

- Single-line comments begin with `//` and extend to the end of the line.
- Block comments use `/* ... */` and may appear inline.
- The compiler emits comments verbatim in formatted mode. Running with `-m`/`--minify` strips them.

## Variables and Constants

Boa provides two kinds of symbols starting with `$name`:

| Syntax                  | Behaviour                                                        |
| ----------------------- | ----------------------------------------------------------------- |
| `$color: #333`          | Emitted as a CSS custom property (`--color`) scoped to the block. |
| `$breakpoint: 60rem !const` | Compile-time constant. Inlined wherever referenced, no CSS variable generated. |

### CSS Variable Declarations

- `$name: value` within `:root` globals become entries inside `:root` and are referenced via `var(--name)`.
- When declared inside a rule, the generated custom property is scoped inside that rule.
- Variable values may reference other `$name`s; references resolve to `var(--name)` (or a constant if defined as such).

### Constants

- Append `!const` to a declaration to mark it as compile-time only.
- Constants do not create CSS output; instead, every `$name` reference is replaced with the literal value.
- Constants obey lexical scope. Declaring inside a rule confines the constant to that block and descendants.
- Useful for breakpoints, z-index tokens, spacing scales, etc. Example:

```boa
$bp-desktop: 60rem !const

.container
  max-width: $bp-desktop

  @media (min-width: $bp-desktop)
    padding-inline: 4rem
```

## Rules and Nesting

- Selectors end at the line break. Nested rules inherit the parent by default via CSS nesting (`&`).
- Use the ampersand to refer to the immediate parent selector. Boa automatically prefixes nested selectors with `&` when a space is required.

```boa
.card
  .title
    font-size: 1.25rem

  &:hover
    transform: translateY(-4px)
```

Generates:

```css
.card {
  & .title {
    font-size: 1.25rem;
  }
  @media (hover: hover) {
    &:is(:hover, :focus-within) {
      transform: translateY(-4px);
    }
  }
}
```

### `:hocus` Alias

Boa adds a convenience pseudo-class `:hocus`, which expands to `:is(:hover, :focus-within)`. This ensures both pointer-hover and keyboard focus (via `:focus-within`) share the same rule. The hover guard still applies automatically because the expanded selector contains `:hover`.

```boa
.link
  &:hocus
    color: tomato

#=>

.link
  @media (hover: hover)
    &:is(:hover, :focus-within)
      color: tomato
```

## At-Rules

- Most at-rules are emitted directly. Boa supports nested blocks, including `@media`, `@supports`, `@container`, and custom at-rules.
- Parameters can reference variables or constants; constants inline their literal values.
- Example container query:

```boa
$bp-desktop: 50rem !const

.layout
  display: grid

  @container (min-width: $bp-desktop)
    grid-template-columns: repeat(3, minmax(0, 1fr))
```

## Automatic Features

### Global Variable Hoisting

Variables defined outside of any selector are hoisted into a `:root` block to behave like CSS custom properties.

### Hover Guard

To avoid iOS Safari's double-tap quirk, selectors containing `:hover` are wrapped in `@media (hover: hover)` by default. This ensures hover styles only apply on devices that support the hover interaction model.

Disable this behaviour with the CLI flag `--no-hover-guard` or programmatically via `compile(source, { hoverGuard: false })`.

### Comments & Formatting

- Comments are preserved in standard output.
- Minified output (`-m`) removes comments and collapses extra whitespace, compressing selector lists, declarations, and function argument spacing while keeping the structure valid nested CSS.

## CLI Reference

| Command / Flag          | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `bun run boa input.boa output.css` | Compile file to file (pretty output).                  |
| `bun run boa -m input.boa output.min.css` | Minify: remove comments and collapse whitespace.        |
| `bun run boa --no-hover-guard input.boa output.css` | Emit raw `:hover` rules without the media guard.          |
| `bun run boa -w input.boa output.css` | Watch the input file and recompile on change (requires file path). |
| `bun run boa`    | Reads from stdin and writes to stdout when no paths supplied.   |

The CLI respects UTF-8 input and will exit with status `1` on syntax errors.

## Minification Details

When `minify` is enabled (via CLI `-m` or programmatically), the compiler:

- Removes comments and blank lines.
- Collapses whitespace around colons, commas, parentheses, and selector separators.
- Joins nested blocks onto single lines while preserving CSS nesting semantics.
- Retains the hover guard (by default) and constant substitutions.

## Examples Directory

The repository ships with ready-made samples in `/examples`:

- `button.boa` & `button.css` – button styling with hover guard.
- `layout.boa` & `layout.css` – layout grid using constants and container queries.
- `final_test.boa`, `final_test.css`, `final_test.min.css` – comprehensive syntax showcase.

Use these files as references when authoring new `.boa` stylesheets.

## Integration Tips

- Treat emitted CSS as nested CSS; modern browsers supporting the nesting module can consume it directly. For broader compatibility, consider running the generated CSS through PostCSS with a nesting plugin.
- Keep constants for tokens that should remain literals, and use standard variables for values you expect to override via native CSS custom properties at runtime.
- Combine Boa with Bun's bundler or a watcher script to rebuild styles on file changes.

## Future Directions

Planned improvements include:

1. First-class sugar for `@layer`, `@scope`, and `@property` declarations.
2. Optional default values (`!default`) for CSS-variable declarations.
3. A watch mode and richer CLI ergonomics.
4. Modular include / import semantics and expression helpers.

Feedback and contributions are welcome—feel free to prototype new syntax in the `examples/` directory and extend the test suite in `tests/compiler.test.js`.
