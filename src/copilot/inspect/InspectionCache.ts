import { DocumentSymbol, SymbolKind, TextDocument } from 'vscode';
import { METHOD_KINDS, getClassesAndMethodsOfDoc, logger } from '../utils';
import { Inspection } from './Inspection';
import * as crypto from "crypto";

// Map<documentKey, Map<symbolName, [symbolVersionId, Promise<Inspection[]>]
const DOC_SYMBOL_VERSION_INSPECTIONS: Map<string, Map<string, [string, Promise<Inspection[]>]>> = new Map();

export default class InspectionCache {
    public static hasCache(document: TextDocument, symbol?: DocumentSymbol): boolean {
        const documentKey = document.uri.fsPath;
        if (!symbol) {
            return DOC_SYMBOL_VERSION_INSPECTIONS.has(documentKey);
        }
        const symbolInspections = DOC_SYMBOL_VERSION_INSPECTIONS.get(documentKey);
        const versionInspections = symbolInspections?.get(symbol.name);
        const symbolVersionId = InspectionCache.calculateSymbolVersionId(document, symbol);
        return versionInspections?.[0] === symbolVersionId;
    }

    public static async getCachedInspectionsOfDoc(document: TextDocument): Promise<Inspection[]> {
        const symbols: DocumentSymbol[] = await getClassesAndMethodsOfDoc(document);
        const inspections: Inspection[] = [];
        for (const symbol of symbols) {
            const cachedInspections = await InspectionCache.getCachedInspectionsOfSymbol(document, symbol);
            if (cachedInspections === undefined) continue;
            inspections.push(...cachedInspections);
        }
        return inspections;
    }

    /**
     * @returns the cached inspections, or undefined if not found
     */
    public static getCachedInspectionsOfSymbol(document: TextDocument, symbol: DocumentSymbol): Promise<Inspection[]> | undefined {
        const documentKey = document.uri.fsPath;
        const symbolInspections = DOC_SYMBOL_VERSION_INSPECTIONS.get(documentKey);
        const versionInspections = symbolInspections?.get(symbol.name);
        const symbolVersionId = InspectionCache.calculateSymbolVersionId(document, symbol);
        if (versionInspections?.[0] === symbolVersionId) {
            logger.debug(`cache hit for ${SymbolKind[symbol.kind]} ${symbol.name} of ${document.uri.fsPath}`);
            return versionInspections[1].then(inspections => {
                inspections.forEach(s => {
                    s.document = document;
                    s.problem.position.line = s.problem.position.relativeLine + symbol.range.start.line;
                });
                return inspections;
            });
        }
        logger.debug(`cache miss for ${SymbolKind[symbol.kind]} ${symbol.name} of ${document.uri.fsPath}`);
        return undefined;
    }

    public static cache(allInspections: Inspection[], symbols: DocumentSymbol[], document: TextDocument): void {
        if (allInspections.length < 1) return;
        for (const symbol of symbols) {
            const isMethod = METHOD_KINDS.includes(symbol.kind);
            const symbolInspections: Inspection[] = allInspections.filter(inspection => {
                const inspectionLine = inspection.problem.position.line;
                return isMethod ?
                    // NOTE: method inspections are inspections whose `position.line` is within the method's range
                    inspectionLine >= symbol.range.start.line && inspectionLine <= symbol.range.end.line :
                    // NOTE: class inspections are inspections whose `position.line` is exactly the first line number of the class
                    inspectionLine === symbol.range.start.line;
            });
            if (symbolInspections.length < 1) continue;
            // re-calculate `relativeLine` of method inspections, `relativeLine` is the relative line number to the start of the method
            symbolInspections.forEach(inspection => inspection.problem.position.relativeLine = inspection.problem.position.line - symbol.range.start.line);
            InspectionCache.cacheSymbolInspections(document, symbol, symbolInspections);
        }
    }

    private static cacheSymbolInspections(document: TextDocument, symbol: DocumentSymbol, inspections: Inspection[]): void {
        logger.debug(`cache ${inspections.length} inspections for ${SymbolKind[symbol.kind]} ${symbol.name} of ${document.uri.fsPath}`);
        const documentKey = document.uri.fsPath;
        const symbolVersionId = InspectionCache.calculateSymbolVersionId(document, symbol);
        const cachedSymbolInspections = DOC_SYMBOL_VERSION_INSPECTIONS.get(documentKey) ?? new Map();
        cachedSymbolInspections.set(symbol.name, [symbolVersionId, Promise.resolve(inspections)]);
        DOC_SYMBOL_VERSION_INSPECTIONS.set(documentKey, cachedSymbolInspections);
    }

 
    /**
     * generate a unique id for the symbol based on its content, so that we can detect if the symbol has changed
     */
    private static calculateSymbolVersionId(document: TextDocument, symbol: DocumentSymbol): string {
        const body = document.getText(symbol.range);
        return crypto.createHash('md5').update(body).digest("hex")
    }
}
