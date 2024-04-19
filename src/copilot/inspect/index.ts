import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, ExtensionContext, TextDocument, languages, window, workspace, Range, Selection, extensions } from "vscode";
import { COMMAND_INSPECT_RANGE, registerCommands } from "./commands";
import { InspectActionCodeLensProvider } from "./InspectActionCodeLensProvider";
import { DefaultRenderer } from "./render/DefaultRenderer";
import { InspectionRenderer } from "./render/InspectionRenderer";
import { fixDiagnostic } from "./render/DiagnosticRenderer";
import { debounce } from "lodash";
import { logger } from "../utils";
import { sendInfo } from "vscode-extension-telemetry-wrapper";

export const DEPENDENT_EXTENSIONS = ['github.copilot-chat', 'redhat.java'];

export async function activateCopilotInspection(context: ExtensionContext): Promise<void> {
    logger.info('Waiting for dependent extensions to be ready...');
    await waitUntilExtensionsActivated(DEPENDENT_EXTENSIONS);
    logger.info('Activating Java Copilot features...');
    doActivate(context);
}

export function doActivate(context: ExtensionContext): void {
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

export async function waitUntilExtensionsActivated(extensionIds: string[], interval: number = 1500) {
    const start = Date.now();
    return new Promise<void>((resolve) => {
        if (extensionIds.every(id => extensions.getExtension(id)?.isActive)) {
            logger.info(`All dependent extensions [${extensionIds.join(', ')}] are activated.`);
            return resolve();
        }
        const notInstalledExtensionIds = extensionIds.filter(id => !extensions.getExtension(id));
        if (notInstalledExtensionIds.length > 0) {
            sendInfo('java.copilot.inspection.dependentExtensions.notInstalledExtensions', { extensionIds: `[${notInstalledExtensionIds.join(',')}]` });
            logger.info(`Dependent extensions [${notInstalledExtensionIds.join(', ')}] are not installed, setting interval to 10s.`);
        } else {
            logger.info(`All dependent extensions are installed, but some are not activated, keep checking interval ${interval}ms.`);
        }
        interval = notInstalledExtensionIds ? interval : 10000;
        const id = setInterval(() => {
            if (extensionIds.every(id => extensions.getExtension(id)?.isActive)) {
                clearInterval(id);
                sendInfo('java.copilot.inspection.dependentExtensions.waited', { time: Date.now() - start });
                logger.info(`waited for ${Date.now() - start}ms for all dependent extensions [${extensionIds.join(', ')}] to be installed/activated.`);
                resolve();
            }
        }, interval);
    });
}