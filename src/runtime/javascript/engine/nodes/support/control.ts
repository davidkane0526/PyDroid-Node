type Token = { kind: "number" | "name" | "operator" | "eof"; text: string; value?: number };
type LogicValue = number | boolean;

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const operators = ["**", "//", "<=", ">=", "==", "!=", "+", "-", "*", "/", "%", "(", ")", "<", ">"];
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const numberMatch = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      const value = Number(numberMatch[0]);
      if (!Number.isFinite(value)) throw new Error("Control expression contains an invalid number");
      tokens.push({ kind: "number", text: numberMatch[0], value });
      index += numberMatch[0].length;
      continue;
    }
    const nameMatch = expression.slice(index).match(/^[A-Za-z_]\w*/);
    if (nameMatch) {
      tokens.push({ kind: "name", text: nameMatch[0] });
      index += nameMatch[0].length;
      continue;
    }
    const operator = operators.find((candidate) => expression.startsWith(candidate, index));
    if (!operator) throw new Error(`Unsupported control-expression token near ${JSON.stringify(expression.slice(index, index + 8))}`);
    tokens.push({ kind: "operator", text: operator });
    index += operator.length;
  }
  tokens.push({ kind: "eof", text: "" });
  return tokens;
}

class LogicParser {
  private index = 0;
  private readonly tokens: Token[];
  private readonly value: number;
  private readonly iteration: number;

  constructor(tokens: Token[], value: number, iteration: number) {
    this.tokens = tokens;
    this.value = value;
    this.iteration = iteration;
  }

  private current(): Token { return this.tokens[this.index]; }
  private match(text: string): boolean {
    if (this.current().text !== text) return false;
    this.index += 1;
    return true;
  }
  private expect(text: string): void {
    if (!this.match(text)) throw new Error(`Expected ${text} in control expression`);
  }
  private number(candidate: LogicValue): number {
    if (typeof candidate !== "number") throw new Error("Arithmetic operands must be numbers");
    return candidate;
  }

  parse(): LogicValue {
    const result = this.parseOr(true);
    if (this.current().kind !== "eof") throw new Error(`Unexpected token ${this.current().text} in control expression`);
    return result;
  }

  private parseOr(evaluate: boolean): LogicValue {
    let left = this.parseAnd(evaluate);
    while (this.current().kind === "name" && this.current().text.toLowerCase() === "or") {
      this.index += 1;
      if (evaluate && Boolean(left)) {
        this.parseAnd(false);
        left = true;
      } else {
        const right = this.parseAnd(evaluate);
        if (evaluate) left = Boolean(left) || Boolean(right);
      }
    }
    return evaluate ? left : 0;
  }

  private parseAnd(evaluate: boolean): LogicValue {
    let left = this.parseNot(evaluate);
    while (this.current().kind === "name" && this.current().text.toLowerCase() === "and") {
      this.index += 1;
      if (evaluate && !Boolean(left)) {
        this.parseNot(false);
        left = false;
      } else {
        const right = this.parseNot(evaluate);
        if (evaluate) left = Boolean(left) && Boolean(right);
      }
    }
    return evaluate ? left : 0;
  }

  private parseNot(evaluate: boolean): LogicValue {
    if (this.current().kind === "name" && this.current().text.toLowerCase() === "not") {
      this.index += 1;
      const operand = this.parseNot(evaluate);
      return evaluate ? !Boolean(operand) : 0;
    }
    return this.parseComparison(evaluate);
  }

  private parseComparison(evaluate: boolean): LogicValue {
    let left = this.parseAdditive(evaluate);
    let compared = false;
    let result = true;
    while (["<", "<=", ">", ">=", "==", "!="].includes(this.current().text)) {
      compared = true;
      const operator = this.current().text;
      this.index += 1;
      const right = this.parseAdditive(evaluate);
      if (evaluate) {
        const ok = operator === "==" ? left === right
          : operator === "!=" ? left !== right
            : operator === "<" ? this.number(left) < this.number(right)
              : operator === "<=" ? this.number(left) <= this.number(right)
                : operator === ">" ? this.number(left) > this.number(right)
                  : this.number(left) >= this.number(right);
        result = result && ok;
        left = right;
      }
    }
    if (!evaluate) return 0;
    return compared ? result : left;
  }

  private parseAdditive(evaluate: boolean): LogicValue {
    let left = this.parseMultiplicative(evaluate);
    while (["+", "-"].includes(this.current().text)) {
      const operator = this.current().text;
      this.index += 1;
      const right = this.parseMultiplicative(evaluate);
      if (evaluate) left = operator === "+" ? this.number(left) + this.number(right) : this.number(left) - this.number(right);
    }
    return evaluate ? left : 0;
  }

  private parseMultiplicative(evaluate: boolean): LogicValue {
    let left = this.parseFactor(evaluate);
    while (["*", "/", "//", "%"].includes(this.current().text)) {
      const operator = this.current().text;
      this.index += 1;
      const right = this.parseFactor(evaluate);
      if (!evaluate) continue;
      const a = this.number(left);
      const b = this.number(right);
      if (b === 0 && operator !== "*") throw new Error("Division by zero in control expression");
      if (operator === "*") left = a * b;
      else if (operator === "/") left = a / b;
      else if (operator === "//") left = Math.floor(a / b);
      else left = a - Math.floor(a / b) * b;
    }
    return evaluate ? left : 0;
  }

  private parseFactor(evaluate: boolean): LogicValue {
    if (this.match("+")) {
      const operand = this.parseFactor(evaluate);
      return evaluate ? +this.number(operand) : 0;
    }
    if (this.match("-")) {
      const operand = this.parseFactor(evaluate);
      return evaluate ? -this.number(operand) : 0;
    }
    return this.parsePower(evaluate);
  }

  private parsePower(evaluate: boolean): LogicValue {
    const left = this.parsePrimary(evaluate);
    if (!this.match("**")) return evaluate ? left : 0;
    const exponent = this.parseFactor(evaluate);
    if (!evaluate) return 0;
    const result = this.number(left) ** this.number(exponent);
    if (Number.isNaN(result)) throw new Error("Invalid exponentiation in control expression");
    return result;
  }

  private parsePrimary(evaluate: boolean): LogicValue {
    const token = this.current();
    if (token.kind === "number") {
      this.index += 1;
      return evaluate ? (token.value ?? 0) : 0;
    }
    if (token.kind === "name") {
      const name = token.text.toLowerCase();
      this.index += 1;
      if (!evaluate) return 0;
      if (name === "value") return this.value;
      if (name === "iteration") return this.iteration;
      if (name === "true") return true;
      if (name === "false") return false;
      throw new Error(`Unsupported name ${token.text} in control expression`);
    }
    if (this.match("(")) {
      const result = this.parseOr(evaluate);
      this.expect(")");
      return evaluate ? result : 0;
    }
    throw new Error(`Unexpected token ${token.text || "<end>"} in control expression`);
  }
}

export function logicExpression(expression: string, value: number, iteration: number): number | boolean {
  const source = expression.trim();
  if (!source) throw new Error("Control expression must not be empty");
  return new LogicParser(tokenize(source), value, iteration).parse();
}
