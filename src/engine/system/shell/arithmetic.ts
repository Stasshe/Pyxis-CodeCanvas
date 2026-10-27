type Expression =
  | { kind: 'number'; value: bigint }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operator: string; operand: Expression; postfix: boolean }
  | { kind: 'binary'; operator: string; left: Expression; right: Expression }
  | { kind: 'conditional'; condition: Expression; yes: Expression; no: Expression };

const precedence: Record<string, number> = {
  ',': 1,
  '=': 2,
  '+=': 2,
  '-=': 2,
  '*=': 2,
  '/=': 2,
  '%=': 2,
  '<<=': 2,
  '>>=': 2,
  '&=': 2,
  '^=': 2,
  '|=': 2,
  '||': 4,
  '&&': 5,
  '|': 6,
  '^': 7,
  '&': 8,
  '==': 9,
  '!=': 9,
  '<': 10,
  '<=': 10,
  '>': 10,
  '>=': 10,
  '<<': 11,
  '>>': 11,
  '+': 12,
  '-': 12,
  '*': 13,
  '/': 13,
  '%': 13,
  '**': 14,
};
const assignments = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);

function integer(source: string): bigint {
  const based = source.match(/^(\d+)#([0-9A-Za-z@_]+)$/);
  if (based) {
    const base = Number(based[1]);
    if (base < 2 || base > 64) throw new Error(`${source}: invalid arithmetic base`);
    let result = 0n;
    let alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@_';
    let digits = based[2];
    if (base <= 36) {
      alphabet = alphabet.slice(0, 36);
      digits = digits.toLowerCase();
    }
    for (const digit of digits) {
      const value = alphabet.indexOf(digit);
      if (value < 0 || value >= base) throw new Error(`${source}: value too great for base`);
      result = result * BigInt(base) + BigInt(value);
    }
    return BigInt.asIntN(64, result);
  }
  if (/^0[0-9]+$/.test(source)) {
    if (/[89]/.test(source)) throw new Error(`${source}: value too great for base`);
    return BigInt(`0o${source.slice(1)}`);
  }
  return BigInt.asIntN(64, BigInt(source));
}

class ArithmeticParser {
  private readonly tokens: string[] = [];
  private index = 0;

  constructor(source: string) {
    let offset = 0;
    const pattern =
      /\s+|(?:\d+#[0-9A-Za-z@_]+|0[xX][0-9a-fA-F]+|\d+)|\$?[A-Za-z_][A-Za-z0-9_]*|<<=|>>=|\*\*|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|[-+*/%&^|]=|[-+*/%~!&^|<>=?:(),]/y;
    while (offset < source.length) {
      pattern.lastIndex = offset;
      const match = pattern.exec(source);
      if (!match) throw new Error(`${source}: invalid arithmetic expression`);
      offset = pattern.lastIndex;
      if (match[0].trim()) this.tokens.push(match[0]);
    }
  }

  parse(): Expression {
    if (this.tokens.length === 0) return { kind: 'number', value: 0n };
    const expression = this.expression(1);
    if (this.index !== this.tokens.length) throw new Error('Invalid arithmetic expression');
    return expression;
  }

  private expression(minimum: number): Expression {
    let left = this.operand();
    while (this.index < this.tokens.length) {
      const operator = this.tokens[this.index];
      if (operator === '?' && minimum <= 3) {
        this.index++;
        const yes = this.expression(1);
        if (this.tokens[this.index++] !== ':') throw new Error('Missing arithmetic colon');
        left = { kind: 'conditional', condition: left, yes, no: this.expression(3) };
        continue;
      }
      const level = precedence[operator];
      if (level === undefined || level < minimum) break;
      this.index++;
      let nextMinimum = level + 1;
      if (assignments.has(operator) || operator === '**') nextMinimum = level;
      left = { kind: 'binary', operator, left, right: this.expression(nextMinimum) };
    }
    return left;
  }

  private operand(): Expression {
    const token = this.tokens[this.index++];
    if (!token) throw new Error('Missing arithmetic operand');
    if (['+', '-', '!', '~', '++', '--'].includes(token)) {
      return { kind: 'unary', operator: token, operand: this.operand(), postfix: false };
    }
    let operand: Expression;
    if (token === '(') {
      operand = this.expression(1);
      if (this.tokens[this.index++] !== ')') throw new Error('Missing arithmetic parenthesis');
    } else if (/^\$?[A-Za-z_]/.test(token)) {
      operand = { kind: 'variable', name: token.replace(/^\$/, '') };
    } else if (/^\d/.test(token)) {
      operand = { kind: 'number', value: integer(token) };
    } else {
      throw new Error(`${token}: invalid arithmetic operand`);
    }
    const postfix = this.tokens[this.index];
    if (postfix === '++' || postfix === '--') {
      this.index++;
      return { kind: 'unary', operator: postfix, operand, postfix: true };
    }
    return operand;
  }
}

function binary(operator: string, left: bigint, right: bigint): bigint {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
    case '%':
      if (right === 0n) throw new Error('division by 0');
      if (operator === '/') return left / right;
      return left % right;
    case '**':
      if (right < 0n) throw new Error('exponent less than 0');
      return power(left, right);
    case '<<':
      return left << BigInt.asUintN(6, right);
    case '>>':
      return left >> BigInt.asUintN(6, right);
    case '&':
      return left & right;
    case '^':
      return left ^ right;
    case '|':
      return left | right;
    case '==':
      return BigInt(left === right);
    case '!=':
      return BigInt(left !== right);
    case '<':
      return BigInt(left < right);
    case '<=':
      return BigInt(left <= right);
    case '>':
      return BigInt(left > right);
    case '>=':
      return BigInt(left >= right);
    case ',':
      return right;
    default:
      throw new Error(`${operator}: invalid arithmetic operator`);
  }
}

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  while (exponent > 0n) {
    if ((exponent & 1n) !== 0n) result = BigInt.asIntN(64, result * base);
    base = BigInt.asIntN(64, base * base);
    exponent >>= 1n;
  }
  return result;
}

function evaluate(
  expression: Expression,
  env: Record<string, string>,
  resolving: Set<string>,
  nounset: boolean
): bigint {
  if (expression.kind === 'number') return expression.value;
  if (expression.kind === 'variable') {
    const source = env[expression.name];
    if (source === undefined) {
      if (nounset) throw new Error(`${expression.name}: unbound variable`);
      return 0n;
    }
    if (source === '') return 0n;
    if (resolving.has(expression.name))
      throw new Error(`${expression.name}: recursive arithmetic variable`);
    resolving.add(expression.name);
    const value = evaluate(new ArithmeticParser(source).parse(), env, resolving, nounset);
    resolving.delete(expression.name);
    return value;
  }
  if (expression.kind === 'conditional') {
    if (evaluate(expression.condition, env, resolving, nounset) !== 0n)
      return evaluate(expression.yes, env, resolving, nounset);
    return evaluate(expression.no, env, resolving, nounset);
  }
  if (expression.kind === 'unary') {
    const value = evaluate(expression.operand, env, resolving, nounset);
    switch (expression.operator) {
      case '+':
        return value;
      case '-':
        return BigInt.asIntN(64, -value);
      case '!':
        return BigInt(value === 0n);
      case '~':
        return ~value;
      case '++':
      case '--': {
        if (expression.operand.kind !== 'variable')
          throw new Error('Arithmetic assignment requires a variable');
        let updated = value + 1n;
        if (expression.operator === '--') updated = value - 1n;
        updated = BigInt.asIntN(64, updated);
        env[expression.operand.name] = String(updated);
        if (expression.postfix) return value;
        return updated;
      }
      default:
        throw new Error('Invalid arithmetic operator');
    }
  }
  if (assignments.has(expression.operator)) {
    if (expression.left.kind !== 'variable')
      throw new Error('Arithmetic assignment requires a variable');
    let value = evaluate(expression.right, env, resolving, nounset);
    if (expression.operator !== '=') {
      value = binary(
        expression.operator.slice(0, -1),
        evaluate(expression.left, env, resolving, nounset),
        value
      );
    }
    value = BigInt.asIntN(64, value);
    env[expression.left.name] = String(value);
    return value;
  }
  const left = evaluate(expression.left, env, resolving, nounset);
  if (expression.operator === '&&') {
    if (left === 0n) return 0n;
    return BigInt(evaluate(expression.right, env, resolving, nounset) !== 0n);
  }
  if (expression.operator === '||') {
    if (left !== 0n) return 1n;
    return BigInt(evaluate(expression.right, env, resolving, nounset) !== 0n);
  }
  return BigInt.asIntN(
    64,
    binary(expression.operator, left, evaluate(expression.right, env, resolving, nounset))
  );
}

export function evaluateArithmetic(
  expression: string,
  env: Record<string, string>,
  nounset = false
): string {
  return String(evaluate(new ArithmeticParser(expression).parse(), env, new Set(), nounset));
}
