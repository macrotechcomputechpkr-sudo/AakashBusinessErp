// =============================================
// utils/formulaEvaluator.js (frontend)
// "Available field bata formula lagauna milne ... with IF condition" -
// a SAFE formula evaluator for report custom columns. Deliberately NOT
// built on eval()/new Function() (arbitrary code execution risk from
// user-typed strings) - a small hand-written recursive-descent parser
// instead, supporting exactly: field references, number/string
// literals, + - * / ( ), comparisons (> < >= <= == !=), AND/OR, and
// IF(condition, thenValue, elseValue).
// =============================================

class FormulaError extends Error {}

function tokenize(formula) {
    const tokens = [];
    let i = 0;
    const isDigit = c => c >= '0' && c <= '9';
    const isIdentStart = c => /[A-Za-z_]/.test(c);
    const isIdentChar = c => /[A-Za-z0-9_]/.test(c);

    while (i < formula.length) {
        const c = formula[i];
        if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
        if (isDigit(c) || (c === '.' && isDigit(formula[i + 1]))) {
            let j = i;
            while (j < formula.length && (isDigit(formula[j]) || formula[j] === '.')) j++;
            tokens.push({ type: 'number', value: parseFloat(formula.slice(i, j)) });
            i = j;
            continue;
        }
        if (c === '"' || c === "'") {
            const quote = c;
            let j = i + 1;
            while (j < formula.length && formula[j] !== quote) j++;
            tokens.push({ type: 'string', value: formula.slice(i + 1, j) });
            i = j + 1;
            continue;
        }
        if (isIdentStart(c)) {
            let j = i;
            while (j < formula.length && isIdentChar(formula[j])) j++;
            const word = formula.slice(i, j);
            const upper = word.toUpperCase();
            if (upper === 'IF') tokens.push({ type: 'if' });
            else if (upper === 'AND') tokens.push({ type: 'and' });
            else if (upper === 'OR') tokens.push({ type: 'or' });
            else if (upper === 'NOT') tokens.push({ type: 'not' });
            else tokens.push({ type: 'field', value: word });
            i = j;
            continue;
        }
        if (c === '>' && formula[i + 1] === '=') { tokens.push({ type: 'gte' }); i += 2; continue; }
        if (c === '<' && formula[i + 1] === '=') { tokens.push({ type: 'lte' }); i += 2; continue; }
        if (c === '=' && formula[i + 1] === '=') { tokens.push({ type: 'eq' }); i += 2; continue; }
        if (c === '!' && formula[i + 1] === '=') { tokens.push({ type: 'neq' }); i += 2; continue; }
        if (c === '>') { tokens.push({ type: 'gt' }); i++; continue; }
        if (c === '<') { tokens.push({ type: 'lt' }); i++; continue; }
        if (c === '=') { tokens.push({ type: 'eq' }); i++; continue; }
        if (c === '+') { tokens.push({ type: 'plus' }); i++; continue; }
        if (c === '-') { tokens.push({ type: 'minus' }); i++; continue; }
        if (c === '*') { tokens.push({ type: 'mul' }); i++; continue; }
        if (c === '/') { tokens.push({ type: 'div' }); i++; continue; }
        if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
        if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
        if (c === ',') { tokens.push({ type: 'comma' }); i++; continue; }
        throw new FormulaError(`Unexpected character "${c}" at position ${i}`);
    }
    tokens.push({ type: 'eof' });
    return tokens;
}

// Recursive-descent parser: comparison < additive < multiplicative < unary < primary,
// with IF(...) and AND/OR handled at the top (logical) level.
function parse(tokens, rowContext) {
    let pos = 0;
    const peek = () => tokens[pos];
    const advance = () => tokens[pos++];
    const expect = (type) => { if (peek().type !== type) throw new FormulaError(`Expected ${type} but got ${peek().type}`); return advance(); };

    function parseLogical() {
        let left = parseComparison();
        while (peek().type === 'and' || peek().type === 'or') {
            const op = advance().type;
            const right = parseComparison();
            left = op === 'and' ? (left && right) : (left || right);
        }
        return left;
    }
    function parseComparison() {
        let left = parseAdditive();
        const compOps = { gt: (a, b) => a > b, lt: (a, b) => a < b, gte: (a, b) => a >= b, lte: (a, b) => a <= b, eq: (a, b) => a === b, neq: (a, b) => a !== b };
        while (compOps[peek().type]) {
            const op = advance().type;
            const right = parseAdditive();
            left = compOps[op](left, right);
        }
        return left;
    }
    function parseAdditive() {
        let left = parseMultiplicative();
        while (peek().type === 'plus' || peek().type === 'minus') {
            const op = advance().type;
            const right = parseMultiplicative();
            left = op === 'plus' ? Number(left) + Number(right) : Number(left) - Number(right);
        }
        return left;
    }
    function parseMultiplicative() {
        let left = parseUnary();
        while (peek().type === 'mul' || peek().type === 'div') {
            const op = advance().type;
            const right = parseUnary();
            if (op === 'div' && Number(right) === 0) throw new FormulaError('Division by zero');
            left = op === 'mul' ? Number(left) * Number(right) : Number(left) / Number(right);
        }
        return left;
    }
    function parseUnary() {
        if (peek().type === 'minus') { advance(); return -Number(parseUnary()); }
        if (peek().type === 'not') { advance(); return !parseUnary(); }
        return parsePrimary();
    }
    function parsePrimary() {
        const t = peek();
        if (t.type === 'number') { advance(); return t.value; }
        if (t.type === 'string') { advance(); return t.value; }
        if (t.type === 'field') {
            advance();
            if (!(t.value in rowContext)) throw new FormulaError(`Unknown field "${t.value}"`);
            const v = rowContext[t.value];
            return v === null || v === undefined ? 0 : v;
        }
        if (t.type === 'lparen') {
            advance();
            const v = parseLogical();
            expect('rparen');
            return v;
        }
        if (t.type === 'if') {
            advance();
            expect('lparen');
            const cond = parseLogical();
            expect('comma');
            const thenVal = parseLogical();
            expect('comma');
            const elseVal = parseLogical();
            expect('rparen');
            return cond ? thenVal : elseVal;
        }
        throw new FormulaError(`Unexpected token ${t.type}`);
    }

    const result = parseLogical();
    expect('eof');
    return result;
}

// FEATURE: evaluate a formula string against ONE report row's field
// values - e.g. formula = 'IF(outstanding_qty > 0, "Pending", "Done")'
// with row = { outstanding_qty: 5, ... } -> "Pending".
function evaluateFormula(formula, row) {
    try {
        const tokens = tokenize(formula);
        return parse(tokens, row);
    } catch (err) {
        return `#ERROR: ${err.message}`;
    }
}

// FEATURE: a quick syntax/field check before saving a formula column -
// runs it against a sample row (or an all-zero stand-in) and reports
// whether it parses cleanly.
function validateFormula(formula, sampleRow) {
    const result = evaluateFormula(formula, sampleRow || {});
    if (typeof result === 'string' && result.startsWith('#ERROR:')) return { valid: false, error: result.slice(8) };
    return { valid: true, sampleResult: result };
}

export { evaluateFormula, validateFormula, FormulaError };
