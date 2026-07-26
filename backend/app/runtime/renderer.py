"""Template rendering and rule evaluation — PLAN.md §5.

One renderer, used for URLs, request bodies, response strings and receipts.
`{{name}}` placeholders resolve against
``{ ...collected_inputs, result, context, mock_base }``.

A missing key raises: a blank in the demo is worse than a loud failure.
"""

from __future__ import annotations

import ast
import re
from typing import Any

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}")


class RenderError(ValueError):
    """A template referenced something the scope doesn't have."""


def resolve_path(scope: dict[str, Any], path: str) -> Any:
    """Walk a dotted path (``result.eta``) through dicts and objects."""
    current: Any = scope
    for part in path.split("."):
        if isinstance(current, dict):
            if part not in current:
                raise KeyError(path)
            current = current[part]
        else:
            if not hasattr(current, part):
                raise KeyError(path)
            current = getattr(current, part)
    return current


def render(template: str, scope: dict[str, Any], *, strict: bool = True) -> str:
    """Substitute every ``{{path}}`` in *template*."""
    missing: list[str] = []

    def substitute(match: re.Match[str]) -> str:
        path = match.group(1)
        try:
            value = resolve_path(scope, path)
        except KeyError:
            missing.append(path)
            return ""
        return "" if value is None else str(value)

    output = _PLACEHOLDER.sub(substitute, template or "")
    if missing and strict:
        raise RenderError(f"Template referenced unknown keys: {sorted(set(missing))}")
    return re.sub(r"\s{2,}", " ", output).strip()


def render_value(value: Any, scope: dict[str, Any], *, strict: bool = True) -> Any:
    """Render templates nested anywhere inside a dict/list/str structure."""
    if isinstance(value, str):
        return render(value, scope, strict=strict)
    if isinstance(value, dict):
        return {k: render_value(v, scope, strict=strict) for k, v in value.items()}
    if isinstance(value, list):
        return [render_value(v, scope, strict=strict) for v in value]
    return value


def placeholders(template: str) -> set[str]:
    return set(_PLACEHOLDER.findall(template or ""))


# --------------------------------------------------------------------------- #
# Rule evaluation
# --------------------------------------------------------------------------- #
_ALLOWED_NODES = (
    ast.Expression,
    ast.BoolOp,
    ast.UnaryOp,
    ast.BinOp,
    ast.Compare,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Attribute,
    ast.And,
    ast.Or,
    ast.Not,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.In,
    ast.NotIn,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
)


class RuleError(ValueError):
    """A rule condition could not be evaluated."""


def evaluate_condition(expression: str, scope: dict[str, Any]) -> bool:
    """Evaluate a manifest rule such as ``result.days_since_delivery > 7``.

    Deliberately *not* ``eval``: manifests are data supplied by a business, so
    the expression grammar is restricted to comparisons and boolean logic over
    values already in scope. Anything else raises.
    """
    expression = (expression or "").strip()
    if not expression:
        return False

    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise RuleError(f"Invalid rule expression {expression!r}: {exc}") from exc

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise RuleError(
                f"Rule expression {expression!r} uses unsupported syntax: {type(node).__name__}"
            )

    def evaluate(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            if node.id not in scope:
                raise RuleError(f"Rule referenced unknown name {node.id!r}")
            return scope[node.id]
        if isinstance(node, ast.Attribute):
            container = evaluate(node.value)
            if isinstance(container, dict):
                if node.attr not in container:
                    raise RuleError(f"Rule referenced missing field {node.attr!r}")
                return container[node.attr]
            if not hasattr(container, node.attr):
                raise RuleError(f"Rule referenced missing field {node.attr!r}")
            return getattr(container, node.attr)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return not evaluate(node.operand)
        if isinstance(node, ast.BoolOp):
            values = [evaluate(v) for v in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.BinOp):
            left, right = evaluate(node.left), evaluate(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
        if isinstance(node, ast.Compare):
            left = evaluate(node.left)
            for operator, comparator in zip(node.ops, node.comparators):
                right = evaluate(comparator)
                if isinstance(operator, ast.Eq):
                    ok = left == right
                elif isinstance(operator, ast.NotEq):
                    ok = left != right
                elif isinstance(operator, ast.Lt):
                    ok = left < right
                elif isinstance(operator, ast.LtE):
                    ok = left <= right
                elif isinstance(operator, ast.Gt):
                    ok = left > right
                elif isinstance(operator, ast.GtE):
                    ok = left >= right
                elif isinstance(operator, ast.In):
                    ok = left in right
                elif isinstance(operator, ast.NotIn):
                    ok = left not in right
                else:  # pragma: no cover - guarded by the node whitelist
                    raise RuleError(f"Unsupported comparison in {expression!r}")
                if not ok:
                    return False
                left = right
            return True
        raise RuleError(f"Unsupported node in {expression!r}: {type(node).__name__}")

    return bool(evaluate(tree))
