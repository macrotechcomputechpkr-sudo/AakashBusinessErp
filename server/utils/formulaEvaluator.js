// =============================================
// server/utils/formulaEvaluator.js
// A SAFE arithmetic expression evaluator for Billing Term "Advance
// Formula" mode. Deliberately NOT implemented with eval()/new Function()
// - user-typed formulas are untrusted input, and a formula engine is
// exactly the kind of feature that turns into an arbitrary-code-execution
// hole if you take a shortcut here. This is a small hand-written
// tokenizer + recursive-descent parser instead, so the only things a
// formula can ever do are: +, -, *, /, parentheses, decimal numbers, and
// look up a fixed set of named variables.
//
// Supported variable syntax inside a formula:
//   {basic_amount}     - the line/document's base amount before this term
//   {quantity}         - quantity, for basis = 'quantity' terms
//   {rate}             - this term's own rate_percentage (rarely needed
//                         directly, since percentage mode already
//                         multiplies by it, but available for formulas
//                         that combine several inputs)
//   {running_total}    - the running total of all EARLIER terms applied
//                         so far, in display_order sequence
//   {term:CODE}        - another billing term's already-computed amount,
//                         looked up by its term_code (must be evaluated
//                         earlier - see evaluateAllTerms below)
//
// Example formulas:
//   {basic_amount} * 0.13
//   ({basic_amount} + {term:FREIGHT}) * 0.13
//   {quantity} * 5 - {term:CASH_DISC}
// =============================================

class FormulaError extends Error {}

function tokenize(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (/\s/.test(ch)) { i++; continue; }
        if ('+-*/()'.includes(ch)) { tokens.push({ type: ch, value: ch }); i++; continue; }
        if (ch === '{') {
            const end = expr.indexOf('}', i);
            if (end === -1) throw new FormulaError(`Unclosed variable reference starting at position ${i}`);
            const name = expr.slice(i + 1, end).trim();
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*(:[a-zA-Z0-9_]+)?$/.test(name)) {
                throw new FormulaError(`Invalid variable reference: {${name}}`);
            }
            tokens.push({ type: 'VAR', value: name });
            i = end + 1;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            let j = i;
            while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
            const numStr = expr.slice(i, j);
            if (!/^\d+(\.\d+)?$/.test(numStr)) throw new FormulaError(`Invalid number: ${numStr}`);
            tokens.push({ type: 'NUM', value: parseFloat(numStr) });
            i = j;
            continue;
        }
        throw new FormulaError(`Unexpected character '${ch}' at position ${i} - only numbers, {variables}, + - * / ( ) are allowed`);
    }
    return tokens;
}

// Recursive-descent parser producing a small AST, then a separate
// evaluate step - kept as two passes so a formula can be VALIDATED
// (parsed) once when saved, without needing sample values yet.
function parse(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const consume = (type) => {
        const t = tokens[pos];
        if (!t || t.type !== type) throw new FormulaError(`Expected '${type}' but found '${t ? t.value : 'end of formula'}'`);
        pos++;
        return t;
    };

    function parseExpression() {
        let node = parseTerm();
        while (peek() && (peek().type === '+' || peek().type === '-')) {
            const op = consume(peek().type).type;
            node = { type: 'binary', op, left: node, right: parseTerm() };
        }
        return node;
    }
    function parseTerm() {
        let node = parseFactor();
        while (peek() && (peek().type === '*' || peek().type === '/')) {
            const op = consume(peek().type).type;
            node = { type: 'binary', op, left: node, right: parseFactor() };
        }
        return node;
    }
    function parseFactor() {
        const t = peek();
        if (!t) throw new FormulaError('Unexpected end of formula');
        if (t.type === '-') { consume('-'); return { type: 'unary', op: '-', operand: parseFactor() }; }
        if (t.type === '+') { consume('+'); return parseFactor(); }
        if (t.type === 'NUM') { consume('NUM'); return { type: 'number', value: t.value }; }
        if (t.type === 'VAR') { consume('VAR'); return { type: 'variable', name: t.value }; }
        if (t.type === '(') {
            consume('(');
            const node = parseExpression();
            consume(')');
            return node;
        }
        throw new FormulaError(`Unexpected token '${t.value}'`);
    }

    const result = parseExpression();
    if (pos < tokens.length) throw new FormulaError(`Unexpected token '${tokens[pos].value}' after end of formula`);
    return result;
}

function evaluateAst(node, variables) {
    switch (node.type) {
        case 'number': return node.value;
        case 'unary': return node.op === '-' ? -evaluateAst(node.operand, variables) : evaluateAst(node.operand, variables);
        case 'binary': {
            const l = evaluateAst(node.left, variables);
            const r = evaluateAst(node.right, variables);
            switch (node.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/':
                    if (r === 0) throw new FormulaError('Division by zero in formula');
                    return l / r;
                default: throw new FormulaError(`Unknown operator '${node.op}'`);
            }
        }
        case 'variable': {
            if (!(node.name in variables)) throw new FormulaError(`Unknown variable {${node.name}} - it was not provided for this calculation`);
            const v = variables[node.name];
            if (typeof v !== 'number' || isNaN(v)) throw new FormulaError(`Variable {${node.name}} did not resolve to a number`);
            return v;
        }
        default: throw new FormulaError(`Unknown AST node type '${node.type}'`);
    }
}

// Validates a formula's SYNTAX only (no variable values needed) - used
// when a billing term is created/edited, so a typo is caught immediately
// instead of at first use.
function validateFormula(expr) {
    if (!expr || !expr.trim()) throw new FormulaError('Formula cannot be empty');
    parse(tokenize(expr));
}

// Evaluates a formula against a concrete set of variables (numbers only).
// `variables` should already have any {term:CODE} references resolved to
// plain numbers by the caller (see evaluateAllTerms).
function evaluateFormula(expr, variables = {}) {
    const ast = parse(tokenize(expr));
    return evaluateAst(ast, variables);
}

function applyRounding(value, method, precision) {
    const p = Number(precision) || 1;
    if (!method || method === 'none') return value;
    const scaled = value / p;
    if (method === 'nearest') return Math.round(scaled) * p;
    if (method === 'up') return Math.ceil(scaled) * p;
    if (method === 'down') return Math.floor(scaled) * p;
    return value;
}

// FEATURE: an optional ceiling on the final computed amount, regardless
// of calculation mode - e.g. "1% of value, capped at Rs 1000" (a very
// common real-world pattern for bank/service charges, TDS limits, etc).
// Applied to the absolute value (sign is re-applied by the caller), after
// rounding, since a cap is normally a statement about the final billed
// figure, not an intermediate one.
function applyMaximumCap(value, maximumAmount) {
    const cap = Number(maximumAmount) || 0;
    if (cap <= 0) return value;
    const sign = value < 0 ? -1 : 1;
    return sign * Math.min(Math.abs(value), cap);
}

// Evaluates a full ORDERED list of billing terms (display_order ascending)
// for one document/line, resolving {term:CODE} and {running_total}
// references to already-computed earlier terms as it goes. This is what
// a future Sales/Purchase voucher module would call once built; exposed
// now via /api/billing-terms/preview so the Billing Term form itself can
// show a live "what would this compute to" preview while you're defining
// the term.
function evaluateAllTerms(terms, baseVariables) {
    const results = [];
    const byCode = {};
    let runningTotal = Number(baseVariables.basic_amount) || 0;

    for (const term of terms) {
        if (!term.is_enabled) { results.push({ term_code: term.term_code, amount: 0, skipped: true }); continue; }

        // FEATURE: Free Quantity mode is NOT a monetary term - it grants
        // free units of the item instead of a discount/charge amount, so
        // it never touches the money running total. `fixed_amount` is
        // reused here to mean "how many free units", in whichever
        // quantity_unit (Primary/Secondary) was configured.
        if (term.calculation_mode === 'free_quantity') {
            const freeQty = Number(term.fixed_amount) || 0;
            results.push({ term_code: term.term_code, free_quantity: freeQty, quantity_unit: term.quantity_unit || 'primary' });
            byCode[term.term_code] = 0;
            continue;
        }

        const baseAmount = term.base_reference === 'running_total'
            ? runningTotal
            : term.base_reference === 'specific_term'
                ? (byCode[term.base_reference_term_code] ?? 0)
                : Number(baseVariables.basic_amount) || 0;

        let amount = 0;
        if (term.calculation_mode === 'fixed_amount') {
            amount = Number(term.fixed_amount) || 0;
        } else if (term.calculation_mode === 'percentage') {
            const base = term.basis === 'quantity' ? (Number(baseVariables.quantity) || 0) : baseAmount;
            amount = base * ((Number(term.rate_percentage) || 0) / 100);
        } else if (term.calculation_mode === 'both') {
            // FEATURE: Rate AND Amount together - e.g. "1% of value PLUS a
            // flat Rs 20 handling fee".
            const base = term.basis === 'quantity' ? (Number(baseVariables.quantity) || 0) : baseAmount;
            amount = (base * ((Number(term.rate_percentage) || 0) / 100)) + (Number(term.fixed_amount) || 0);
        } else if (term.calculation_mode === 'formula') {
            const vars = {
                basic_amount: Number(baseVariables.basic_amount) || 0,
                quantity: Number(baseVariables.quantity) || 0,
                rate: Number(term.rate_percentage) || 0,
                running_total: runningTotal
            };
            Object.keys(byCode).forEach(code => { vars[`term:${code}`] = byCode[code]; });
            amount = evaluateFormula(term.formula_expression, vars);
        }

        amount = applyRounding(amount, term.rounding_method, term.rounding_precision);
        amount = applyMaximumCap(amount, term.maximum_amount);
        if (term.sign === '-') amount = -Math.abs(amount);

        if (term.suppress_if_zero && amount === 0) {
            results.push({ term_code: term.term_code, amount: 0, suppressed: true });
        } else {
            results.push({ term_code: term.term_code, amount });
        }

        byCode[term.term_code] = amount;
        runningTotal += amount;
    }

    return { lines: results, total: runningTotal };
}

module.exports = { validateFormula, evaluateFormula, evaluateAllTerms, applyRounding, applyMaximumCap, FormulaError };
