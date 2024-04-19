/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ExtensionContext, TextDocument, WorkspaceConfiguration, workspace } from "vscode";
import { CodeLensRenderer } from "./CodeLensRenderer";
import { DiagnosticRenderer } from "./DiagnosticRenderer";
import { GutterIconRenderer } from "./GutterIconRenderer";
import { RulerHighlightRenderer } from "./RulerHighlightRenderer";
import { Inspection } from "../Inspection";
import { InspectionRenderer } from "./InspectionRenderer";
import { sendInfo } from "vscode-extension-telemetry-wrapper";

export class DefaultRenderer implements InspectionRenderer {
    private readonly renderers: { [type: string]: InspectionRenderer } = {};
    private readonly installedRenderers: InspectionRenderer[] = [];

    public constructor(private readonly context: ExtensionContext) {
        this.renderers['diagnostics'] = new DiagnosticRenderer();
        this.renderers['guttericons'] = new GutterIconRenderer();
        this.renderers['codelenses'] = new CodeLensRenderer();
        this.renderers['rulerhighlights'] = new RulerHighlightRenderer();
        workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('java.copilot.inspection.renderer')) {
                const settings = this.reinstallRenderers();
                sendInfo('java.copilot.inspection.renderer.changed', { 'settings': `${settings.join(',')}` });
            }
        });
        this.reinstallRenderers();
    }

    private reinstallRenderers(): string[] {
        this.installedRenderers.splice(0, this.installedRenderers.length);
        const settings = this.reloadSettings();
        Object.entries(this.renderers).forEach(([type, renderer]) => {
            if (settings.includes(type.toLowerCase())) {
                this.installedRenderers.push(renderer);
                renderer.install(this.context);
            } else {
                renderer.uninstall();
            }
        });
        return settings;
    }

    private reloadSettings(): string[] {
        const config: WorkspaceConfiguration = workspace.getConfiguration('java.copilot.inspection.renderer');
        const types: string[] = Object.keys(this.renderers);
        const settings = types.map(type => config.get<boolean>(type) ? type.toLowerCase() : '').filter(t => t);
        if (settings.length === 0) {
            settings.push('diagnostics');
            settings.push('codelenses');
            settings.push('rulerhighlights');
        }
        return settings;
    }

    public install(context: ExtensionContext): void {
        this.installedRenderers.forEach(r => r.install(context));
    }

    public uninstall(): void {
        this.installedRenderers.forEach(r => r.uninstall());
    }

    public clear(document?: TextDocument): void {
        this.installedRenderers.forEach(r => r.clear(document));
    }

    public renderInspections(document: TextDocument, inspections: Inspection[]): void {
        this.installedRenderers.forEach(r => r.renderInspections(document, inspections));
    }
}
