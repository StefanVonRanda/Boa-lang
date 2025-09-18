import { expect, test } from 'bun:test';
import { compile, SassCompilerError } from '../src/compiler.js';

test('global variables are moved to :root and referenced with var()', () => {
  const input = `$primary: #333
body
  color: $primary`;

  const css = compile(input);

  expect(css).toContain(':root');
  expect(css).toContain('--primary: #333;');
  expect(css).toContain('color: var(--primary);');
});

test('nested selectors receive & prefix when parent exists', () => {
  const input = `.card
  .title
    color: red
  &:hover
    color: blue`;

  const css = compile(input);

  expect(css).toContain('.card {');
  expect(css).toContain(`& .title {
    color: red;
  }`);
  expect(css).toMatch(/@media \(hover: hover\)\s*{\s*&:hover\s*{\s*color: blue;/);
});

test('variables declared inside rules stay scoped to selector', () => {
  const input = `.wrapper
  $space: 1rem
  padding: $space`;

  const css = compile(input);

  expect(css).toContain('.wrapper {');
  expect(css).toContain('--space: 1rem;');
  expect(css).toContain('padding: var(--space);');
  expect(css).not.toMatch(/:root[^}]*--space/);
});

test('mixing spaces and tabs in indentation throws', () => {
  const input = `.wrapper
  .item
	color: red`;

  expect(() => compile(input)).toThrow(SassCompilerError);
});

test('comments are preserved unless minify is enabled', () => {
  const input = `// heading banner
button
  color: blue // important`;

  const css = compile(input);
  expect(css).toContain('/* heading banner */');
  expect(css).toContain('color: blue; /* important */');

  const minified = compile(input, { minify: true });
  expect(minified).not.toContain('heading banner');
  expect(minified).not.toContain('important');
  expect(minified).toContain('color:blue;');
  expect(minified).not.toContain('\n');
  expect(minified).not.toContain(': ');
});

test('hover guard wraps hover selectors in media query by default', () => {
  const input = `.link
  &:hover
    color: red`;

  const css = compile(input);
  expect(css).toContain('@media (hover: hover)');
  expect(css).toMatch(/@media \(hover: hover\)\s*{\s*&:hover\s*{\s*color: red;/);

  const noGuard = compile(input, { hoverGuard: false });
  expect(noGuard).not.toContain('@media (hover: hover)');
});

test('constants expand to literal values and do not emit custom properties', () => {
  const input = `$bp-desktop: 60rem !const
.shell
  max-width: $bp-desktop

  @media (min-width: $bp-desktop)
    padding-inline: 4rem`;

  const css = compile(input);
  expect(css).toContain('max-width: 60rem;');
  expect(css).toContain('@media (min-width: 60rem)');
  expect(css).not.toContain('--bp-desktop');
});

test(':hocus expands to :is(:hover, :focus-within)', () => {
  const input = `.cta
  &:hocus
    text-decoration: underline`;

  const css = compile(input);
  expect(css).toMatch(/@media \(hover: hover\)\s*{\s*&:is\(:hover, :focus-within\)\s*{\s*text-decoration: underline;/);

  const minified = compile(input, { minify: true });
  expect(minified).toContain('@media(hover:hover){&:is(:hover, :focus-within){text-decoration:underline;}}');
});
