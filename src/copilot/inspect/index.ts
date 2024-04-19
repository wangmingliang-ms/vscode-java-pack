import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, ExtensionContext, TextDocument, languages, window, workspace, Range, Selection } from "vscode";
import { COMMAND_INSPECT_RANGE, registerCommands } from "./commands";
import { InspectActionCodeLensProvider } from "./InspectActionCodeLensProvider";
import { DefaultRenderer } from "./render/DefaultRenderer";
import { InspectionRenderer } from "./render/InspectionRenderer";
import { fixDiagnostic } from "./render/DiagnosticRenderer";
import { debounce } from "lodash";

export async function activateCopilotInspection(context: ExtensionContext): Promise<void> {
    const renderer: InspectionRenderer = new DefaultRenderer(context);
    registerCommands(renderer);

    const inspectActionCodeLenses = new InspectActionCodeLensProvider().install(context);
    const rerenderDocumentDebouncelyMap: { [key: string]: (document: TextDocument) => void } = {};
    const rerenderDocument = (document?: TextDocument, debounced: boolean = false) => {
        if (document?.languageId !== 'java') return;
        if (!debounced) {
            void inspectActionCodeLenses.rerender(document);
            renderer.rerender(document);
            return;
        }
        renderer.clear(document);
        const key = document.uri.fsPath;
        if (!rerenderDocumentDebouncelyMap[key]) {
            rerenderDocumentDebouncelyMap[key] = debounce((document: TextDocument) => {
                void inspectActionCodeLenses.rerender(document);
                renderer.rerender(document);
            });
        }
        rerenderDocumentDebouncelyMap[key](document);
    };

    context.subscriptions.push(
        workspace.onDidOpenTextDocument(doc => rerenderDocument(doc)), // Rerender class codelens and cached suggestions on document open
        workspace.onDidChangeTextDocument(e => rerenderDocument(e.document, true)), // Rerender class codelens and cached suggestions on document change
        languages.registerCodeActionsProvider({ language: 'java' }, { provideCodeActions: fixDiagnostic }), // Fix using Copilot
        languages.registerCodeActionsProvider({ language: 'java' }, { provideCodeActions: inspectUsingCopilot }), // Inspect using Copilot
        window.onDidChangeVisibleTextEditors(editors => editors.forEach(editor => rerenderDocument(editor.document))) // rerender in case of renderers changed.
    );
    window.visibleTextEditors.forEach(editor => rerenderDocument(editor.document));
}

async function inspectUsingCopilot(document: TextDocument, range: Range | Selection, _context: CodeActionContext, _token: CancellationToken): Promise<CodeAction[]> {
    const action: CodeAction = {
        title: "Rewrite with new syntax",
        kind: CodeActionKind.RefactorRewrite,
        command: {
            title: "Rewrite selected code using Copilot",
            command: COMMAND_INSPECT_RANGE,
            arguments: [document, range]
        }
    };
    return [action];
}