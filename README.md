# Boa Lang

Indentation-first CSS preprocessor for Bun. Zero dependencies, zero runtime, just native nested CSS.

## Highlights
- Familiar `.sass`-style indentation that compiles straight to the CSS Nesting Module.
- `$name: value` becomes scoped CSS custom properties; add `!const` to inline tokens at compile time.
- Built-in `:hocus` → `:is(:hover, :focus-within)` alias and automatic hover guards for iOS Safari.
- Handles modern at-rules (`@media`, `@supports`, `@container`) with constant-aware parameters.
- Ships as a single zero-dependency Bun CLI—drop it in and run.

## Quick Start
```sh
# compile a file
bun run boa examples/button.boa examples/button.css

# pipe from stdin / to stdout
bun run boa <<'EOF'
$primary: #333
.button
  color: $primary
EOF

# minify output (remove comments, collapse whitespace)
bun run boa -m examples/button.boa examples/button.min.css

# watch and rebuild on change
bun run boa -w examples/button.boa examples/button.css
```

## Development
```sh
bun test
```

## Documentation
- Language guide: [docs/boa.md](docs/boa.md)
- Sass → Boa migration: [docs/sass-to-boa.md](docs/sass-to-boa.md)

See `examples/` for complete inputs and outputs.

## Notes
- Use a single indentation style (spaces or tabs); mixing styles is a compile error.
- Property declarations need a space after `:` to distinguish from pseudo-classes.
- Comments are preserved by default; pass `-m`/`--minify` to strip them.
- Hover media guard can be disabled with `--no-hover-guard` when needed.

## License

0BSD ♥ StefanVonRanda
