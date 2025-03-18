import { Chapter, Context } from "js-slang/dist/types";
import { AST } from "../ast";
import { Rule } from "./rule";
import { ContinueStatement, Node } from "estree"
import { DiagnosticSeverity } from "vscode-languageserver";

export const continueStatementRule = new class extends Rule<ContinueStatement> {
    public process(child: ContinueStatement, parent: Node, context: Context, ast: AST): void {
        if (context.chapter < Chapter.SOURCE_3) 
            ast.addDiagnostic("Continue statements are not allowed", DiagnosticSeverity.Error, child.loc!)
    }
}();