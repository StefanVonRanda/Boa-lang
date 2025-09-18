export class SassCompilerError extends Error {
  constructor(message, index) {
    super(`${message} (at ${index})`);
    this.name = 'SassCompilerError';
    this.index = index;
  }
}

export function compile(source, options = {}) {
  const indent = options.indent ?? '  ';
  const rootSelector = options.rootSelector ?? ':root';
  const minify = options.minify ?? false;
  const hoverGuard = options.hoverGuard ?? true;

  const parser = new Parser(source, { minify });
  const ast = parser.parseStylesheet();

  const generator = new Generator(indent, rootSelector, { minify, hoverGuard });
  return generator.generate(ast);
}

class Parser {
  constructor(rawInput, settings = {}) {
    this.minify = settings.minify ?? false;
    const normalized = rawInput.replace(/\r\n?/g, '\n');
    const prepared = this.minify ? stripComments(normalized) : normalized;
    this.lines = prepared.split('\n');
    this.indentStyle = null;
  }

  parseStylesheet() {
    const nodes = [];
    const stack = [createContext(0, nodes)];
    let indentWidth = null;
    let offset = 0;

    for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex++) {
      const line = this.lines[lineIndex];
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        offset += line.length + 1;
        continue;
      }

      const { indent, style } = countIndent(line, offset, indentWidth, this.indentStyle);

      if (style && indent > 0) {
        if (this.indentStyle === null) {
          this.indentStyle = style;
        } else if (this.indentStyle !== style) {
          throw new SassCompilerError('Indentation mixes tabs and spaces', offset);
        }
      }

      if (indentWidth !== null && indent > 0 && indent % indentWidth !== 0) {
        throw new SassCompilerError('Indentation is not a multiple of the base indent', offset);
      }

      while (stack.length > 1 && indent < stack[stack.length - 1].indent) {
        stack.pop();
      }

      let current = stack[stack.length - 1];
      if (indent > current.indent) {
        if (!canNest(current.lastNode)) {
          throw new SassCompilerError('Unexpected indentation', offset);
        }
        if (indentWidth === null) {
          indentWidth = indent - current.indent;
        }
        const expectedIndent = current.indent + indentWidth;
        if (indent !== expectedIndent) {
          throw new SassCompilerError('Indentation jump must increase by one level', offset);
        }
        const blockNode = current.lastNode;
        stack.push(createContext(indent, blockNode.children));
        current = stack[stack.length - 1];
      } else if (indent !== current.indent) {
        throw new SassCompilerError('Indented block not properly closed', offset);
      }

      let content = trimmed;
      let consumedLength = line.length + 1;

      while (content.endsWith(',') && lineIndex + 1 < this.lines.length) {
        const nextLine = this.lines[lineIndex + 1];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed.length === 0) {
          break;
        }
        const nextOffset = offset + consumedLength;
        const { indent: nextIndent, style: nextStyle } = countIndent(nextLine, nextOffset, indentWidth, this.indentStyle ?? style);
        if (nextStyle && indent > 0) {
          const globalStyle = this.indentStyle ?? style;
          if (globalStyle === null) {
            this.indentStyle = nextStyle;
          } else if (globalStyle !== nextStyle) {
            throw new SassCompilerError('Indentation mixes tabs and spaces', nextOffset);
          }
        }
        if (nextIndent !== indent) {
          break;
        }
        content = `${content.slice(0, -1).trimEnd()}, ${nextTrimmed}`;
        consumedLength += nextLine.length + 1;
        lineIndex += 1;
      }

      const node = this.parseLine(content, offset);
      if (node) {
        current.nodes.push(node);
        current.lastNode = node;
      }

      offset += consumedLength;
    }

    return nodes;
  }

  parseLine(content, index) {
    let comment = null;
    let main = content;
    if (!this.minify) {
      const extracted = extractComment(content);
      main = extracted.main.trim();
      comment = extracted.comment;
    } else {
      main = content.trim();
    }

    if (main.length === 0) {
      if (!this.minify && comment) {
        return {
          type: 'comment',
          comment,
        };
      }
      return null;
    }

    content = main;

    if (content.startsWith('$')) {
      const colonIndex = content.indexOf(':');
      if (colonIndex === -1) {
        throw new SassCompilerError('Expected ":" after variable name', index);
      }
      const name = content.slice(1, colonIndex).trim();
      if (!name) {
        throw new SassCompilerError('Variable name cannot be empty', index);
      }
      let rawValue = content.slice(colonIndex + 1).trim();
      let constant = false;
      const constMatch = rawValue.match(/\s*!const\s*$/);
      if (constMatch) {
        constant = true;
        rawValue = rawValue.slice(0, constMatch.index).trim();
      }
      const node = {
        type: 'variable',
        name,
        value: rawValue,
        constant,
      };
      if (comment) {
        node.comment = comment;
      }
      return node;
    }

    if (content.startsWith('@')) {
      const rest = content.slice(1).trim();
      const match = rest.match(/^([a-zA-Z0-9_-]+)([\s\S]*)$/);
      const name = match ? match[1] : '';
      const params = match ? match[2].trim() : '';
      const node = {
        type: 'at-rule',
        name,
        params,
        children: [],
      };
      if (comment) {
        node.comment = comment;
      }
      return node;
    }

    const colonIndex = findTopLevelColon(content);
    if (colonIndex !== -1 && isDeclarationColon(content, colonIndex)) {
      const property = content.slice(0, colonIndex).trim();
      const value = content.slice(colonIndex + 1).trim();
      if (!property) {
        throw new SassCompilerError('Declaration missing property name', index);
      }
      if (!value) {
        throw new SassCompilerError('Declaration missing value', index);
      }
      const node = {
        type: 'declaration',
        property,
        value,
      };
      if (comment) {
        node.comment = comment;
      }
      return node;
    }

    const node = {
      type: 'rule',
      selector: content,
      children: [],
    };
    if (comment) {
      node.comment = comment;
    }
    return node;
  }
}

class Generator {
  constructor(indent, rootSelector, settings = {}) {
    this.lines = [];
    this.globalVariables = [];
    this.indent = indent;
    this.rootSelector = rootSelector;
    this.minify = settings.minify ?? false;
    this.hoverGuard = settings.hoverGuard ?? true;
    this.constantStack = [new Map()];
  }

  generate(nodes) {
    this.emitNodes(nodes, 0, []);

    const chunks = [];

    if (this.globalVariables.length > 0) {
      if (this.minify) {
        chunks.push(`${this.rootSelector}{${this.globalVariables.join('')}}`);
      } else {
        chunks.push(`${this.rootSelector} {`);
        for (const line of this.globalVariables) {
          chunks.push(`${this.indent}${line}`);
        }
        chunks.push('}');
        if (this.lines.length > 0) {
          chunks.push('');
        }
      }
    }

    chunks.push(...this.lines);

    if (this.minify) {
      return chunks.join('');
    }

    return chunks.join('\n') + '\n';
  }

  emitNodes(nodes, depth, selectorStack) {
    for (const node of nodes) {
      switch (node.type) {
        case 'declaration':
          this.emitDeclaration(node, depth);
          break;
        case 'variable':
          this.emitVariable(node, depth, selectorStack);
          break;
        case 'rule':
          this.emitRule(node, depth, selectorStack);
          break;
        case 'at-rule':
          this.emitAtRule(node, depth, selectorStack);
          break;
        case 'comment':
          this.emitComment(node, depth);
          break;
        default:
          break;
      }
    }
  }

  emitDeclaration(node, depth) {
    const indent = this.minify ? '' : this.indent.repeat(depth);
    const valueRaw = this.substitute(node.value);
    const value = this.minify ? minifyValue(valueRaw) : valueRaw;
    let line = `${indent}${node.property}${this.minify ? ':' : ': '}${value};`;
    if (!this.minify && node.comment) {
      line += ` ${renderComment(node.comment)}`;
    }
    this.lines.push(line);
  }

  emitVariable(node, depth, selectorStack) {
    if (node.constant) {
      const resolved = this.substitute(node.value);
      this.defineConstant(node.name, this.minify ? minifyValue(resolved) : resolved);
      return;
    }

    const valueRaw = this.substitute(node.value);
    const value = this.minify ? minifyValue(valueRaw) : valueRaw;
    let line = `--${node.name}${this.minify ? ':' : ': '}${value};`;
    if (!this.minify && node.comment) {
      line += ` ${renderComment(node.comment)}`;
    }

    if (selectorStack.length === 0 && depth === 0) {
      this.globalVariables.push(line);
    } else {
      const indent = this.minify ? '' : this.indent.repeat(depth);
      this.lines.push(`${indent}${line}`);
    }
  }

  emitRule(node, depth, selectorStack, skipHoverGuard = false) {
    const selector = this.normalizeSelector(node.selector, selectorStack.length > 0);
    const guardHover = this.hoverGuard && !skipHoverGuard && selector.includes(':hover');

    if (guardHover) {
      const indent = this.minify ? '' : this.indent.repeat(depth);
      const mediaOpen = this.minify ? '@media(hover:hover){' : '@media (hover: hover) {';
      this.lines.push(`${indent}${mediaOpen}`);
      this.emitRule(node, depth + 1, selectorStack, true);
      const closingIndent = this.minify ? '' : indent;
      this.lines.push(`${closingIndent}}`);
      return;
    }

    const indent = this.minify ? '' : this.indent.repeat(depth);
    let line = `${indent}${selector}`;
    if (!this.minify && node.comment) {
      line += ` ${renderComment(node.comment)}`;
    }
    line += this.minify ? '{' : ' {';
    this.lines.push(line);
    this.pushConstantScope();
    this.emitNodes(node.children, depth + 1, [...selectorStack, selector]);
    this.popConstantScope();
    const closingIndent = this.minify ? '' : indent;
    this.lines.push(`${closingIndent}}`);
  }

  emitAtRule(node, depth, selectorStack) {
    const indent = this.minify ? '' : this.indent.repeat(depth);
    let headingBase;
    if (node.params) {
      const substituted = this.substitute(node.params);
      if (this.minify) {
        const params = minifyAtRuleParams(substituted);
        const separator = params.length > 0 && !params.startsWith('(') ? ' ' : '';
        headingBase = `@${node.name}${separator}${params}`;
      } else {
        headingBase = `@${node.name} ${substituted}`;
      }
    } else {
      headingBase = `@${node.name}`;
    }
    const heading = !this.minify && node.comment
      ? `${headingBase} ${renderComment(node.comment)}`
      : headingBase;
    if (node.children && node.children.length > 0) {
      this.lines.push(`${indent}${heading}${this.minify ? '{' : ' {'}`);
      this.pushConstantScope();
      this.emitNodes(node.children, depth + 1, selectorStack);
      this.popConstantScope();
      const closingIndent = this.minify ? '' : indent;
      this.lines.push(`${closingIndent}}`);
    } else {
      this.lines.push(`${indent}${heading};`);
    }
  }

  emitComment(node, depth) {
    if (this.minify) {
      return;
    }
    const indent = this.indent.repeat(depth);
    const rendered = renderComment(node.comment);
    this.lines.push(`${indent}${rendered}`);
  }

  normalizeSelector(selector, hasParent) {
    const trimmed = expandPseudoAliases(selector.trim());
    if (!hasParent) {
      if (!this.minify) {
        return trimmed;
      }
      const parts = splitSelectors(trimmed);
      if (parts.length <= 1) {
        return trimmed;
      }
      return parts.map((part) => part.trim()).join(',');
    }

    const parts = splitSelectors(trimmed);
    const rewritten = parts.map((part) => {
      const trimmedPart = expandPseudoAliases(part.trim());
      if (!trimmedPart) {
        return trimmedPart;
      }
      if (trimmedPart.includes('&') || trimmedPart.startsWith('@')) {
        return trimmedPart;
      }
      if (trimmedPart.startsWith(':') || trimmedPart.startsWith('::') || trimmedPart.startsWith('[')) {
        return `&${trimmedPart}`;
      }
      return `& ${trimmedPart}`;
    });

    return rewritten.join(this.minify ? ',' : ', ');
  }

  pushConstantScope() {
    this.constantStack.push(new Map());
  }

  popConstantScope() {
    this.constantStack.pop();
  }

  defineConstant(name, value) {
    const scope = this.constantStack[this.constantStack.length - 1];
    if (!scope.has(name)) {
      scope.set(name, value);
    }
  }

  lookupConstant(name) {
    for (let i = this.constantStack.length - 1; i >= 0; i--) {
      const scope = this.constantStack[i];
      if (scope.has(name)) {
        return scope.get(name);
      }
    }
    return undefined;
  }

  substitute(value) {
    return value.replace(/\$([a-zA-Z0-9_-]+)/g, (_, name) => {
      const constant = this.lookupConstant(name);
      if (constant !== undefined) {
        return constant;
      }
      return `var(--${name})`;
    });
  }
}

function stripComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function splitSelectors(selectorList) {
  const selectors = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let depthRound = 0;
  let depthSquare = 0;

  for (let i = 0; i < selectorList.length; i++) {
    const ch = selectorList[i];

    if (ch === '\'' && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '(') {
        depthRound++;
      } else if (ch === ')') {
        depthRound = Math.max(0, depthRound - 1);
      } else if (ch === '[') {
        depthSquare++;
      } else if (ch === ']') {
        depthSquare = Math.max(0, depthSquare - 1);
      } else if (ch === ',' && depthRound === 0 && depthSquare === 0) {
        selectors.push(current);
        current = '';
        continue;
      }
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    selectors.push(current);
  }

  return selectors;
}

function countIndent(line, offset, indentWidth, indentStyle) {
  let count = 0;
  let styleUsed = null;
  for (const ch of line) {
    if (ch === ' ') {
      if (indentStyle === 'tab') {
        throw new SassCompilerError('Indentation mixes tabs and spaces', offset);
      }
      if (styleUsed && styleUsed !== 'space') {
        throw new SassCompilerError('Indentation mixes tabs and spaces', offset);
      }
      styleUsed = 'space';
      count += 1;
    } else if (ch === '\t') {
      if (indentStyle === 'space') {
        throw new SassCompilerError('Indentation mixes tabs and spaces', offset);
      }
      if (styleUsed && styleUsed !== 'tab') {
        throw new SassCompilerError('Indentation mixes tabs and spaces', offset);
      }
      styleUsed = 'tab';
      const size = indentWidth ?? TAB_SIZE;
      count += size;
    } else {
      break;
    }
  }
  return { indent: count, style: styleUsed };
}

function canNest(node) {
  if (!node) {
    return false;
  }
  return node.type === 'rule' || node.type === 'at-rule';
}

function createContext(indent, nodes) {
  return {
    indent,
    nodes,
    lastNode: null,
  };
}

function extractComment(content) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const prev = content[i - 1];
    if (ch === '\'' && prev !== '\\' && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && prev !== '\\' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      const next = content[i + 1];
      if (ch === '/' && next === '/') {
        const raw = content.slice(i).trim();
        return {
          main: content.slice(0, i).trimEnd(),
          comment: {
            kind: 'line',
            text: raw.slice(2).trim(),
            raw,
          },
        };
      }
      if (ch === '/' && next === '*') {
        const end = content.indexOf('*/', i + 2);
        const raw = end !== -1 ? content.slice(i, end + 2) : content.slice(i);
        const text = end !== -1 ? raw.slice(2, -2).trim() : raw.slice(2).trim();
        return {
          main: content.slice(0, i).trimEnd(),
          comment: {
            kind: 'block',
            text,
            raw: raw.trim(),
          },
        };
      }
    }
  }

  return {
    main: content.trim(),
    comment: null,
  };
}

function renderComment(comment) {
  if (!comment) {
    return '';
  }

  if (comment.kind === 'block') {
    if (comment.raw && comment.raw.trim().startsWith('/*')) {
      const trimmed = comment.raw.trim();
      return trimmed.endsWith('*/') ? trimmed : `${trimmed} */`;
    }
    const text = comment.text ? comment.text.trim() : '';
    return text.length > 0 ? `/* ${text} */` : '/* */';
  }

  const text = comment.text ? comment.text.trim() : '';
  return text.length > 0 ? `/* ${text} */` : '/* */';
}

function findTopLevelColon(content) {
  let inSingle = false;
  let inDouble = false;
  let depthRound = 0;
  let depthSquare = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '\'' && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') {
        depthRound++;
        continue;
      }
      if (ch === ')') {
        depthRound = Math.max(0, depthRound - 1);
        continue;
      }
      if (ch === '[') {
        depthSquare++;
        continue;
      }
      if (ch === ']') {
        depthSquare = Math.max(0, depthSquare - 1);
        continue;
      }
      if (depthRound === 0 && depthSquare === 0 && ch === ':') {
        return i;
      }
    }
  }
  return -1;
}

function isDeclarationColon(content, colonIndex) {
  const next = content[colonIndex + 1];
  return next === ' ' || next === '\t';
}

const TAB_SIZE = 4;

function minifyValue(value) {
  return value
    .replace(/,\s+/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\)\s+/g, ')')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function minifyAtRuleParams(params) {
  return params
    .replace(/,\s+/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\)\s+/g, ')')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function expandPseudoAliases(selector) {
  return selector.replace(/:hocus(?![a-zA-Z0-9_-])/g, ':is(:hover, :focus-within)');
}
