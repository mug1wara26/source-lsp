import { Chapter, Context, Node } from "js-slang/dist/types"
import * as es from "estree";
import { CompletionItemKind, Range, SymbolKind } from "vscode-languageserver";
import { DeclarationKind } from "js-slang/dist/name-extractor";
import { DECLARATIONS, NodeToSymbol, ProgramSymbols } from "./types";

function isNotNull<T>(x: T): x is Exclude<T, null> {
  // This function exists to appease the mighty typescript type checker
  return x !== null
}

function isNotNullOrUndefined<T>(x: T): x is Exclude<T, null | undefined> {
  // This function also exists to appease the mighty typescript type checker
  return x !== undefined && isNotNull(x)
}


export function getNodeChildren(node: Node): es.Node[] {
  switch (node.type) {
    case 'Program':
      return node.body
    case 'BlockStatement':
      return node.body
    case 'WhileStatement':
      return [node.test, node.body]
    case 'ForStatement':
      return [node.init, node.test, node.update, node.body].filter(isNotNullOrUndefined)
    case 'ExpressionStatement':
      return [node.expression]
    case 'IfStatement':
      const children = [node.test, node.consequent]
      if (isNotNullOrUndefined(node.alternate)) {
        children.push(node.alternate)
      }
      return children
    case 'ReturnStatement':
      return node.argument ? [node.argument] : []
    case 'FunctionDeclaration':
      return [node.body]
    case 'VariableDeclaration':
      return node.declarations.flatMap(getNodeChildren)
    case 'VariableDeclarator':
      return node.init ? [node.init] : []
    case 'ArrowFunctionExpression':
      return [node.body]
    case 'FunctionExpression':
      return [node.body]
    case 'UnaryExpression':
      return [node.argument]
    case 'BinaryExpression':
      return [node.left, node.right]
    case 'LogicalExpression':
      return [node.left, node.right]
    case 'ConditionalExpression':
      return [node.test, node.alternate, node.consequent]
    case 'CallExpression':
      return [...node.arguments, node.callee]
    // case 'Identifier':
    // case 'DebuggerStatement':
    // case 'BreakStatement':
    // case 'ContinueStatement':
    // case 'MemberPattern':
    case 'ArrayExpression':
      return node.elements.filter(isNotNull)
    case 'AssignmentExpression':
      return [node.left, node.right]
    case 'MemberExpression':
      return [node.object, node.property]
    case 'Property':
      return [node.key, node.value]
    case 'ObjectExpression':
      return [...node.properties]
    case 'NewExpression':
      return [...node.arguments, node.callee]
    default:
      return []
  }
}

export function getSubstrFromSouceLoc(text: string[], loc: es.SourceLocation): string {
  return loc.start.line === loc.end.line ?
    text[loc.start.line - 1].substring(loc.start.column, loc.end.column)
    : [text[loc.start.line - 1].substring(loc.start.column), ...text.slice(loc.start.line, loc.end.line - 1), text[loc.end.line - 1].substring(0, loc.end.column)].join('\n');
}

export function sourceLocToRange(loc: es.SourceLocation): Range {
  return {
    start: {
      line: loc.start.line - 1,
      character: loc.start.column
    },
    end: {
      line: loc.end.line - 1,
      character: loc.end.column
    }
  }
}

export function mapDeclarationKindToSymbolKind(kind: DeclarationKind, context: Context): SymbolKind {
  switch (kind) {
    case DeclarationKind.KIND_IMPORT:
      return SymbolKind.Namespace;
    case DeclarationKind.KIND_FUNCTION:
      return SymbolKind.Function;
    case DeclarationKind.KIND_LET:
      return SymbolKind.Variable;
    case DeclarationKind.KIND_PARAM:
      return context.chapter === Chapter.SOURCE_1 || context.chapter === Chapter.SOURCE_2 ? SymbolKind.Constant : SymbolKind.Variable;
    case DeclarationKind.KIND_CONST:
      return SymbolKind.Constant
    default:
      return SymbolKind.Namespace;
  }
}

export function mapMetaToCompletionItemKind(meta: string) {
  switch (meta) {
    case "const":
      return CompletionItemKind.Constant;
    case "let":
      return CompletionItemKind.Variable;
    case "import":
      return CompletionItemKind.Module;
    default:
      return CompletionItemKind.Text;
  }
}

// The getNames function in js-slang has some issues, firstly it only get the names within a given scope, and it doesnt return the location of the name
// This implementation doesn't care where the cursor is, and grabs the name of all variables and functions
// @param prog Root node of the program, generated using looseParse
// @returns ProgramSymbols[]
export async function getAllNames<T>(prog: Node, ...nodeToSymbols: {type: string, callback: (node: Node) => T[]}[]): Promise<T[]> {
	const queue: Node[] = [prog];
	let symbols: T[] = [];

	while (queue.length > 0) {
		const node = queue.shift()!;

    nodeToSymbols.forEach(x => {
      if (node.type === x.type) {
        symbols = symbols.concat(x.callback(node));
      }
    });

		queue.push(...getNodeChildren(node));
	}

	return symbols;
}

function variableDeclarationToSymbol(node: Node): ProgramSymbols[] {
  node = node as es.VariableDeclaration;
  return node.declarations.map((declaration): ProgramSymbols => ({
    name: (declaration.id as es.Identifier).name,
    kind: node.kind === 'var' || node.kind === 'let' ? DeclarationKind.KIND_LET : DeclarationKind.KIND_CONST,
    range: sourceLocToRange(declaration.loc!),
    selectionRange: sourceLocToRange(declaration.id.loc!)
  }));
}

function functionDeclarationToSymbol(node: Node): ProgramSymbols[] {
  node = node as es.FunctionDeclaration;
  const ret = node.params.map((param): ProgramSymbols => ({
        name: (param as es.Identifier).name,
				kind: DeclarationKind.KIND_PARAM,
				range: sourceLocToRange(param.loc!),
				selectionRange: sourceLocToRange(param.loc!)
  }));
  
  ret.push({
        name: node.id!.name,
				kind: DeclarationKind.KIND_FUNCTION,
				range: sourceLocToRange(node.loc!),
				selectionRange: sourceLocToRange(node.id!.loc!)
  });

  return ret;
}

function importDeclarationToSymbol(node: Node): ProgramSymbols[] {
  node = node as es.ImportDeclaration;

  return node.specifiers.map((specifier): ProgramSymbols => ({
    name: ((specifier as es.ImportSpecifier).imported as es.Identifier).name,
    kind: DeclarationKind.KIND_IMPORT,
    range: sourceLocToRange(node.loc!),
    selectionRange: sourceLocToRange(specifier.loc!)
  }))
}

export const VariableNodeToSymbol: NodeToSymbol = {
  type: DECLARATIONS.VARIABLE,
  callback: variableDeclarationToSymbol
}

export const FunctionNodeToSymbol: NodeToSymbol = {
  type: DECLARATIONS.FUNCTION,
  callback: functionDeclarationToSymbol
}

export const ImportNodeToSymbol: NodeToSymbol = {
  type: DECLARATIONS.IMPORT,
  callback: importDeclarationToSymbol
}

export function findExistingImportLine(code: string, moduleName: string): { line: number } | null {
  const importRegex = `import\\s*{\\s*([^}]*)\\s*}\\s*from\\s*["']${moduleName}["'];`;
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(importRegex);
      if (match) {
          return { line: i };
      }
  }

  return null; // No existing import for the module
}