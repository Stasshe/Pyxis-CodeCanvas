import { UnixCommandBase } from './base';

export class AwkCommand extends UnixCommandBase {
  prepare(args: string[]): (input: string) => string {
    let fieldSeparator: RegExp | null = null;
    let program = '';
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '-F') {
        const separator = args[index + 1];
        if (separator === undefined) throw new Error('awk: option requires an argument: -F');
        fieldSeparator = new RegExp(escapeRegExp(separator));
        index += 1;
      } else if (args[index].startsWith('-F')) {
        fieldSeparator = new RegExp(escapeRegExp(args[index].slice(2)));
      } else if (!program) {
        program = args[index];
      } else {
        throw new Error('awk: file input is not supported');
      }
    }

    const action = /^\{\s*print\s+(.+?)\s*\}$/.exec(program);
    if (!action) throw new Error('awk: supported syntax is {print expression}');
    const expressions = action[1].split(',').map(expression => expression.trim());
    return input => {
      const records = input
        .split(/\r?\n/)
        .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
      const output = records
        .map(line => {
          let fields: string[] = [];
          if (fieldSeparator) {
            fields = line.split(fieldSeparator);
          } else if (line.trim() !== '') {
            fields = line.trim().split(/\s+/);
          }
          return expressions
            .map(expression => evaluateExpression(expression, fields, line))
            .join(' ');
        })
        .join('\n');
      if (input.length > 0) return `${output}\n`;
      return output;
    };
  }

  execute(args: string[], input: string): string {
    return this.prepare(args)(input);
  }
}

function evaluateExpression(expression: string, fields: string[], record: string): string {
  const operation =
    /^(\$\d+|(?:\d+(?:\.\d*)?|\.\d+))\s*([+*/-])\s*(\$\d+|(?:\d+(?:\.\d*)?|\.\d+))$/.exec(
      expression
    );
  if (operation) {
    const left = numericValue(operation[1], fields, record);
    const right = numericValue(operation[3], fields, record);
    if (operation[2] === '+') return String(left + right);
    if (operation[2] === '-') return String(left - right);
    if (operation[2] === '*') return String(left * right);
    if (right === 0) throw new Error('awk: division by zero');
    return String(left / right);
  }
  if (/^\$\d+$/.test(expression)) return fieldValue(expression, fields, record);
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(expression)) return expression;
  const literal = /^(['"])(.*)\1$/.exec(expression);
  if (literal) return literal[2];
  throw new Error(`awk: unsupported expression: ${expression}`);
}

function numericValue(expression: string, fields: string[], record: string): number {
  let value = expression;
  if (/^\$\d+$/.test(expression)) value = fieldValue(expression, fields, record);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`awk: non-numeric value: ${value}`);
  return number;
}

function fieldValue(expression: string, fields: string[], record: string): string {
  const index = Number(expression.slice(1));
  if (index === 0) return record;
  return fields[index - 1] ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
