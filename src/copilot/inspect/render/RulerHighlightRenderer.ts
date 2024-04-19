/* eslint-disable @typescript-eslint/ban-ts-comment */
import { DecorationOptions, ExtensionContext, OverviewRulerLane, TextDocument, TextEditorDecorationType, ThemeColor, Uri, window } from "vscode";
import { Inspection } from "../Inspection";
import { InspectionRenderer } from "./InspectionRenderer";
import { logger } from "../../../copilot/utils";
import InspectionCache from "../InspectionCache";
import path from "path";

export class RulerHighlightRenderer implements InspectionRenderer {
    private readonly rulerHighlights: Map<Uri, RulerHighlight[]> = new Map();
    private rulerDecorationType: TextEditorDecorationType | undefined;

    public install(_context: ExtensionContext): void {
        if (this.rulerDecorationType) return;
        logger.debug(`[RulerRenderer] install`);
        const color = new ThemeColor('textLink.foreground');
        this.rulerDecorationType = window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerLane: OverviewRulerLane.Right,
            overviewRulerColor: color
        });
    }

    public uninstall(): void {
        if (!this.rulerDecorationType) return;
        logger.debug(`[RulerRenderer] uninstall`);
        this.rulerHighlights.clear();
        window.visibleTextEditors.forEach(editor => this.rulerDecorationType && editor.setDecorations(this.rulerDecorationType, []));
        this.rulerDecorationType.dispose();
        this.rulerDecorationType = undefined;
    }

    public clear(document?: TextDocument): void {
        if (!this.rulerDecorationType) return;
        if (document) {
            this.rulerHighlights?.set(document.uri, []);
        } else {
            this.rulerHighlights?.clear();
        }
        window.visibleTextEditors.forEach(editor => this.rulerDecorationType && editor.setDecorations(this.rulerDecorationType, []));
    }

    public async rerender(document: TextDocument): Promise<void> {
        logger.debug(`[RulerRenderer] rerender ${path.basename(document.uri.fsPath)}`);
        this.clear(document);
        const inspections = await InspectionCache.getCachedInspectionsOfDoc(document);
        this.renderInspections(document, inspections);
    }

    public renderInspections(document: TextDocument, inspections: Inspection[]): void {
        const editor = window.visibleTextEditors.find(e => e.document.uri === document.uri);
        if (inspections.length < 1 || !editor || !this.rulerDecorationType) {
            return;
        }
        const newRulerHightlights: RulerHighlight[] = inspections.map(s => RulerHighlightRenderer.toRulerHighlight(s));
        const newRulerHighlightsMessages = newRulerHightlights.map(d => d.inspection.solution.trim());
        const existingRulerHighlights = this.rulerHighlights.get(document.uri) ?? [];
        const leftRulerHighlights = existingRulerHighlights.filter(d => !newRulerHighlightsMessages.includes(d.inspection.solution.trim()));
        newRulerHightlights.push(...leftRulerHighlights);
        this.rulerHighlights.set(document.uri, newRulerHightlights);

        editor.setDecorations(this.rulerDecorationType, newRulerHightlights);
    }

    private static toRulerHighlight(inspection: Inspection): RulerHighlight {
        const range = Inspection.calculateHintPosition(inspection.problem);
        return { range, inspection };
    }
}

interface RulerHighlight extends DecorationOptions {
    inspection: Inspection;
}
